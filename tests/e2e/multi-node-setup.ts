// Multi-node test helpers — spawn real CLI processes for panel/node/relay.

import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface ProcessContext {
  proc: ChildProcess;
  port: number;
  url: string;
  tmpDir: string;
  output: string[];
  token?: string;
}

/** Find a free port by briefly binding to port 0. */
async function getFreePort(): Promise<number> {
  const srv = Bun.serve({ port: 0, fetch: () => new Response("") });
  const port = srv.port!;
  srv.stop();
  return port;
}

/** Wait for a line matching `marker` in process stdout/stderr. */
function waitForReady(ctx: ProcessContext, marker: string, timeoutMs = 15000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ctx.proc.exitCode !== null) {
      return reject(new Error(`Process already exited (${ctx.proc.exitCode})\n${ctx.output.join("")}`));
    }
    const timeout = setTimeout(() => reject(new Error(`Timeout waiting for "${marker}"\n${ctx.output.join("")}`)), timeoutMs);
    const check = (data: Buffer) => {
      const line = data.toString();
      ctx.output.push(line);
      if (line.includes(marker)) {
        clearTimeout(timeout);
        resolve();
      }
    };
    ctx.proc.stdout?.on("data", check);
    ctx.proc.stderr?.on("data", check);
    ctx.proc.on("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Process exited (code=${code}) before ready\n${ctx.output.join("")}`));
    });
  });
}

const TEST_TOKEN = "test-link-secret";

/** Spawn a panel server (--accept-nodes --no-auth). */
export async function spawnPanel(): Promise<ProcessContext> {
  const port = await getFreePort();
  const tmpDir = `/tmp/al-test-panel-${port}`;
  mkdirSync(tmpDir, { recursive: true });
  const proc = spawn("bun", ["run", "src/cli.ts", "server", "--accept-nodes", "--no-auth", "--port", String(port), "--token", TEST_TOKEN], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, AGENT_LINK_HOME: tmpDir, NODE_ENV: "test" },
  });
  const ctx: ProcessContext = { proc, port, url: `http://localhost:${port}`, tmpDir, output: [], token: TEST_TOKEN };
  await waitForReady(ctx, "Listening on");
  return ctx;
}

/** Spawn a node connecting to panelUrl. */
export async function spawnNode(panelUrl: string, opts: { name?: string; relay?: boolean; token?: string } = {}): Promise<ProcessContext> {
  const port = await getFreePort();
  const tmpDir = `/tmp/al-test-node-${port}`;
  mkdirSync(tmpDir, { recursive: true });
  const token = opts.token || TEST_TOKEN;
  const args = ["run", "src/cli.ts", "node", panelUrl, "--no-auth", "--port", String(port), "--token", token];
  if (opts.name) args.push("--name", opts.name);
  if (opts.relay) args.push("--accept-nodes");
  const proc = spawn("bun", args, {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, AGENT_LINK_HOME: tmpDir, NODE_ENV: "test" },
  });
  const ctx: ProcessContext = { proc, port, url: `http://localhost:${port}`, tmpDir, output: [] };
  await waitForReady(ctx, "Local API listening on");
  return ctx;
}

/** Wait for a node to appear in the panel's node list. */
export async function waitForNode(panelUrl: string, match: string, timeoutMs = 10000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const resp = await fetch(`${panelUrl}/api/nodes`);
      const nodes: any[] = await resp.json();
      const node = nodes.find((n) => n.nodeId.includes(match) || n.label.includes(match));
      if (node) return node.nodeId;
    } catch {}
    await Bun.sleep(300);
  }
  throw new Error(`Node matching "${match}" not found after ${timeoutMs}ms`);
}

/** Approve a node on the panel. */
export async function approveNode(panelUrl: string, nodeId: string): Promise<boolean> {
  const resp = await fetch(`${panelUrl}/api/nodes/${encodeURIComponent(nodeId)}/approve`, { method: "POST" });
  const data = await resp.json() as { ok: boolean };
  return data.ok;
}

/** Wait for a node to show as online + approved. */
export async function waitForNodeOnline(panelUrl: string, nodeId: string, timeoutMs = 10000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const resp = await fetch(`${panelUrl}/api/nodes`);
      const nodes: any[] = await resp.json();
      const node = nodes.find((n) => n.nodeId === nodeId);
      if (node?.online && node?.approved) return;
    } catch {}
    await Bun.sleep(300);
  }
  throw new Error(`Node ${nodeId} not online+approved after ${timeoutMs}ms`);
}

/** Stop a process and clean up its temp dir. */
export function stopProcess(ctx: ProcessContext) {
  if (ctx.proc.exitCode === null && !ctx.proc.killed) {
    ctx.proc.kill("SIGTERM");
  }
  try { rmSync(ctx.tmpDir, { recursive: true, force: true }); } catch {}
}
