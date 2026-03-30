import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// Set CLAUDE_CONFIG_DIR before importing fork module
const tmpRoot = `/tmp/agent-link-fork-test-${Date.now()}`;
mkdirSync(tmpRoot, { recursive: true });
process.env.CLAUDE_CONFIG_DIR = tmpRoot;

const { forkSession, encodeCwd } = await import("./fork");

let testDir: string;

beforeEach(() => {
  testDir = join(tmpRoot, `run-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  try { rmSync(testDir, { recursive: true, force: true }); } catch {}
});

// Final cleanup
process.on("exit", () => {
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
});

describe("encodeCwd", () => {
  test("replaces non-alphanumeric chars with dashes", () => {
    expect(encodeCwd("/home/user/project")).toBe("-home-user-project");
    expect(encodeCwd("/tmp/test.1")).toBe("-tmp-test-1");
    expect(encodeCwd("abc123")).toBe("abc123");
  });
});

describe("forkSession", () => {
  const sessionId = "test-session-" + Date.now();
  const srcCwd = "/tmp/srcA";
  const destCwd = "/tmp/destB";

  test("copies JSONL and rewrites paths", () => {
    const srcDir = join(tmpRoot, "projects", encodeCwd(srcCwd));
    mkdirSync(srcDir, { recursive: true });

    const lines = [
      JSON.stringify({ type: "user", message: { role: "user", content: "hello" }, cwd: srcCwd, sessionId }),
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: "hi" }, cwd: srcCwd, sessionId }),
    ];
    writeFileSync(join(srcDir, `${sessionId}.jsonl`), lines.join("\n") + "\n");

    const result = forkSession(sessionId, srcCwd, destCwd);
    expect(result.sessionId).toBe(sessionId);
    expect(result.srcCwd).toBe(srcCwd);
    expect(result.destCwd).toBe(destCwd);

    // Check dest file exists
    const destDir = join(tmpRoot, "projects", encodeCwd(destCwd));
    const destFile = join(destDir, `${sessionId}.jsonl`);
    expect(existsSync(destFile)).toBe(true);

    // Check paths were rewritten in the original lines (not the fork notice)
    const content = readFileSync(destFile, "utf-8");
    const contentLines = content.trim().split("\n");
    // Original lines should have destCwd, not srcCwd
    for (let i = 0; i < contentLines.length - 1; i++) {
      expect(contentLines[i]).not.toContain(srcCwd);
      expect(contentLines[i]).toContain(destCwd);
    }

    // Check fork notice was appended
    const lastLine = JSON.parse(contentLines[contentLines.length - 1]);
    expect(lastLine.type).toBe("user");
    expect(lastLine.message.content[0].text).toContain("Session forked");
    expect(lastLine.message.content[0].text).toContain(srcCwd);
    expect(lastLine.message.content[0].text).toContain(destCwd);
    expect(lastLine.uuid).toBeTruthy();
  });

  test("throws if source session not found", () => {
    expect(() => forkSession("nonexistent-session", srcCwd, destCwd))
      .toThrow("Session file not found");
  });

  test("preserves original file intact", () => {
    const srcDir = join(tmpRoot, "projects", encodeCwd(srcCwd));
    mkdirSync(srcDir, { recursive: true });

    const original = JSON.stringify({ type: "user", cwd: srcCwd, sessionId }) + "\n";
    writeFileSync(join(srcDir, `${sessionId}.jsonl`), original);

    forkSession(sessionId, srcCwd, destCwd);

    // Original should be unchanged
    const after = readFileSync(join(srcDir, `${sessionId}.jsonl`), "utf-8");
    expect(after).toBe(original);
  });

  test("creates dest project dir if not exists", () => {
    const srcDir = join(tmpRoot, "projects", encodeCwd(srcCwd));
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, `${sessionId}.jsonl`), '{"test":true}\n');

    const newDest = "/tmp/brand-new-dir";
    const destDir = join(tmpRoot, "projects", encodeCwd(newDest));

    expect(existsSync(destDir)).toBe(false);
    forkSession(sessionId, srcCwd, newDest);
    expect(existsSync(destDir)).toBe(true);
  });
});
