import { getClaudeSdk, type Query } from "./claude-sdk";
import type { ClaudeParams } from "./managed";
import { mkdirSync } from "node:fs";
import * as logger from "./logger";

type Listener = (msg: any) => void;

interface ActiveSession {
  query: Query;
  cwd: string;
  model: string;
}

// Keys from ClaudeParams that map to SDK query options (vs settings)
const OPTION_KEYS = new Set([
  'model', 'systemPrompt', 'thinking', 'effort', 'maxTurns', 'maxBudgetUsd',
  'permissionMode', 'allowedTools', 'disallowedTools', 'env', 'tools',
]);

function splitClaudeParams(params?: ClaudeParams): { options: Record<string, any>; settings: Record<string, any> } {
  const options: Record<string, any> = {};
  const settings: Record<string, any> = {};
  if (!params) return { options, settings };
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    if (OPTION_KEYS.has(k)) options[k] = v;
    else settings[k] = v;
  }
  return { options, settings };
}

const active = new Map<string, ActiveSession>();
const buffers = new Map<string, any[]>();
const listeners = new Map<string, Set<Listener>>();

function broadcast(sessionId: string, msg: any) {
  if (!buffers.has(sessionId)) buffers.set(sessionId, []);
  buffers.get(sessionId)!.push(msg);
  listeners.get(sessionId)?.forEach((fn) => {
    try {
      fn(msg);
    } catch {}
  });
}

export function subscribe(
  sessionId: string,
  listener: Listener
): () => void {
  // Only replay buffer if session is active (history won't have these yet)
  if (active.has(sessionId)) {
    const buf = buffers.get(sessionId);
    if (buf) buf.forEach((msg) => listener(msg));
  }

  if (!listeners.has(sessionId)) listeners.set(sessionId, new Set());
  listeners.get(sessionId)!.add(listener);

  return () => {
    listeners.get(sessionId)?.delete(listener);
  };
}

export async function startQuery(
  prompt: string,
  opts: { sessionId?: string; cwd: string; model: string; claudeParams?: ClaudeParams }
): Promise<string> {
  const { options: extraOptions, settings: extraSettings } = splitClaudeParams(opts.claudeParams);

  const queryOpts: Record<string, any> = {
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    includePartialMessages: true,
    cwd: opts.cwd,
    ...extraOptions,
  };

  // Ensure cwd exists before starting the session
  try { mkdirSync(queryOpts.cwd, { recursive: true }); } catch {}
  // Only set model if explicitly specified
  const model = extraOptions.model || opts.model;
  if (model) queryOpts.model = model;

  // Apply settings via the settings option
  if (Object.keys(extraSettings).length > 0) {
    queryOpts.settings = extraSettings;
  }

  if (opts.sessionId) {
    queryOpts.resume = opts.sessionId;
    buffers.set(opts.sessionId, []); // clear buffer for new query
  }

  const q = getClaudeSdk().query({ prompt, options: queryOpts });
  let resolvedId = opts.sessionId || "";
  logger.debug("session", `Starting query${opts.sessionId ? ` (resume: ${opts.sessionId})` : " (new)"} cwd=${opts.cwd}`);

  if (opts.sessionId) {
    active.set(opts.sessionId, {
      query: q,
      cwd: opts.cwd,
      model: opts.model,
    });
  }

  let earlyError: Error | null = null;

  const run = async () => {
    try {
      for await (const msg of q) {
        if (!resolvedId && msg.type === "system" && msg.subtype === "init") {
          resolvedId = msg.session_id;
          logger.debug("session", `Init: ${resolvedId}`);
          active.set(resolvedId, {
            query: q,
            cwd: opts.cwd,
            model: opts.model,
          });
        }
        if (resolvedId) broadcast(resolvedId, msg);
      }
    } catch (err: any) {
      if (resolvedId) {
        broadcast(resolvedId, { type: "error", error: err.message });
        logger.error("session", `Session ${resolvedId} error: ${err.message}`);
      } else {
        // Error before init — propagate to startQuery promise
        logger.error("session", `Pre-init error: ${err.message}`);
        earlyError = err instanceof Error ? err : new Error(String(err));
      }
    } finally {
      if (resolvedId) active.delete(resolvedId);
      if (resolvedId) {
        broadcast(resolvedId, { type: "status", status: "idle" });
      }
    }
  };

  run();

  // For new sessions, wait for init to get the session ID
  if (!opts.sessionId) {
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(
        () => reject(new Error("Timeout waiting for session init")),
        30000
      );
      const i = setInterval(() => {
        if (resolvedId) {
          clearInterval(i); clearTimeout(t); resolve();
        } else if (earlyError) {
          clearInterval(i); clearTimeout(t); reject(earlyError);
        }
      }, 50);
    });
  }

  return resolvedId;
}

export async function interrupt(sessionId: string) {
  const s = active.get(sessionId);
  if (s) {
    await s.query.interrupt();
  }
}

export async function setModel(sessionId: string, model: string) {
  const s = active.get(sessionId);
  if (s) {
    await s.query.setModel(model);
    s.model = model;
  }
}

export function getActiveIds(): string[] {
  return [...active.keys()];
}

export function isActive(sessionId: string): boolean {
  return active.has(sessionId);
}

export async function listSessions(cwd?: string, limit = 50, offset = 0) {
  return getClaudeSdk().listSessions({ dir: cwd, limit, offset });
}

export async function getSessionInfo(sessionId: string, cwd?: string) {
  return getClaudeSdk().getSessionInfo(sessionId, { dir: cwd });
}

export async function getSessionMessages(
  sessionId: string,
  cwd?: string,
  limit = 200,
  offset = 0
) {
  return getClaudeSdk().getSessionMessages(sessionId, { dir: cwd, limit, offset });
}
