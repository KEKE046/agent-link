// Session fork — copy a Claude SDK session JSONL from one cwd to another,
// rewriting paths and sessionId, appending a fork notice so the model is aware.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import * as logger from "./logger";

const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
const PROJECTS = join(CLAUDE_DIR, "projects");

/** Encode a cwd path to Claude SDK project directory name */
export function encodeCwd(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, "-");
}

export interface ForkResult {
  sessionId: string;
  srcCwd: string;
  destCwd: string;
  srcDir: string;
  destDir: string;
}

/**
 * Fork a session: copy JSONL from srcCwd to destCwd with a new sessionId,
 * rewrite paths and old sessionId references, append fork notice.
 * Returns the NEW session ID.
 */
export function forkSession(sessionId: string, srcCwd: string, destCwd: string): ForkResult {
  const srcDir = join(PROJECTS, encodeCwd(srcCwd));
  const destDir = join(PROJECTS, encodeCwd(destCwd));
  const srcFile = join(srcDir, `${sessionId}.jsonl`);

  if (!existsSync(srcFile)) {
    throw new Error(`Session file not found: ${srcFile}`);
  }

  const newSessionId = crypto.randomUUID();

  // Read and replace sessionId (paths are NOT rewritten — the SDK resume cwd handles that)
  let content = readFileSync(srcFile, "utf-8");
  content = content.replaceAll(sessionId, newSessionId);

  // Append fork notice so the model knows about the directory change
  const notice = JSON.stringify({
    parentUuid: null,
    isSidechain: false,
    type: "user",
    message: {
      role: "user",
      content: [{
        type: "text",
        text: `[System Notice] Session forked. Working directory changed from ${srcCwd} to ${destCwd}. Files have been copied to the new directory.`,
      }],
    },
    uuid: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    sessionId: newSessionId,
  });
  content = content.trimEnd() + "\n" + notice + "\n";

  // Write to destination with new sessionId as filename
  mkdirSync(destDir, { recursive: true });
  writeFileSync(join(destDir, `${newSessionId}.jsonl`), content);

  logger.log("fork", `Fork: ${sessionId} → ${newSessionId} (${srcCwd} → ${destCwd})`);
  return { sessionId: newSessionId, srcCwd, destCwd, srcDir, destDir };
}
