#!/usr/bin/env bash
set -e

REPO="KEKE046/agent-link"
INSTALL_DIR="${AGENT_LINK_INSTALL_DIR:-$HOME/.local/bin}"

# Detect OS and architecture
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case "$OS" in
  linux)
    case "$ARCH" in
      x86_64)        TARGET="agent-link-linux-x64" ;;
      aarch64|arm64) TARGET="agent-link-linux-arm64" ;;
      *) echo "Unsupported architecture: $ARCH" >&2; exit 1 ;;
    esac
    ;;
  darwin)
    case "$ARCH" in
      x86_64) TARGET="agent-link-darwin-x64" ;;
      arm64)  TARGET="agent-link-darwin-arm64" ;;
      *) echo "Unsupported architecture: $ARCH" >&2; exit 1 ;;
    esac
    ;;
  *)
    echo "Unsupported OS: $OS" >&2
    exit 1
    ;;
esac

URL="https://github.com/${REPO}/releases/latest/download/${TARGET}"

echo "Installing agent-link ($TARGET)..."
mkdir -p "$INSTALL_DIR"
curl -fsSL "$URL" -o "$INSTALL_DIR/agent-link"
chmod +x "$INSTALL_DIR/agent-link"

echo ""
echo "Installed: $INSTALL_DIR/agent-link"
echo ""

# PATH hint if needed
if ! echo "$PATH" | grep -q "$INSTALL_DIR"; then
  echo "Add to your shell profile:"
  echo "  export PATH=\"\$HOME/.local/bin:\$PATH\""
  echo ""
fi

echo "Run: agent-link server"
