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
  if (!/^[a-f0-9]{7,40}$/i.test(commit)) {
    throw new Error("commit must be a 7-40 char hex hash");
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

/**
 * Build install-script guidance for the frontend.
 * Returns script path, shell command template, and copy-paste prompt text.
 */
export function getInstallCommand(version?: string) {
  const resolvedVersion = version || "1.112.0";
  const installScript = `#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   ./install-vscode-server.sh <version> [x64|arm64]
#
# Notes:
# - <version> is VS Code version, e.g. 1.112.0
# - optional arch: x64 / arm64
# - installs VS Code Server used by Remote-SSH style layout
# - not openvscode-server and not coder/code-server

VERSION="\${1:-}"
ARCH_INPUT="\${2:-}"

if [[ -z "\${VERSION}" ]]; then
  echo "Usage: $0 <version> [x64|arm64]"
  exit 1
fi

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

need_cmd curl
need_cmd tar
need_cmd jq
need_cmd uname
need_cmd mktemp
need_cmd chmod
need_cmd mkdir
need_cmd mv
need_cmd rm

detect_arch() {
  if [[ -n "\${ARCH_INPUT}" ]]; then
    case "\${ARCH_INPUT}" in
      x64|arm64)
        echo "\${ARCH_INPUT}"
        return
        ;;
      *)
        echo "Unsupported ARCH: \${ARCH_INPUT}. Use x64 or arm64." >&2
        exit 1
        ;;
    esac
  fi

  local m
  m="$(uname -m)"
  case "\${m}" in
    x86_64|amd64) echo "x64" ;;
    aarch64|arm64) echo "arm64" ;;
    *)
      echo "Unsupported machine architecture: \${m}" >&2
      exit 1
      ;;
  esac
}

ARCH="$(detect_arch)"
ROOT="\${HOME}/.vscode-server"

METADATA_URL="https://update.code.visualstudio.com/api/versions/\${VERSION}/linux-\${ARCH}/stable"

echo "==> Resolving commit for VS Code \${VERSION} (\${ARCH})"
COMMIT="$(curl -fsSL "\${METADATA_URL}" | jq -r '.version')"

if [[ -z "\${COMMIT}" || "\${COMMIT}" == "null" ]]; then
  echo "Failed to resolve commit from: \${METADATA_URL}" >&2
  exit 1
fi

SERVER_URL="https://update.code.visualstudio.com/commit:\${COMMIT}/server-linux-\${ARCH}/stable"
CLI_URL="https://update.code.visualstudio.com/\${VERSION}/cli-linux-\${ARCH}/stable"

INSTALL_DIR="\${ROOT}/cli/servers/Stable-\${COMMIT}"
SERVER_DIR="\${INSTALL_DIR}/server"
CODE_BINARY="\${ROOT}/code-\${COMMIT}"

TMPDIR="$(mktemp -d)"
cleanup() {
  rm -rf "\${TMPDIR}"
}
trap cleanup EXIT

echo "==> Version : \${VERSION}"
echo "==> Commit  : \${COMMIT}"
echo "==> Root    : \${ROOT}"
echo "==> Target  : \${SERVER_DIR}"

mkdir -p "\${SERVER_DIR}"
mkdir -p "\${ROOT}"

SERVER_TGZ="\${TMPDIR}/vscode-server-linux-\${ARCH}.tar.gz"
CLI_TGZ="\${TMPDIR}/vscode-cli-linux-\${ARCH}.tar.gz"

echo "==> Downloading server tarball"
curl -fL "\${SERVER_URL}" -o "\${SERVER_TGZ}"

echo "==> Extracting server to \${SERVER_DIR}"
tar --no-same-owner -xf "\${SERVER_TGZ}" -C "\${SERVER_DIR}" --strip-components=1

echo "==> Downloading standalone CLI"
if curl -fL "\${CLI_URL}" -o "\${CLI_TGZ}"; then
  echo "==> Extracting CLI to \${ROOT}"
  tar --no-same-owner -xf "\${CLI_TGZ}" -C "\${ROOT}"

  if [[ -f "\${ROOT}/code" ]]; then
    mv "\${ROOT}/code" "\${CODE_BINARY}"
    chmod +x "\${CODE_BINARY}"
  elif [[ -f "\${ROOT}/bin/code" ]]; then
    mv "\${ROOT}/bin/code" "\${CODE_BINARY}"
    chmod +x "\${CODE_BINARY}"
  else
    echo "==> CLI archive extracted, but no expected 'code' binary found. Continuing."
  fi
else
  echo "==> CLI download failed; continuing with server only."
fi

if [[ -x "\${SERVER_DIR}/bin/code-server" ]]; then
  ln -snf "\${SERVER_DIR}/bin/code-server" "\${ROOT}/current-code-server"
  echo "==> Linked \${ROOT}/current-code-server -> \${SERVER_DIR}/bin/code-server"
else
  echo "Server binary not found at \${SERVER_DIR}/bin/code-server" >&2
  exit 1
fi

echo
echo "Install complete."
echo "Resolved commit: \${COMMIT}"
echo "Server dir     : \${SERVER_DIR}"
echo "Server binary  : \${SERVER_DIR}/bin/code-server"
if [[ -f "\${CODE_BINARY}" ]]; then
  echo "CLI binary     : \${CODE_BINARY}"
fi

echo
echo "Quick checks:"
echo "  ls -la '\${ROOT}/cli/servers/Stable-\${COMMIT}'"
echo "  '\${SERVER_DIR}/bin/code-server' --help || true"`;
  const scriptPath = "~/.agent-link/scripts/install-vscode-server.sh";
  const command = `mkdir -p ~/.agent-link/scripts && cat > ~/.agent-link/scripts/install-vscode-server.sh <<'EOF'
${installScript}
EOF
chmod +x ~/.agent-link/scripts/install-vscode-server.sh
~/.agent-link/scripts/install-vscode-server.sh ${resolvedVersion}`;

  const prompt = [
    "请帮我在这台机器安装 VSCode Server：",
    "1) 创建目录 ~/.agent-link/scripts",
    "2) 写入 ~/.agent-link/scripts/install-vscode-server.sh，内容使用下面给出的完整脚本",
    "3) chmod +x ~/.agent-link/scripts/install-vscode-server.sh",
    `4) 执行 ~/.agent-link/scripts/install-vscode-server.sh ${resolvedVersion}`,
    "5) 完成后返回已安装 commit hash 和 version 对应关系",
  ].join("\n");

  return {
    scriptPath,
    script: installScript,
    command,
    prompt,
    version: resolvedVersion,
    note: "Copy the prompt to an Agent Link session to install automatically, or copy the command directly in shell.",
  };
}
