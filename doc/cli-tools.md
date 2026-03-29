# CLI Introspection Tools

Agent Link includes CLI commands for inspecting and interacting with running agents. These are primarily designed for use by agents themselves (via `AGENT_LINK_AGENT_NAME` and `AGENT_LINK_URL`) and for operators.

## Authentication

All CLI commands automatically read the Bearer token from `$AGENT_LINK_HOME/auth.json` (default: `~/.agent-link/auth.json`). This is the same file the server writes when it starts. No manual token configuration is needed.

Override with environment variables:
- `AGENT_LINK_URL` — server URL (default: `http://localhost:3456`)
- `AGENT_LINK_TOKEN` — explicit token override

Or per-command: `--url http://other-host:3456`

## Commands

### `agent-link status`

Shows server info, auth state, connected nodes, and active session count.

```
Server: http://localhost:3456
Auth:   enabled
Mode:   panel (2 nodes online)

Nodes:
  ●  node-abc123  my-laptop  approved
  ○  node-def456  server     pending

Active sessions: 1
```

### `agent-link list`

Lists all managed agents in a table.

```
ACT NODE       NAME         BIO
● (local)    Code Helper  Backend refactoring agent
○ node-abc   Greeter      A friendly greeting agent
○ (local)    MathBot
```

### `agent-link inspect <name|id>...`

Shows full details for one or more agents. Matches by exact name, sessionId prefix, or partial name.

```
Name:      Greeter
Bio:       A friendly greeting agent
Session:   46fdcf5b-1202-48c7-bb95-209225ecf86c
Node:      (local)
CWD:       /home/user/project
Active:    no
Created:   3/29/2026, 8:00:16 PM
Params:    {"model":"claude-sonnet-4-6"}
```

### `agent-link send <name|id> <message>`

Sends a message to an agent and streams the response to stdout.

```sh
agent-link send "Code Helper" "summarize the changes in src/"
# [→ Code Helper] summarize the changes in src/
# The main changes are...
```

If `AGENT_LINK_AGENT_NAME` is set (i.e. called from inside an agent), the sender's name is shown:

```sh
AGENT_LINK_AGENT_NAME=Greeter agent-link send MathBot "what is 7*8?"
# [Greeter → MathBot] what is 7*8?
# 56
```

## Agent Identity

When a managed agent is created or resumes a session, `AGENT_LINK_AGENT_NAME=<name>` is automatically injected into the Claude session's environment variables. This lets the agent know its own name without requiring any manual configuration.

The env var is injected dynamically at query time from the stored agent name — not saved in the params — so renaming an agent takes effect on the next message.

## Node Local API

When running `agent-link node`, a local HTTP API server starts alongside the panel WS connection. This allows agents on the node machine to use all CLI commands locally:

```sh
# Node starts local API on 127.0.0.1:3456
agent-link node http://panel:3456

# From any agent process on this machine:
agent-link list              # reads AGENT_LINK_URL=http://localhost:3456 by default
agent-link send Greeter "hi"
```

With relay (`--accept-nodes`), the API and relay WS share the same port (bind changes to `0.0.0.0`):

```sh
agent-link node http://panel:3456 --accept-nodes --port 3457
# → local API on 0.0.0.0:3457
# → relay /ws/node on 0.0.0.0:3457 (for sub-nodes to connect)
```
