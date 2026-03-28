# Panel + Node Architecture

## Overview

Agent Link supports a distributed mode where a **Panel** (public server) connects to one or more **Nodes** (behind NAT/firewall). The browser only talks to the Panel; all operations are forwarded to Nodes via WebSocket.

```
Browser <--HTTP/SSE--> Panel (public) <--WebSocket--> Node (NAT)
                                      <--WebSocket--> Node (NAT)
```

## Running

### Standalone (no Panel)

```sh
bun run dev          # same as before, port 3456
```

### Panel + Node

```sh
# 1. Start Panel
PANEL_PORT=3457 bun run dev:panel

# 2. Start Node(s)
PANEL_URL=http://localhost:3457 NODE_LABEL=my-node bun run dev:node
# Node first boot creates ~/.agent-link/node-key and stays pending until approved
```

## Connection Flow

1. Node starts with `PANEL_URL`; first start creates `~/.agent-link/node-key` (8 chars)
2. Node connects WebSocket to `Panel/ws/node` and sends `register { key, label }`
3. Panel stores/reuses key record in `~/.agent-link/nodes.json`
4. If node not approved, Panel replies `pending` and keeps WS connected
5. Admin approves via `POST /api/nodes/:nodeId/approve`, Panel replies `registered { nodeId }`
6. Node sends periodic `heartbeat { activeSessionIds, vscodeServers }` every 10s
7. Panel pings every 30s to keep connection alive
8. On disconnect, Node auto-reconnects with exponential backoff (1s -> 2s -> 4s -> ... -> 60s)

## WS Protocol

### Node -> Panel

| Message | Fields | Purpose |
|---------|--------|---------|
| `register` | key, label | Initial auth |
| `heartbeat` | activeSessionIds, vscodeServers | Status update |
| `event` | sessionId, event | Forward SDK events to Panel SSE |
| `response` | requestId, data | Reply to Panel request |
| `error` | requestId, error | Error reply |
| `tunnel:response` | tunnelId, status, headers, body, isHtml? | HTTP tunnel response |
| `tunnel:ws-opened` | tunnelId | WS tunnel connected upstream |
| `tunnel:ws-data` | tunnelId, data, binary? | WS tunnel frame |
| `tunnel:ws-close` | tunnelId, code? | WS tunnel close |

### Panel -> Node

| Message | Fields | Purpose |
|---------|--------|---------|
| `registered` | nodeId | Auth success |
| `pending` | | Waiting for admin approval |
| `request` | requestId, action, params | Forward API call |
| `ping` | | Keep-alive |
| `tunnel:request` | tunnelId, method, path, headers, body? | HTTP tunnel request |
| `tunnel:ws-open` | tunnelId, path, headers | WS tunnel open |
| `tunnel:ws-data` | tunnelId, data, binary? | WS tunnel frame |
| `tunnel:ws-close` | tunnelId, code? | WS tunnel close |

## Request Actions

The `request` message supports these actions, mapping 1:1 to the existing API:

| Action | Params | Maps to |
|--------|--------|---------|
| `query` | prompt, cwd, model, sessionId? | `POST /api/query` |
| `interrupt` | sessionId | `POST /api/interrupt/:id` |
| `setModel` | sessionId, model | `POST /api/model/:id` |
| `listSessions` | cwd?, limit?, offset? | `GET /api/sessions` |
| `getSessionInfo` | sessionId, cwd? | `GET /api/sessions/:id` |
| `getSessionMessages` | sessionId, cwd?, limit?, offset? | `GET /api/sessions/:id/messages` |
| `listVscodeVersions` | | `GET /api/vscode/versions` |
| `startVscodeServer` | cwd, commit | `POST /api/vscode/start` |
| `stopVscodeServer` | cwd | `POST /api/vscode/stop` |
| `getInstallCommand` | version? | `GET /api/vscode/install-command` |

## VSCode Tunnel

All VSCode traffic goes through the Node's management WebSocket (no direct network access needed).

**URL format**: `/vscode/<nodeId>/<encoded-cwd>/...`

**HTTP flow**:
1. Browser -> Panel: `GET /vscode/node1/xxx/static/...`
2. Panel sends `tunnel:request` to Node via WS
3. Node fetches from local VSCode serve-web (`127.0.0.1:<port>`)
4. Node sends `tunnel:response` back via WS
5. Panel rewrites `remoteAuthority` in HTML responses to Panel's public address
6. Panel returns response to browser

**WebSocket flow**:
1. Browser upgrades WS at `/vscode/node1/xxx/...`
2. Panel upgrades browser side, sends `tunnel:ws-open` to Node
3. Node connects local VSCode WS, sends `tunnel:ws-opened`
4. Bidirectional: browser frames <-> Panel <-> `tunnel:ws-data` <-> Node <-> local WS
5. Close: `tunnel:ws-close` notifies the other end

## Frontend Behavior

- Auto-detects Panel mode by probing `GET /api/nodes`
- Panel mode: sidebar groups by Node -> CWD -> Session (3 levels)
- Pending nodes are visible in sidebar and can be approved/renamed from UI
- Standalone mode: sidebar groups by CWD -> Session (2 levels, unchanged)
- Node online/offline shown with green/gray dot
- Offline node sessions shown at 50% opacity
- Node selector dropdown in header for choosing target node on new sessions
- All API calls include `nodeId` via query param, header (`x-node-id`), or request body

## File Structure

```
src/
  protocol.ts       -- Shared WS message types
  panel/
    server.ts       -- Hono routes (same API surface), WS upgrade for nodes + tunnels
    nodes.ts        -- Node pool, key+approve auth, request/response routing, event relay
    tunnel.ts       -- HTTP/WS tunnel manager, remoteAuthority rewrite
  node/
    main.ts         -- Entry point (PANEL_URL + local ~/.agent-link/node-key)
    connector.ts    -- WS connection, auto-reconnect, request dispatch, event forwarding
    tunnel.ts       -- Local fetch/WS for tunnel:request and tunnel:ws-*
  server.ts         -- Standalone server (unchanged)
  sessions.ts       -- Session lifecycle (used by both standalone and node)
  vscode.ts         -- VSCode serve-web lifecycle (used by both standalone and node)
```
