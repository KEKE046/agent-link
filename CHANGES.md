# Agent Link - Changes

## v0.8.0

- Replaced sidebar New/Load buttons with contextual "+" on node headers
- Added "Add" modal with two tabs: Load Existing (browse with checkboxes) and New Session
- Added managed folders: folders persist in sidebar even without sessions
  - Backend: `ManagedFolder` type, `/api/managed-folders` CRUD endpoints
  - `groupedSessions` merges managed folders into sidebar tree
- Folder "…" context menu with Remove (removes folder + all sessions under it)
- Browse tab: already-managed sessions/folders shown as checked + disabled
- Smart folder clicks: 1 session → open directly, multiple → expand
- Single folder in browse results auto-expands
- Arrow (▸/▾) and folder name are separate click targets
- Session count `(N)` only shown when N > 1
- Unified sidebar action buttons (`.sidebar-btn` CSS, 24px, vertically aligned)
- Light theme: hover bg fix (`#f3f4f6` → `#e5e7eb`), sidebar button light-theme overrides
- Removed VSCode buttons, node approve, admin secret from frontend
- Removed `vscode-ui.js` from assets

## v0.7.0

- Refactored frontend into modular components: `app.js`, `sidebar.js`, `vscode-ui.js`, `renderer.js`
- `index.html` reduced from 1143 to ~285 lines — pure HTML skeleton, zero inline CSS/JS
- Moved all inline styles to `tailwind.input.css`
- Component communication via `emit()` global events, zero implicit method coupling
  - sidebar → app: `session-switch`, `session-new`, `session-remove`, `session-add`
  - sidebar → vscode: `vscode-open`, `vscode-stop`
  - any → app: `data-refresh`
  - app → sidebar: reactive state (`currentId`, `managed`, `activeSet`, etc.)
- Sidebar auto-expands groups via `$watch('currentId')`, no event bridge needed
- Unified sidebar template: panel and standalone share same rendering (standalone = single `(local)` node)
- Extracted VSCode modal into independent `vscode-ui.js` component
- Added `src/assets.ts` — centralized embed declarations for `bun build --compile`
- Replaced per-file static routes with single wildcard handler in `server.ts`
  - Dev mode: `Bun.file()` auto Content-Type, zero config when adding files
  - Prod mode: embedded asset map lookup

## v0.6.0

- Added Panel+Node distributed architecture: Panel (public) forwards all operations to Nodes (behind NAT) via WebSocket
- Added `src/protocol.ts` shared WS protocol types between Panel and Node
- Added `src/panel/server.ts` — Panel HTTP server with same API surface, forwarding to connected Nodes
- Added `src/panel/nodes.ts` — Node pool management, token auth, session event relay, heartbeat
- Added `src/panel/tunnel.ts` — HTTP/WS tunnel for VSCode reverse proxy through Node management WS
- Added `src/node/main.ts` + `connector.ts` — Node entry point with WS auto-reconnect (exponential backoff 1s→60s)
- Added `src/node/tunnel.ts` — Local VSCode HTTP/WS tunnel handler
- Frontend auto-detects Panel mode via `/api/nodes` endpoint
- Sidebar groups by Node → CWD → Session with online/offline indicators (●/○)
- Node selector dropdown in header bar for new session target
- Session API calls pass `nodeId` for routing (query param, header, or request body)
- Load modal aggregates sessions from all online Nodes
- VSCode tunnel URL includes nodeId dimension: `/vscode/<nodeId>/<encoded-cwd>/`
- `remoteAuthority` rewrite at Panel side (Node unchanged)
- Standalone `src/server.ts` preserved, no regressions when running without Panel
- Added build scripts: `dev:panel`, `dev:node`, `build:panel`, `build:node`, `build:binary:panel`, `build:binary:node`

## v0.5.0

- Added per-cwd VSCode Server integration in sidebar with start/open and stop controls
- Added Bun-native `/vscode/<encoded-cwd>/` reverse proxy with WebSocket forwarding
- Added HTML `remoteAuthority` rewrite so VSCode web + WS traffic stays on proxy endpoint
- Added VSCode modal with dual tabs:
  - 启动: installed-version selection + start
  - 安装: version input (default `1.112.0`), full install script, copyable install command, and session prompt text
- Added backend `/api/vscode/*` routes for version discovery, lifecycle, active list, and install guidance payload

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
