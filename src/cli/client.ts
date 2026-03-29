// Shared HTTP client helpers for CLI introspection commands

import { join } from "node:path";
import { homedir } from "node:os";
import { readFileSync } from "node:fs";

export function getServerUrl(args: string[]): string {
  const i = args.indexOf("--url");
  if (i >= 0 && args[i + 1]) return args[i + 1].replace(/\/$/, "");
  return (Bun.env.AGENT_LINK_URL || "http://localhost:3456").replace(/\/$/, "");
}

export function getArg(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

export function positionalArgs(args: string[]): string[] {
  const result: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) { i++; continue; }
    if ((a === "-n") && i + 1 < args.length) { i++; continue; }
    if (!a.startsWith("-")) result.push(a);
  }
  return result;
}

export function getShortArg(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : undefined;
}

// Read token from AGENT_LINK_HOME store (same file the server writes via initAuth)
function readStoredToken(): string | null {
  if (Bun.env.AGENT_LINK_TOKEN) return Bun.env.AGENT_LINK_TOKEN;
  const home = Bun.env.AGENT_LINK_HOME || join(homedir(), ".agent-link");
  try {
    const data = JSON.parse(readFileSync(join(home, "auth.json"), "utf8"));
    return typeof data.token === "string" ? data.token : null;
  } catch {
    return null;
  }
}

function authHeaders(): Record<string, string> {
  const token = readStoredToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function apiFetch(url: string, path: string, opts?: RequestInit): Promise<any> {
  const headers = new Headers({ ...authHeaders(), ...(opts?.headers as any || {}) });
  const res = await fetch(url + path, { ...opts, headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return res.json();
}

export async function apiFetchOpt(url: string, path: string, opts?: RequestInit): Promise<any | null> {
  try { return await apiFetch(url, path, opts); } catch { return null; }
}

export function findAgent(managed: any[], query: string): any | null {
  if (!query) return null;
  const q = query.toLowerCase();
  let found = managed.find((s) => s.name.toLowerCase() === q);
  if (found) return found;
  found = managed.find((s) => s.id.startsWith(query));
  if (found) return found;
  found = managed.find((s) => s.name.toLowerCase().includes(q));
  return found || null;
}

export function col(s: string, width: number): string {
  return String(s ?? "").padEnd(width).slice(0, width);
}

// For streaming SSE in send.ts — returns fetch with auth headers
export function authFetch(url: string, opts?: RequestInit): Promise<Response> {
  const headers = new Headers({ ...authHeaders(), ...(opts?.headers as any || {}) });
  return fetch(url, { ...opts, headers });
}
