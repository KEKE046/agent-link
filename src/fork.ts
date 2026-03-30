// Session fork — copy a Claude SDK session JSONL from one cwd to another,
// rewriting paths and appending a fork notice so the model is aware.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

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
 * Fork a session: copy JSONL from srcCwd to destCwd, rewrite paths, append fork notice.
 * Returns the session ID (same ID, new cwd location).
 */
export function forkSession(sessionId: string, srcCwd: string, destCwd: string): ForkResult {
  const srcDir = join(PROJECTS, encodeCwd(srcCwd));
  const destDir = join(PROJECTS, encodeCwd(destCwd));
  const srcFile = join(srcDir, `${sessionId}.jsonl`);

  if (!existsSync(srcFile)) {
    throw new Error(`Session file not found: ${srcFile}`);
  }

  // Read and rewrite paths
  let content = readFileSync(srcFile, "utf-8");
  content = content.replaceAll(srcCwd, destCwd);

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
    sessionId,
  });
  content = content.trimEnd() + "\n" + notice + "\n";

  // Write to destination
  mkdirSync(destDir, { recursive: true });
  writeFileSync(join(destDir, `${sessionId}.jsonl`), content);

  return { sessionId, srcCwd, destCwd, srcDir, destDir };
}
