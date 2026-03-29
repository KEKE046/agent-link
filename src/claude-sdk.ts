import {
  query as sdkQuery,
  listSessions as sdkListSessions,
  getSessionInfo as sdkGetSessionInfo,
  getSessionMessages as sdkGetSessionMessages,
  type Query,
} from "@anthropic-ai/claude-agent-sdk";
// embed.js uses Bun's `import ... with { type: 'file' }` to embed the Claude CLI
// into compiled binaries and extract it to a temp dir before spawning.
import embeddedCliPath from "@anthropic-ai/claude-agent-sdk/embed";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export type { Query };

export interface ClaudeSdk {
  query: (_params: { prompt: string; options?: Record<string, any> }) => Query;
  listSessions: typeof sdkListSessions;
  getSessionInfo: typeof sdkGetSessionInfo;
  getSessionMessages: typeof sdkGetSessionMessages;
}

// Read env vars from ~/.claude/settings.json so the embedded CLI gets auth tokens
function loadSettingsEnv(): Record<string, string> {
  try {
    const settingsPath = process.env.CLAUDE_CONFIG_DIR
      ? join(process.env.CLAUDE_CONFIG_DIR, "settings.json")
      : join(homedir(), ".claude", "settings.json");
    const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    if (settings?.env && typeof settings.env === "object") {
      return settings.env;
    }
  } catch {}
  return {};
}

let _settingsEnv: Record<string, string> | null = null;
function getSettingsEnv(): Record<string, string> {
  if (!_settingsEnv) _settingsEnv = loadSettingsEnv();
  return _settingsEnv;
}

// Wrap query to always inject the embedded CLI path so compiled binaries work
function wrappedQuery(params: { prompt: string; options?: Record<string, any> }): Query {
  const env = { ...process.env, ...getSettingsEnv(), ...(params.options?.env || {}) };
  return sdkQuery({
    prompt: params.prompt,
    options: { pathToClaudeCodeExecutable: embeddedCliPath, executable: process.execPath, ...params.options, env } as any,
  });
}

const defaultSdk: ClaudeSdk = {
  query: wrappedQuery,
  listSessions: sdkListSessions,
  getSessionInfo: sdkGetSessionInfo,
  getSessionMessages: sdkGetSessionMessages,
};

let currentSdk: ClaudeSdk = defaultSdk;

export function getClaudeSdk(): ClaudeSdk {
  return currentSdk;
}

export function setClaudeSdk(sdk: ClaudeSdk | null | undefined) {
  currentSdk = sdk || defaultSdk;
}
