import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";

const cache = new Map<string, { value: unknown; mtimeMs: number }>();

function storeDir() {
  return Bun.env.AGENT_LINK_HOME || join(homedir(), ".agent-link");
}

function ensureDir(path: string) {
  mkdirSync(dirname(path), { recursive: true });
}

function filePath(name: string) {
  return join(storeDir(), name.endsWith(".json") ? name : `${name}.json`);
}

export function load<T>(name: string, fallback: T): T {
  const path = filePath(name);
  let mtimeMs = 0;
  try {
    mtimeMs = statSync(path).mtimeMs;
  } catch {}
  const cached = cache.get(path);
  if (cached && cached.mtimeMs === mtimeMs) {
    // NOTE: load returns the same object reference kept in cache.
    // Callers that mutate the returned object will also mutate the cache.
    return cached.value as T;
  }
  let value = fallback;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch {}
  cache.set(path, { value, mtimeMs });
  return value;
}

export function save<T>(name: string, data: T): void {
  const path = filePath(name);
  const tmp = `${path}.tmp`;
  ensureDir(path);
  const content = JSON.stringify(data, null, 2);
  writeFileSync(tmp, content, "utf8");
  renameSync(tmp, path);
  let mtimeMs = 0;
  try {
    mtimeMs = statSync(path).mtimeMs;
  } catch {}
  cache.set(path, { value: data, mtimeMs });
}
