import { join } from "node:path";
import { homedir } from "node:os";
import { mkdirSync, appendFileSync } from "node:fs";

type Level = "info" | "warn" | "error" | "debug";

let logFile: string | null = null;
let enableDebug = false;

export function initLogger(opts: { file?: boolean; debug?: boolean } = {}) {
  if (opts.debug) enableDebug = true;
  if (opts.file !== false) {
    const dir = Bun.env.AGENT_LINK_HOME || join(homedir(), ".agent-link");
    mkdirSync(dir, { recursive: true });
    logFile = join(dir, "agent-link.log");
  }
}

function write(level: Level, tag: string, msg: string) {
  if (level === "debug" && !enableDebug) return;
  const ts = new Date().toISOString();
  const line = `${ts} [${level.toUpperCase()}] [${tag}] ${msg}`;
  const colored = color(level, line);
  if (level === "error") {
    process.stderr.write(colored + "\n");
  } else {
    process.stdout.write(colored + "\n");
  }
  if (logFile) {
    try { appendFileSync(logFile, line + "\n"); } catch {}
  }
}

function color(level: Level, text: string) {
  switch (level) {
    case "error": return `\x1b[31m${text}\x1b[0m`;
    case "warn":  return `\x1b[33m${text}\x1b[0m`;
    case "debug": return `\x1b[90m${text}\x1b[0m`;
    default:      return text;
  }
}

export function log(tag: string, msg: string)   { write("info",  tag, msg); }
export function warn(tag: string, msg: string)  { write("warn",  tag, msg); }
export function error(tag: string, msg: string) { write("error", tag, msg); }
export function debug(tag: string, msg: string) { write("debug", tag, msg); }
