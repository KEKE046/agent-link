# agent-link

Web UI for [Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview) in the browser. Create named agents, manage sessions, and coordinate multi-agent workflows across machines.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/KEKE046/agent-link/main/install.sh | bash
```

Installs to `~/.local/bin/agent-link`. Override with `AGENT_LINK_INSTALL_DIR=/usr/local/bin`.

Supported platforms: Linux x64/arm64, macOS x64/arm64.

## Quick Start

```bash
# Start the web UI
agent-link server

# Open http://localhost:3456 in your browser
```

Create agents in the sidebar, chat with Claude Code sessions, and use the CLI to inspect and send messages between agents.

## CLI Tools

Once agents are running, interact with them from the command line:

```bash
agent-link status                    # server info and connected nodes
agent-link list                      # all managed agents with status
agent-link inspect <name>            # agent details + last message
agent-link send <name> <message>     # send a message, stream the response

agent-link bio                       # agent writes its own one-line bio
agent-link intro                     # agent writes its own intro paragraph
```

CLI commands authenticate automatically via `~/.agent-link/auth.json`.

## Multi-machine Setup

agent-link supports a panel + node architecture for running agents across machines:

```bash
# Panel: server with a reachable IP
agent-link server --accept-nodes

# Node: any machine, connects outbound (no firewall changes needed)
agent-link node http://PANEL_IP:3456 --name my-laptop
```

For detailed setup scenarios (SSH tunnels, relay nodes, systemd services):

```bash
agent-link skill --setup
```

## Agent Coordination

Agents discover and message each other using the CLI:

```bash
agent-link skill       # inter-agent cheatsheet, inject this into an agent's context
```

Each agent automatically receives its name as `AGENT_LINK_AGENT_NAME` in its Claude session environment.

## Build from Source

Requires [Bun](https://bun.sh).

```bash
git clone https://github.com/KEKE046/agent-link
cd agent-link
bun install
bun run dev          # development server with hot reload
bun run build:binary # compile single binary → dist/agent-link
```
