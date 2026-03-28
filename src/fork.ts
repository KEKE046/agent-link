import { existsSync } from "fs";
import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";

const PROJECTS = join(process.env.HOME || "/root", ".claude", "projects");

function encodeCwd(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, "-");
}

export function nextCwd(cwd: string): string {
  const match = cwd.match(/^(.+)\.(\d+)$/);
  const base = match ? match[1] : cwd;
  let n = match ? parseInt(match[2]) + 1 : 1;
  while (existsSync(`${base}.${n}`)) n++;
  return `${base}.${n}`;
}

export type ForkStatus =
  | "copying"
  | "rewriting"
  | "done"
  | "cancelled"
  | "deleting"
  | "deleted"
  | "error";

export interface ForkOperation {
  id: string;
  sessionId: string;
  srcCwd: string;
  newCwd: string;
  status: ForkStatus;
  error?: string;
}

interface InternalFork extends ForkOperation {
  proc?: ReturnType<typeof Bun.spawn>;
}

const forks = new Map<string, InternalFork>();

export function listForks(): ForkOperation[] {
  return [...forks.values()].map(({ proc, ...rest }) => rest);
}

export function getFork(id: string): ForkOperation | undefined {
  const f = forks.get(id);
  if (!f) return undefined;
  const { proc, ...rest } = f;
  return rest;
}

export async function startFork(
  sessionId: string,
  srcCwd: string
): Promise<ForkOperation> {
  const newCwd = nextCwd(srcCwd);
  const id = crypto.randomUUID().slice(0, 8);
  const op: InternalFork = {
    id,
    sessionId,
    srcCwd,
    newCwd,
    status: "copying",
  };
  forks.set(id, op);

  (async () => {
    try {
      // 1. Copy filesystem
      const proc = Bun.spawn(["cp", "-a", srcCwd, newCwd], {
        stdout: "ignore",
        stderr: "pipe",
      });
      op.proc = proc;
      const exitCode = await proc.exited;
      if (op.status === "cancelled") return;
      if (exitCode !== 0) {
        const stderr = await new Response(proc.stderr).text();
        throw new Error(`cp failed (exit ${exitCode}): ${stderr.slice(0, 200)}`);
      }

      // 2. Rewrite JSONL
      op.status = "rewriting";
      delete op.proc;

      const srcDir = join(PROJECTS, encodeCwd(srcCwd));
      const dstDir = join(PROJECTS, encodeCwd(newCwd));
      await mkdir(dstDir, { recursive: true });

      const srcFile = join(srcDir, `${sessionId}.jsonl`);
      let content = await readFile(srcFile, "utf-8");
      content = content.replaceAll(srcCwd, newCwd);

      // Append fork notice
      const notice = JSON.stringify({
        parentUuid: null,
        isSidechain: false,
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "text",
              text: `[System Notice] 工作目录已从 ${srcCwd} 变更为 ${newCwd}。这是 session fork，文件已复制到新目录。`,
            },
          ],
        },
        uuid: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        sessionId,
      });
      content = content.trimEnd() + "\n" + notice + "\n";
      await writeFile(join(dstDir, `${sessionId}.jsonl`), content);

      op.status = "done";
    } catch (err: any) {
      if (op.status !== "cancelled") {
        op.status = "error";
        op.error = err.message;
      }
    }
  })();

  const { proc, ...rest } = op;
  return rest;
}

export function cancelFork(id: string): boolean {
  const op = forks.get(id);
  if (!op) return false;
  if (op.status === "copying") {
    op.status = "cancelled";
    op.proc?.kill();
    delete op.proc;
    return true;
  }
  if (op.status === "deleting") {
    op.status = "cancelled";
    op.proc?.kill();
    delete op.proc;
    return true;
  }
  return false;
}

export async function deleteForkDir(id: string): Promise<boolean> {
  const op = forks.get(id);
  if (!op) return false;
  if (op.status !== "cancelled" && op.status !== "error") return false;

  op.status = "deleting";

  try {
    // Delete the copied cwd directory
    const proc = Bun.spawn(["rm", "-rf", op.newCwd], {
      stdout: "ignore",
      stderr: "ignore",
    });
    op.proc = proc;
    await proc.exited;
    if (op.status !== "deleting") return false; // was re-cancelled

    // Delete the JSONL copy
    const dstDir = join(PROJECTS, encodeCwd(op.newCwd));
    const proc2 = Bun.spawn(["rm", "-rf", dstDir], {
      stdout: "ignore",
      stderr: "ignore",
    });
    op.proc = proc2;
    await proc2.exited;

    op.status = "deleted";
    delete op.proc;
    forks.delete(id);
    return true;
  } catch {
    op.status = "error";
    op.error = "delete failed";
    return false;
  }
}
