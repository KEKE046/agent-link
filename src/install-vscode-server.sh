#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   ./install-vscode-server.sh <version> [x64|arm64]
#
# Notes:
# - <version> is VS Code version, e.g. 1.112.0
# - optional arch: x64 / arm64
# - installs VS Code Server used by Remote-SSH style layout
# - not openvscode-server and not coder/code-server

VERSION="${1:-}"
ARCH_INPUT="${2:-}"

if [[ -z "${VERSION}" ]]; then
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
need_cmd uname
need_cmd mktemp
need_cmd chmod
need_cmd mkdir
need_cmd mv
need_cmd rm

detect_arch() {
  if [[ -n "${ARCH_INPUT}" ]]; then
    case "${ARCH_INPUT}" in
      x64|arm64)
        echo "${ARCH_INPUT}"
        return
        ;;
      *)
        echo "Unsupported ARCH: ${ARCH_INPUT}. Use x64 or arm64." >&2
        exit 1
        ;;
    esac
  fi

  local m
  m="$(uname -m)"
  case "${m}" in
    x86_64|amd64) echo "x64" ;;
    aarch64|arm64) echo "arm64" ;;
    *)
      echo "Unsupported machine architecture: ${m}" >&2
      exit 1
      ;;
  esac
}

extract_commit() {
  if command -v jq >/dev/null 2>&1; then
    jq -r '.version'
    return
  fi
  if command -v python3 >/dev/null 2>&1; then
    python3 -c "import json,sys
try:
  value = json.load(sys.stdin).get('version')
except Exception as e:
  print(f'Failed to parse metadata JSON: {e}', file=sys.stderr)
  sys.exit(1)
if not value:
  print('Missing version field in metadata JSON', file=sys.stderr)
  sys.exit(1)
print(value)"
    return
  fi
  sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1
}

ARCH="$(detect_arch)"
ROOT="${HOME}/.vscode-server"

METADATA_URL="https://update.code.visualstudio.com/api/versions/${VERSION}/linux-${ARCH}/stable"

echo "==> Resolving commit for VS Code ${VERSION} (${ARCH})"
COMMIT="$(curl -fsSL "${METADATA_URL}" | extract_commit)"

if [[ -z "${COMMIT}" || "${COMMIT}" == "null" ]]; then
  echo "Failed to resolve commit from: ${METADATA_URL}" >&2
  exit 1
fi

SERVER_URL="https://update.code.visualstudio.com/commit:${COMMIT}/server-linux-${ARCH}/stable"
CLI_URL="https://update.code.visualstudio.com/${VERSION}/cli-linux-${ARCH}/stable"

INSTALL_DIR="${ROOT}/cli/servers/Stable-${COMMIT}"
SERVER_DIR="${INSTALL_DIR}/server"
CODE_BINARY="${ROOT}/code-${COMMIT}"

TMPDIR="$(mktemp -d)"
cleanup() {
  rm -rf "${TMPDIR}"
}
trap cleanup EXIT

echo "==> Version : ${VERSION}"
echo "==> Commit  : ${COMMIT}"
echo "==> Root    : ${ROOT}"
echo "==> Target  : ${SERVER_DIR}"

mkdir -p "${SERVER_DIR}"
mkdir -p "${ROOT}"

SERVER_TGZ="${TMPDIR}/vscode-server-linux-${ARCH}.tar.gz"
CLI_TGZ="${TMPDIR}/vscode-cli-linux-${ARCH}.tar.gz"

echo "==> Downloading server tarball"
curl -fL "${SERVER_URL}" -o "${SERVER_TGZ}"

echo "==> Extracting server to ${SERVER_DIR}"
tar --no-same-owner -xf "${SERVER_TGZ}" -C "${SERVER_DIR}" --strip-components=1

echo "==> Downloading standalone CLI"
if curl -fL "${CLI_URL}" -o "${CLI_TGZ}"; then
  echo "==> Extracting CLI to ${ROOT}"
  tar --no-same-owner -xf "${CLI_TGZ}" -C "${ROOT}"

  if [[ -f "${ROOT}/code" ]]; then
    mv "${ROOT}/code" "${CODE_BINARY}"
    chmod +x "${CODE_BINARY}"
  elif [[ -f "${ROOT}/bin/code" ]]; then
    mv "${ROOT}/bin/code" "${CODE_BINARY}"
    chmod +x "${CODE_BINARY}"
  else
    echo "==> CLI archive extracted, but no expected 'code' binary found. Continuing."
  fi
else
  echo "==> CLI download failed; continuing with server only."
fi

if [[ -x "${SERVER_DIR}/bin/code-server" ]]; then
  ln -snf "${SERVER_DIR}/bin/code-server" "${ROOT}/current-code-server"
  echo "==> Linked ${ROOT}/current-code-server -> ${SERVER_DIR}/bin/code-server"
else
  echo "Server binary not found at ${SERVER_DIR}/bin/code-server" >&2
  exit 1
fi

echo
echo "Install complete."
echo "Resolved commit: ${COMMIT}"
echo "Server dir     : ${SERVER_DIR}"
echo "Server binary  : ${SERVER_DIR}/bin/code-server"
if [[ -f "${CODE_BINARY}" ]]; then
  echo "CLI binary     : ${CODE_BINARY}"
fi

echo
echo "Quick checks:"
echo "  ls -la '${ROOT}/cli/servers/Stable-${COMMIT}'"
echo "  '${SERVER_DIR}/bin/code-server' --help || true"
