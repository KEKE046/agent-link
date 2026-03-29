#!/usr/bin/env bun
// Unified entry point for Agent Link.
//
// Modes:
//   agent-link                           → standalone (local node + HTTP)
//   agent-link --accept-nodes            → local node + HTTP + accept remote nodes
//   agent-link --accept-nodes --no-local → pure router (no local SDK)
//   agent-link --connect-to <url>        → node only (connect to remote panel)

import { getMachineId } from "./identity";
import { initAuth, verifyCookie, isEnabled as authEnabled } from "./auth";
import { Router } from "./router";
import { createApp } from "./routes";
import { getActiveServerById } from "./vscode";

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`Usage: agent-link [options]

  --port <n>          HTTP port (default: 3456)
  --accept-nodes      Accept remote node connections via WebSocket
  --no-local          Don't run local Claude SDK (router-only, requires --accept-nodes)
  --connect-to <url>  Run as node, connect to remote panel
                      Can combine with --accept-nodes to relay sub-nodes
  --name <name>       Node display name (default: machine ID)
  --token <value>     Admin token for panel auth (auto-generated if omitted)
  --no-auth           Disable auth even in panel mode (for testing)
  --help              Show this help`);
  process.exit(0);
}

const acceptNodes = args.includes("--accept-nodes");
const noLocal = args.includes("--no-local");
const connectTo = getArg("--connect-to");
const port = parseInt(getArg("--port") || "3456");
const tokenArg = getArg("--token");
const noAuth = args.includes("--no-auth");

function getArg(flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

if (noLocal && !acceptNodes && !connectTo) {
  console.error("Error: --no-local requires --accept-nodes");
  process.exit(1);
}

if (connectTo) {
  // ---- Node-only mode ----
  const machineId = getMachineId();
  const label = getArg("--name") || Bun.env.NODE_LABEL || machineId;
  console.log(`[node] Machine ID: ${machineId}`);
  console.log(`[node] Name: ${label}`);
  console.log(`[node] Connecting to: ${connectTo}`);

  const { connect } = await import("./node/connector");
  connect(connectTo, machineId, label);

  if (acceptNodes) {
    const { startRelay } = await import("./node/relay");
    startRelay(connectTo, port);
  }
} else {
  // ---- Server mode ----
  const localId = noLocal ? null : getMachineId();
  const router = new Router(localId);

  // Enable auth in panel mode (accept-nodes), unless --no-auth
  if (acceptNodes && !noAuth) {
    const token = initAuth(tokenArg);
    console.log(`[server] Admin token: ${token}`);
    console.log(`[server] Login URL: http://localhost:${port}/login?token=${token}`);
  }

  // Conditionally load panel modules
  let panelNodes: typeof import("./panel/nodes") | null = null;
  let panelTunnel: typeof import("./panel/tunnel") | null = null;

  if (acceptNodes) {
    panelNodes = await import("./panel/nodes");
    panelTunnel = await import("./panel/tunnel");
    router.setRemoteProvider({
      requestNode: panelNodes.requestNode,
      subscribeSession: panelNodes.subscribeSession,
      listNodes: panelNodes.listNodes,
      findNodeForSession: panelNodes.findNodeForSession,
      clearEventBuffer: panelNodes.clearEventBuffer,
      approveNode: panelNodes.approveNode,
      renameNode: panelNodes.renameNode,
    });
  }

  const app = createApp(router);

  const mode = noLocal ? "router-only" : acceptNodes ? "local + remote" : "standalone";
  console.log(`[server] Mode: ${mode}`);
  if (localId) console.log(`[server] Machine ID: ${localId}`);
  console.log(`[server] Listening on port ${port}`);

  // --- VSCode reverse proxy helpers ---

  const HOP_HEADERS = new Set([
    "host", "connection", "keep-alive", "transfer-encoding",
    "upgrade", "proxy-authorization", "proxy-authenticate", "te", "trailers",
  ]);

  function proxyHeaders(req: Request, extra?: Record<string, string>): Headers {
    const h = new Headers();
    for (const [k, v] of req.headers) {
      if (!HOP_HEADERS.has(k)) h.set(k, v);
    }
    if (extra) for (const [k, v] of Object.entries(extra)) h.set(k, v);
    return h;
  }

  function rewriteRemoteAuthority(html: string, authority: string): string {
    return html
      .replace(/("remoteAuthority"\s*:\s*")[^"]+(")/, `$1${authority}$2`)
      .replace(/(&quot;remoteAuthority&quot;\s*:\s*&quot;)[^&]+(&quot;)/, `$1${authority}$2`);
  }

  function vscodeTarget(req: Request, proxyPort: number): string {
    const u = new URL(req.url);
    u.protocol = "http:";
    u.hostname = "127.0.0.1";
    u.port = String(proxyPort);
    return u.toString();
  }

  // --- Bun server ---

  interface SocketData {
    type: "node" | "vscode" | "tunnel";
    nodeId?: string;
    tunnelId?: string;
    tunnelPath?: string;
    tunnelHeaders?: Record<string, string>;
    target?: string;   // VSCode WS upstream target URL
    upstream?: WebSocket;
  }

  Bun.serve({
    port,
    idleTimeout: 120,
    fetch: async (req: Request, server: any) => {
      const url = new URL(req.url);

      // Node WS connection endpoint
      if (acceptNodes && panelNodes && url.pathname === "/ws/node") {
        if (server.upgrade(req, { data: { type: "node" } satisfies SocketData })) return undefined;
        return new Response("WebSocket upgrade failed", { status: 500 });
      }

      // VSCode reverse proxy (auth-protected when enabled)
      if (url.pathname.startsWith("/vscode/")) {
        if (authEnabled() && !(await verifyCookie(req.headers.get("cookie")))) {
          return new Response("Unauthorized", { status: 401 });
        }
        if (acceptNodes && panelNodes && panelTunnel) {
          return handleVscodeMultiNode(req, server, url, panelNodes, panelTunnel, router);
        }
        return handleVscodeStandalone(req, server, url);
      }

      return app.fetch(req);
    },
    websocket: {
      open(ws: any) {
        const data = ws.data as SocketData;
        if (data.type === "vscode" && data.target) {
          const upstream = new WebSocket(data.target);
          data.upstream = upstream;
          upstream.addEventListener("message", (e: MessageEvent) => {
            try { ws.send(typeof e.data === "string" ? e.data : new Uint8Array(e.data)); } catch {}
          });
          upstream.addEventListener("close", () => { try { ws.close(); } catch {} });
          upstream.addEventListener("error", () => { try { ws.close(); } catch {} });
        }
        if (data.type === "tunnel" && data.nodeId && data.tunnelPath && panelTunnel) {
          data.tunnelId = panelTunnel.tunnelWsOpen(data.nodeId, ws, data.tunnelPath, data.tunnelHeaders || {});
        }
      },
      message(ws: any, message: string | Buffer) {
        const data = ws.data as SocketData;
        if (data.type === "node" && panelNodes) {
          if (!data.nodeId) {
            // First message: register
            try {
              const msg = JSON.parse(typeof message === "string" ? message : new TextDecoder().decode(message));
              if (msg.type === "register") {
                const reg = panelNodes.registerNode(ws, msg.machineId, msg.label);
                data.nodeId = reg.nodeId;
                ws.send(JSON.stringify(
                  reg.approved
                    ? { type: "registered", nodeId: reg.nodeId }
                    : { type: "pending" }
                ));
                console.log(`[panel] Node ${reg.approved ? "registered" : "pending"}: ${reg.nodeId} (${msg.label})`);
              }
            } catch {}
            return;
          }
          panelNodes.handleNodeMessage(data.nodeId, typeof message === "string" ? message : new TextDecoder().decode(message));
        } else if (data.type === "vscode") {
          const u = data.upstream as WebSocket | undefined;
          if (u?.readyState === WebSocket.OPEN) u.send(message);
        } else if (data.type === "tunnel" && data.tunnelId && panelTunnel) {
          panelTunnel.tunnelWsSendToNode(data.tunnelId, message);
        }
      },
      close(ws: any) {
        const data = ws.data as SocketData;
        if (data.type === "node" && data.nodeId && panelNodes) {
          panelNodes.markOffline(data.nodeId);
          console.log(`[panel] Node disconnected: ${data.nodeId}`);
        } else if (data.type === "vscode") {
          const u = data.upstream as WebSocket | undefined;
          if (u && u.readyState !== WebSocket.CLOSED) u.close();
        } else if (data.type === "tunnel" && data.tunnelId && panelTunnel) {
          panelTunnel.tunnelWsClose(data.tunnelId);
        }
      },
    },
  });

  // --- VSCode proxy: standalone mode (/vscode/<id>/...) ---

  async function handleVscodeStandalone(req: Request, server: any, url: URL): Promise<Response | undefined> {
    const id = url.pathname.split("/")[2] || "";
    const active = getActiveServerById(id);
    if (!active) return new Response("VSCode server not found", { status: 404 });

    const target = vscodeTarget(req, active.port);

    if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
      const ok = server.upgrade(req, {
        data: { type: "vscode", target: target.replace("http:", "ws:") } satisfies SocketData,
      });
      return ok ? undefined : new Response("WebSocket upgrade failed", { status: 500 });
    }

    if (req.method === "GET" && req.headers.get("accept")?.includes("text/html")) {
      const resp = await fetch(target, {
        method: "GET",
        headers: proxyHeaders(req, { "accept-encoding": "identity" }),
        redirect: "manual",
      });
      if (resp.headers.get("content-type")?.includes("text/html")) {
        const authority = req.headers.get("x-forwarded-host") || req.headers.get("host") || "localhost";
        const html = rewriteRemoteAuthority(await resp.text(), authority);
        const h = new Headers(resp.headers);
        h.delete("content-length");
        return new Response(html, { status: resp.status, headers: h });
      }
      return resp;
    }

    return fetch(target, {
      method: req.method,
      headers: proxyHeaders(req),
      body: req.method !== "GET" && req.method !== "HEAD" ? req.body : undefined,
      redirect: "manual",
    });
  }

  // --- VSCode proxy: multi-node mode (/vscode/<nodeId>/<id>/...) ---

  async function handleVscodeMultiNode(
    req: Request, server: any, url: URL,
    nodes: typeof import("./panel/nodes"),
    tunnel: typeof import("./panel/tunnel"),
    router: Router,
  ): Promise<Response | undefined> {
    const parts = url.pathname.split("/");
    const nodeId = parts[2] || "";

    if (router.isLocal(nodeId)) {
      // Local VSCode: rewrite path to strip nodeId segment
      const id = parts[3] || "";
      const active = getActiveServerById(id);
      if (!active) return new Response("VSCode server not found", { status: 404 });

      const localPath = "/" + parts.slice(3).join("/") + (url.search || "");
      const target = `http://127.0.0.1:${active.port}${localPath}`;

      if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
        const wsTarget = `ws://127.0.0.1:${active.port}${localPath}`;
        const ok = server.upgrade(req, {
          data: { type: "vscode", target: wsTarget } satisfies SocketData,
        });
        return ok ? undefined : new Response("WebSocket upgrade failed", { status: 500 });
      }

      if (req.method === "GET" && req.headers.get("accept")?.includes("text/html")) {
        const resp = await fetch(target, {
          method: "GET",
          headers: proxyHeaders(req, { "accept-encoding": "identity" }),
          redirect: "manual",
        });
        if (resp.headers.get("content-type")?.includes("text/html")) {
          const authority = req.headers.get("x-forwarded-host") || req.headers.get("host") || "localhost";
          const html = rewriteRemoteAuthority(await resp.text(), authority);
          const h = new Headers(resp.headers);
          h.delete("content-length");
          return new Response(html, { status: resp.status, headers: h });
        }
        return resp;
      }

      return fetch(target, {
        method: req.method, headers: proxyHeaders(req),
        body: req.method !== "GET" && req.method !== "HEAD" ? req.body : undefined,
        redirect: "manual",
      });
    }

    // Remote node: tunnel through WS
    const node = nodes.getNode(nodeId);
    if (!node || !node.online) return new Response("Node not found or offline", { status: 502 });

    const forwardPath = "/" + parts.slice(3).join("/") + (url.search || "");

    if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
      const wsHeaders: Record<string, string> = {};
      for (const [k, v] of req.headers) {
        if (!["host", "connection", "upgrade", "sec-websocket-key", "sec-websocket-version", "sec-websocket-extensions"].includes(k)) {
          wsHeaders[k] = v;
        }
      }
      if (server.upgrade(req, {
        data: { type: "tunnel", nodeId, tunnelPath: forwardPath, tunnelHeaders: wsHeaders } satisfies SocketData,
      })) return undefined;
      return new Response("WebSocket upgrade failed", { status: 500 });
    }

    const headers: Record<string, string> = {};
    for (const [k, v] of req.headers) {
      if (!["host", "connection", "upgrade"].includes(k)) headers[k] = v;
    }
    headers["accept-encoding"] = "identity";

    const body = req.method !== "GET" && req.method !== "HEAD" ? await req.arrayBuffer() : null;
    const authority = req.headers.get("x-forwarded-host") || req.headers.get("host") || "localhost";

    try {
      return await tunnel.tunnelHttpRequest(nodeId, req.method, forwardPath, headers, body, authority);
    } catch (err: any) {
      return new Response(err.message, { status: 502 });
    }
  }
}
