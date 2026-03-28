# Agent Link - Changes

## v0.4.0

- Backend supports unified single-binary build via Bun `--compile`
- Frontend static assets are imported and bundled into backend binary
- Added build scripts: `bun run build` and `bun run build:binary`

## v0.3.0

- Message rendering extracted to Alpine.js component (`renderer.js`)
- Tool uses grouped per turn: all tools between user prompts merge into one "N tools" section
- Tool output collapsible on the tool line itself (no separate nested output element)
- Tool results inlined under their corresponding tool_use via `data-tool-id` matching
- Tool-specific rendering: Bash (`$ cmd`), Read/Write/Edit (file path), Grep/Glob (pattern), etc.
- Collapsible groups: ≤5 tools open, >5 collapsed; short output auto-expands
- Parent-child communication via window events (`msg:load`, `msg:append`, `msg:stream`, etc.)
- Session switch performance: ~50-120ms for 38-200 messages (was ~1200ms)
- Bun `idleTimeout` set to 120s to prevent SSE connection drops
- Fixed EventSource auto-reconnect for stale sessions
- Fixed horizontal scrollbar overflow in message area
- Markdown render cache for repeated text blocks

## v0.2.0

- Sidebar sessions grouped by cwd with collapsible expand/collapse
- Load modal sessions grouped by cwd, shows all sessions by default
- Groups auto-expand when creating, loading, or switching to a session
- "+ New" clears view immediately; session created on first send
- Status bar shows full session ID without truncation
- Load more button only appears when more results may exist
- Fix: append mode error no longer clears loaded sessions
- Added `/release` workspace command for changelog + commit

## v0.1.0

- Web UI for Claude Code via browser (Alpine.js + Tailwind CSS)
- Backend on Bun + Hono, port 3456
- Session management: create, resume, switch, interrupt
- SSE real-time event streaming with buffer replay
- UUID dedup to prevent duplicate messages on session switch
- Managed sessions stored in localStorage with sidebar
- Load modal to browse and import existing Claude Code sessions
- Model switching (Sonnet 4.6, Opus 4.6, Haiku 4.5)
- Configurable working directory per session
- Streaming display with live typing cursor
- Tool use display (name + input preview)
- Markdown rendering (marked.js) for assistant messages
- Status bar with cost, token usage, session ID
- "+ New" button clears view for natural new session flow
