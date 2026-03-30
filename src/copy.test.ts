import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, chmodSync } from "node:fs";
import { join } from "node:path";

// Must set AGENT_LINK_HOME before importing copy module
const tmpRoot = `/tmp/agent-link-copy-test-${Date.now()}`;
mkdirSync(tmpRoot, { recursive: true });
Bun.env.AGENT_LINK_HOME = tmpRoot;

// Dynamic import so env is set first
const { nextCopyName, startCopy, startDelete, removeTask, listTasks, getTask } = await import("./copy");
const { save } = await import("./store");

let testDir: string;

beforeEach(() => {
  testDir = join(tmpRoot, `run-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  mkdirSync(testDir, { recursive: true });
  // Clear tasks
  save("copy-tasks", []);
});

afterEach(() => {
  try { chmodSync(testDir, 0o755); } catch {}
  try { rmSync(testDir, { recursive: true, force: true }); } catch {}
});

// Final cleanup
process.on("exit", () => {
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
});

describe("nextCopyName", () => {
  test("returns .1 for base folder", () => {
    const src = join(testDir, "proj");
    mkdirSync(src);
    const result = nextCopyName(src);
    expect(result.dest).toBe(join(testDir, "proj.1"));
    expect(result.number).toBe(1);
  });

  test("skips existing .1 and returns .2", () => {
    const src = join(testDir, "proj");
    mkdirSync(src);
    mkdirSync(join(testDir, "proj.1"));
    const result = nextCopyName(src);
    expect(result.dest).toBe(join(testDir, "proj.2"));
    expect(result.number).toBe(2);
  });

  test("increments from .N source", () => {
    const src = join(testDir, "proj.3");
    mkdirSync(src);
    const result = nextCopyName(src);
    expect(result.dest).toBe(join(testDir, "proj.4"));
    expect(result.number).toBe(4);
  });

  test("skips occupied numbers", () => {
    const src = join(testDir, "proj");
    mkdirSync(src);
    mkdirSync(join(testDir, "proj.1"));
    mkdirSync(join(testDir, "proj.2"));
    mkdirSync(join(testDir, "proj.3"));
    const result = nextCopyName(src);
    expect(result.dest).toBe(join(testDir, "proj.4"));
    expect(result.number).toBe(4);
  });
});

describe("startCopy", () => {
  test("copies folder contents", async () => {
    const src = join(testDir, "src");
    mkdirSync(src);
    writeFileSync(join(src, "a.txt"), "hello");
    mkdirSync(join(src, "sub"));
    writeFileSync(join(src, "sub", "b.txt"), "world");

    const task = startCopy(src);
    expect(task.status).toBe("copying");
    expect(task.src).toBe(src);
    expect(task.dest).toBe(join(testDir, "src.1"));

    // Wait for completion
    await waitForStatus(task.id, "done", 5000);

    expect(readFileSync(join(testDir, "src.1", "a.txt"), "utf8")).toBe("hello");
    expect(readFileSync(join(testDir, "src.1", "sub", "b.txt"), "utf8")).toBe("world");
  });

  test("uses custom dest", async () => {
    const src = join(testDir, "src");
    mkdirSync(src);
    writeFileSync(join(src, "f.txt"), "data");

    const dest = join(testDir, "custom");
    const task = startCopy(src, dest);
    expect(task.dest).toBe(dest);

    await waitForStatus(task.id, "done", 5000);
    expect(readFileSync(join(dest, "f.txt"), "utf8")).toBe("data");
  });

  test("fails if source missing", () => {
    expect(() => startCopy(join(testDir, "nonexistent"))).toThrow("Source does not exist");
  });

  test("fails if dest exists", () => {
    const src = join(testDir, "src");
    const dest = join(testDir, "dest");
    mkdirSync(src);
    mkdirSync(dest);
    expect(() => startCopy(src, dest)).toThrow("Destination already exists");
  });

  test("marks failed on cp error", async () => {
    const src = join(testDir, "restricted");
    mkdirSync(src);
    writeFileSync(join(src, "locked"), "secret");
    chmodSync(join(src, "locked"), 0o000);

    const task = startCopy(src);
    await waitForStatus(task.id, "failed", 5000);

    const t = getTask(task.id)!;
    expect(t.status).toBe("failed");
    expect(t.error).toContain("Permission denied");

    // Cleanup
    chmodSync(join(src, "locked"), 0o644);
  });
});

describe("startDelete", () => {
  test("deletes failed copy destination", async () => {
    const src = join(testDir, "restricted");
    mkdirSync(src);
    writeFileSync(join(src, "locked"), "secret");
    chmodSync(join(src, "locked"), 0o000);

    const task = startCopy(src);
    await waitForStatus(task.id, "failed", 5000);

    // Dest should exist (partial copy)
    const dest = getTask(task.id)!.dest;
    expect(existsSync(dest)).toBe(true);

    // Delete it
    startDelete(task.id);
    await waitForStatus(task.id, "deleted", 5000);
    expect(existsSync(dest)).toBe(false);

    chmodSync(join(src, "locked"), 0o644);
  });

  test("rejects delete on done task", async () => {
    const src = join(testDir, "good");
    mkdirSync(src);
    writeFileSync(join(src, "f.txt"), "ok");

    const task = startCopy(src);
    await waitForStatus(task.id, "done", 5000);

    expect(() => startDelete(task.id)).toThrow("Can only delete failed copies");
  });
});

describe("removeTask", () => {
  test("removes done task record", async () => {
    const src = join(testDir, "src");
    mkdirSync(src);
    writeFileSync(join(src, "f.txt"), "x");

    const task = startCopy(src);
    await waitForStatus(task.id, "done", 5000);

    expect(removeTask(task.id)).toBe(true);
    expect(getTask(task.id)).toBeUndefined();
    expect(listTasks().find(t => t.id === task.id)).toBeUndefined();
  });

  test("rejects remove on copying task", () => {
    // Inject a fake copying task
    save("copy-tasks", [{ id: "fake", src: "/a", dest: "/b", status: "copying", createdAt: 0, updatedAt: 0 }]);
    expect(() => removeTask("fake")).toThrow("Cannot remove task in copying state");
  });
});

describe("crash recovery", () => {
  test("marks interrupted copying tasks as failed on reload", async () => {
    // Inject a copying task with a dead PID
    save("copy-tasks", [{
      id: "crashed",
      src: "/tmp/a",
      dest: "/tmp/b",
      status: "copying",
      createdAt: 0,
      updatedAt: 0,
      pid: 999999,
    }]);

    // Re-import to trigger recovery
    // We can't easily re-import, but we can call the recovery logic
    // by checking what the module does — for now, verify by reading the store
    // The recovery ran on module load. Let's verify by injecting and reloading store.
    // Actually the recovery already ran. Let's test via a fresh import trick:
    const mod = await import("./copy?v=" + Date.now());
    // After import, the store should have been updated
    const { load } = await import("./store");
    const tasks = load("copy-tasks", []) as any[];
    const crashed = tasks.find((t: any) => t.id === "crashed");
    expect(crashed?.status).toBe("failed");
    expect(crashed?.error).toContain("Interrupted");
  });
});

// Helper: poll task status until it matches or timeout
async function waitForStatus(taskId: string, status: string, timeoutMs: number) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const t = getTask(taskId);
    if (t?.status === status) return;
    await Bun.sleep(100);
  }
  const t = getTask(taskId);
  throw new Error(`Task ${taskId} status is ${t?.status}, expected ${status} (after ${timeoutMs}ms)`);
}
