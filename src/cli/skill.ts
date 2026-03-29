export const SKILL_MARKDOWN = `\
# agent-link

You are running inside an **agent-link** managed session — a multi-agent coordination system built on Claude Code.

## Your Identity

Two environment variables are injected into your session automatically:

- \`AGENT_LINK_AGENT_NAME\` — your agent name (e.g. \`Greeter\`)
- \`AGENT_LINK_URL\` — local API server (default: \`http://localhost:3456\`)

Authentication is automatic: \`agent-link\` reads \`~/.agent-link/auth.json\` without any extra setup.

## CLI Cheatsheet

\`\`\`sh
agent-link status                    # server info, nodes, active sessions
agent-link list                      # table of all managed agents
agent-link inspect <name|id>         # details + last message (default)
agent-link inspect <name|id> -n 5   # details + last 5 messages
agent-link inspect <name|id> -n 0   # details only, no messages
agent-link send <name|id> <message>  # send message, stream response to stdout
agent-link bio [name|id]             # ask agent to write its one-line bio (saves it)
agent-link intro [name|id]           # ask agent to write its intro paragraph (saves it)
\`\`\`

Names are matched case-insensitively; exact name wins over prefix match.

## Sending Messages to Other Agents

\`\`\`sh
agent-link send CodeHelper "review src/main.ts for correctness"
\`\`\`

Your name appears in the header automatically:

\`\`\`
[Greeter → CodeHelper] review src/main.ts for correctness

The function on line 42 has an off-by-one error...
\`\`\`

To send without waiting for the response (fire and forget):

\`\`\`sh
agent-link send Logger "task started: refactor auth module" &
\`\`\`

## Reading the Agent List

\`\`\`
ACT  NODE       NAME         BIO
●    (local)    CodeHelper   Backend refactoring agent
○    node-abc   Greeter
○    (local)    Logger       Audit log writer
\`\`\`

- \`●\` = active (processing); \`○\` = idle (ready for messages)
- NODE = which machine; \`(local)\` = same machine as server
- Only send to idle agents unless you intend to queue work

## Inspecting an Agent

\`\`\`sh
agent-link inspect CodeHelper         # details + last message
agent-link inspect CodeHelper -n 5    # details + last 5 messages
agent-link inspect CodeHelper -n 0    # details only
# Name:    CodeHelper
# Bio:     Backend refactoring agent
# Session: 46fdcf5b-...
# Node:    (local)
# CWD:     /home/user/project
# Active:  no
# ── last message ────────────────────────
# [asst]  The refactor is complete. 3 files changed.
\`\`\`

Use the session ID to reference the exact agent when name collisions exist.

## Agent Bio and Intro

Each agent has two optional self-description fields:

- **bio** — one sentence: what problems to bring to this agent
- **intro** — 2-4 sentences: deeper self-description

To generate and save your own (the model writes it based on its own context):

\`\`\`sh
agent-link bio      # uses AGENT_LINK_AGENT_NAME to find yourself
agent-link intro
\`\`\`

Or for another agent:

\`\`\`sh
agent-link bio CodeHelper
agent-link intro CodeHelper
\`\`\`

Bio is visible in \`agent-link list\`. Both are visible in \`agent-link inspect\`.

## Architecture (brief)

- **Server mode**: web UI + API on port 3456
- **Node mode**: connects to a remote panel + starts local API on 127.0.0.1:3456
- **Relay mode**: node + accepts sub-nodes on the same port

You are most likely on a node. \`agent-link status\` shows your connection and the full network.

## Gotchas

- \`agent-link send\` streams until the target is idle — it blocks. Use \`&\` for background sends.
- If the target agent is currently active (\`●\`), your message queues behind the current work.
- Name matching is first-exact-then-partial. If two agents share a name prefix, send to the full name or session ID to be precise.
- \`AGENT_LINK_AGENT_NAME\` is injected at query time from the stored name — not from env you set yourself. Renaming an agent in the UI takes effect on the next message.
- Bio is optional and cosmetic; it has no effect on routing or behavior.
- \`agent-link send\` exits 1 if the agent is not found or the API returns an error. Check \`agent-link list\` first.
`;

export async function runSkill(_args: string[]) {
  process.stdout.write(SKILL_MARKDOWN);
}
