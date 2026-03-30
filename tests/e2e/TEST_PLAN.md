# E2E Test Plan

Tech: `bun:test` + Playwright library API
Server: in-process mock (inject mockClaudeSdk via `setClaudeSdk`)
Isolation: per-file random port + temp `AGENT_LINK_HOME`, per-test `BrowserContext`

## P0 — Core Flow

1. **Page load** — empty state visible, header shows "Agent Link"
2. **Create Agent** — sidebar ... → Add Agent → fill name/cwd → Create → appears in sidebar
3. **Send message & receive reply** — input → Send → user msg + assistant reply visible → status idle
4. **Switch agent** — create 2 agents → click to switch → message area changes
5. **Delete agent** — agent ... → Remove → confirm → gone from sidebar

## P1 — Important Interactions

6. Send follow-up message (resume session)
7. Interrupt session (Stop button)
8. Sidebar collapse/expand
9. Theme toggle (dark/light)
10. Folder management (add/rename/remove)

## P2 — Config & Details

11. Agent config panel (model/thinking/effort)
12. Create-time config (system prompt, env)
13. Bio / Intro editing
14. Load existing session

## P3 — Auth

15. No-auth mode (--no-auth)
16. Auth mode (token login flow)
