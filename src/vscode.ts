import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

interface ActiveVscodeServer {
  cwd: string;
  id: string;
  commit: string;
  port: number;
  process: ChildProcess;
}

export interface VscodeVersion {
  commit: string;
  version: string;
}

export interface VscodeServerSummary {
  cwd: string;
  id: string;
  commit: string;
  port: number;
  pid: number;
}

const byCwd = new Map<string, ActiveVscodeServer>();
const byId = new Map<string, ActiveVscodeServer>();

const vscodeRoot = join(homedir(), ".vscode-server");
const vscodeServersDir = join(vscodeRoot, "cli", "servers");

function getId(cwd: string): string {
  return encodeURIComponent(cwd);
}

function getBinaryPath(commit: string): string {
  return join(vscodeRoot, `code-${commit}`);
}

function getServerBasePath(id: string): string {
  return `/vscode/${id}`;
}

function cleanup(active: ActiveVscodeServer) {
  if (byCwd.get(active.cwd)?.process === active.process) byCwd.delete(active.cwd);
  if (byId.get(active.id)?.process === active.process) byId.delete(active.id);
}

export async function listInstalledVersions(): Promise<VscodeVersion[]> {
  try {
    const entries = await readdir(vscodeServersDir, { withFileTypes: true });
    const versions: VscodeVersion[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith("Stable-")) continue;
      const commit = entry.name.slice("Stable-".length);
      if (!commit) continue;
      const productJsonPath = join(
        vscodeServersDir,
        entry.name,
        "server",
        "product.json"
      );
      try {
        const content = await readFile(productJsonPath, "utf8");
        const parsed = JSON.parse(content) as { version?: string };
        if (parsed.version) versions.push({ commit, version: parsed.version });
      } catch {}
    }
    return versions.sort((a, b) => b.version.localeCompare(a.version));
  } catch {
    return [];
  }
}

export function getActiveServerById(id: string): VscodeServerSummary | null {
  const active = byId.get(id);
  if (!active) return null;
  return {
    cwd: active.cwd,
    id: active.id,
    commit: active.commit,
    port: active.port,
    pid: active.process.pid ?? 0,
  };
}

export function listActiveServers(): VscodeServerSummary[] {
  return [...byCwd.values()].map((active) => ({
    cwd: active.cwd,
    id: active.id,
    commit: active.commit,
    port: active.port,
    pid: active.process.pid ?? 0,
  }));
}

export async function stopVscodeServer(cwd: string): Promise<boolean> {
  const active = byCwd.get(cwd);
  if (!active) return false;
  cleanup(active);
  if (active.process.exitCode !== null || active.process.killed) return true;
  active.process.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => active.process.once("exit", () => resolve())),
    new Promise<void>((resolve) =>
      setTimeout(() => {
        if (active.process.exitCode === null) active.process.kill("SIGKILL");
        resolve();
      }, 2000)
    ),
  ]);
  return true;
}

function parsePort(line: string): number | null {
  const m =
    line.match(/127\.0\.0\.1:(\d+)/) ||
    line.match(/listening.*?(\d+)/i) ||
    line.match(/port\s+(\d+)/i);
  if (!m) return null;
  const port = Number(m[1]);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
  return port;
}

export async function startVscodeServer(
  cwd: string,
  commit: string
): Promise<VscodeServerSummary> {
  if (!cwd) throw new Error("cwd is required");
  if (!commit) throw new Error("commit is required");
  if (!/^[a-f0-9]+$/i.test(commit)) {
    throw new Error("commit must be a hex hash");
  }

  const existing = byCwd.get(cwd);
  if (existing) {
    if (existing.commit === commit && existing.process.exitCode === null) {
      return {
        cwd: existing.cwd,
        id: existing.id,
        commit: existing.commit,
        port: existing.port,
        pid: existing.process.pid ?? 0,
      };
    }
    await stopVscodeServer(cwd);
  }

  const binaryPath = getBinaryPath(commit);
  if (!existsSync(binaryPath)) {
    throw new Error(
      `VSCode binary not found: ${binaryPath}. Please install this commit first.`
    );
  }

  const id = getId(cwd);
  const basePath = getServerBasePath(id);
  const proc = spawn(
    binaryPath,
    [
      "serve-web",
      "--host",
      "127.0.0.1",
      "--port",
      "0",
      "--without-connection-token",
      "--accept-server-license-terms",
      "--server-base-path",
      basePath,
    ],
    { cwd, stdio: ["ignore", "pipe", "pipe"] }
  );

  const port = await new Promise<number>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Timed out waiting for VSCode server port"));
    }, 15000);
    const onData = (data: Buffer) => {
      const line = data.toString();
      const found = parsePort(line);
      if (!found) return;
      clearTimeout(timeout);
      resolve(found);
    };
    proc.stdout.on("data", onData);
    proc.stderr.on("data", onData);
    proc.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`VSCode server exited before ready (code=${code ?? -1})`));
    });
    proc.once("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  }).catch(async (err) => {
    proc.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 200));
    throw err;
  });

  const active: ActiveVscodeServer = { cwd, id, commit, port, process: proc };
  byCwd.set(cwd, active);
  byId.set(id, active);

  proc.once("exit", () => cleanup(active));
  proc.once("error", () => cleanup(active));

  return {
    cwd,
    id,
    commit,
    port,
    pid: proc.pid ?? 0,
  };
}

export function getInstallCommand(version?: string) {
  const scriptPath = "~/.agent-link/scripts/install-vscode-server.sh";
  const command = `mkdir -p ~/.agent-link/scripts && cat > ~/.agent-link/scripts/install-vscode-server.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
# Paste the VSCode Server install script content here.
echo "Please paste the VSCode Server install script content before running."
exit 1
EOF
chmod +x ~/.agent-link/scripts/install-vscode-server.sh`;

  const prompt = [
    "请帮我在这台机器准备 VSCode Server 安装脚本：",
    "1) 创建目录 ~/.agent-link/scripts",
    "2) 写入 ~/.agent-link/scripts/install-vscode-server.sh，内容使用 agent-link issue 中的安装脚本",
    "3) chmod +x ~/.agent-link/scripts/install-vscode-server.sh",
    version ? `4) 执行脚本并优先安装版本 ${version}` : "4) 执行脚本安装可用版本",
    "5) 完成后返回已安装 commit hash 和 version 对应关系",
  ].join("\n");

  return {
    scriptPath,
    command,
    prompt,
    note: "This command only creates a script template. Paste the full install script from the issue before executing it.",
  };
}
