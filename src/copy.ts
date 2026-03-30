// Folder copy/delete task manager with persistent state and crash recovery.
//
// States: copying → done | failed
//         failed  → deleting → deleted | delete_failed
//
// On module load, any task stuck in "copying" or "deleting" (from a crash)
// is recovered: if the child process is gone, mark failed/delete_failed.

import { load, save } from "./store";
import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import * as logger from "./logger";

export interface CopyTask {
  id: string;
  src: string;
  dest: string;
  status: "copying" | "done" | "failed" | "deleting" | "deleted" | "delete_failed";
  error?: string;
  createdAt: number;
  updatedAt: number;
  pid?: number;
}

const STORE_KEY = "copy-tasks";

// In-memory set of active child process pids managed by this process
const activePids = new Set<number>();

function readTasks(): CopyTask[] {
  const data = load<CopyTask[]>(STORE_KEY, []);
  return Array.isArray(data) ? data : [];
}

function saveTasks(tasks: CopyTask[]) {
  save(STORE_KEY, tasks);
}

function updateTask(id: string, patch: Partial<CopyTask>) {
  const tasks = readTasks();
  const t = tasks.find((t) => t.id === id);
  if (!t) return;
  Object.assign(t, patch, { updatedAt: Date.now() });
  saveTasks(tasks);
}

function genId(): string {
  return `cp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// --- Next available name ---

export function nextCopyName(cwd: string): { dest: string; number: number } {
  // Parse base: strip trailing .N if present
  const name = basename(cwd);
  const dir = dirname(cwd);
  const match = name.match(/^(.+)\.(\d+)$/);
  const base = match ? match[1] : name;
  const start = match ? parseInt(match[2]) + 1 : 1;

  for (let n = start; ; n++) {
    const candidate = join(dir, `${base}.${n}`);
    // Also check it's not a pending/active copy destination
    const tasks = readTasks();
    const occupied = tasks.some(
      (t) => t.dest === candidate && (t.status === "copying" || t.status === "done")
    );
    if (!existsSync(candidate) && !occupied) {
      return { dest: candidate, number: n };
    }
  }
}

// --- Start copy ---

export function startCopy(src: string, dest?: string): CopyTask {
  if (!existsSync(src)) {
    throw new Error(`Source does not exist: ${src}`);
  }
  if (dest && existsSync(dest)) {
    throw new Error(`Destination already exists: ${dest}`);
  }

  const target = dest || nextCopyName(src).dest;
  // Double-check dest doesn't exist (race guard)
  if (existsSync(target)) {
    throw new Error(`Destination already exists: ${target}`);
  }

  const task: CopyTask = {
    id: genId(),
    src,
    dest: target,
    status: "copying",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const tasks = readTasks();
  tasks.push(task);
  saveTasks(tasks);

  runCopy(task.id, src, target);
  return task;
}

async function runCopy(taskId: string, src: string, dest: string) {
  try {
    const proc = Bun.spawn(["cp", "-a", src, dest], {
      stdout: "ignore",
      stderr: "pipe",
    });
    updateTask(taskId, { pid: proc.pid });
    activePids.add(proc.pid);

    const exitCode = await proc.exited;
    activePids.delete(proc.pid);

    if (exitCode === 0) {
      updateTask(taskId, { status: "done", pid: undefined });
      logger.log("copy", `Done: ${src} → ${dest}`);
    } else {
      const stderr = await new Response(proc.stderr).text();
      updateTask(taskId, {
        status: "failed",
        error: stderr.trim() || `cp exited with code ${exitCode}`,
        pid: undefined,
      });
      logger.error("copy", `Failed: ${src} → ${dest}: ${stderr.trim()}`);
    }
  } catch (err: any) {
    activePids.delete(0); // no pid available
    updateTask(taskId, {
      status: "failed",
      error: err.message,
      pid: undefined,
    });
    logger.error("copy", `Failed to spawn cp: ${err.message}`);
  }
}

// --- Delete a failed copy's destination ---

export function startDelete(taskId: string): CopyTask {
  const tasks = readTasks();
  const task = tasks.find((t) => t.id === taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);
  if (task.status !== "failed" && task.status !== "delete_failed") {
    throw new Error(`Can only delete failed copies (status: ${task.status})`);
  }

  task.status = "deleting";
  task.error = undefined;
  task.updatedAt = Date.now();
  saveTasks(tasks);

  runDelete(task.id, task.dest);
  return task;
}

async function runDelete(taskId: string, dest: string) {
  try {
    if (!existsSync(dest)) {
      updateTask(taskId, { status: "deleted", pid: undefined });
      logger.log("copy", `Delete: ${dest} already gone`);
      return;
    }
    const proc = Bun.spawn(["rm", "-rf", dest], {
      stdout: "ignore",
      stderr: "pipe",
    });
    updateTask(taskId, { pid: proc.pid });
    activePids.add(proc.pid);

    const exitCode = await proc.exited;
    activePids.delete(proc.pid);

    if (exitCode === 0) {
      updateTask(taskId, { status: "deleted", pid: undefined });
      logger.log("copy", `Deleted: ${dest}`);
    } else {
      const stderr = await new Response(proc.stderr).text();
      updateTask(taskId, {
        status: "delete_failed",
        error: stderr.trim() || `rm exited with code ${exitCode}`,
        pid: undefined,
      });
      logger.error("copy", `Delete failed: ${dest}: ${stderr.trim()}`);
    }
  } catch (err: any) {
    updateTask(taskId, {
      status: "delete_failed",
      error: err.message,
      pid: undefined,
    });
    logger.error("copy", `Failed to spawn rm: ${err.message}`);
  }
}

// --- Remove a task record (only terminal states) ---

export function removeTask(taskId: string): boolean {
  const tasks = readTasks();
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return false;
  if (task.status === "copying" || task.status === "deleting") {
    throw new Error(`Cannot remove task in ${task.status} state`);
  }
  saveTasks(tasks.filter((t) => t.id !== taskId));
  return true;
}

// --- List / get ---

export function listTasks(): CopyTask[] {
  return readTasks();
}

export function getTask(taskId: string): CopyTask | undefined {
  return readTasks().find((t) => t.id === taskId);
}

// --- Crash recovery (called on module load) ---

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function recover() {
  const tasks = readTasks();
  let changed = false;
  for (const t of tasks) {
    if (t.status === "copying") {
      // If we own this pid, it's still running — skip
      if (t.pid && activePids.has(t.pid)) continue;
      // If pid is alive from another incarnation, still mark failed
      // because we can't track it
      t.status = "failed";
      t.error = "Interrupted (process exited or server restarted)";
      t.pid = undefined;
      t.updatedAt = Date.now();
      changed = true;
      logger.log("copy", `Recovered interrupted copy: ${t.src} → ${t.dest}`);
    }
    if (t.status === "deleting") {
      if (t.pid && activePids.has(t.pid)) continue;
      t.status = "delete_failed";
      t.error = "Interrupted (process exited or server restarted)";
      t.pid = undefined;
      t.updatedAt = Date.now();
      changed = true;
      logger.log("copy", `Recovered interrupted delete: ${t.dest}`);
    }
  }
  if (changed) saveTasks(tasks);
}

// Run recovery on module load
recover();
