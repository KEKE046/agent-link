#!/usr/bin/env bun
// Unified entry point for Agent Link.
//
// Subcommands:
//   agent-link server [opts]            → start web server (standalone or panel)
//   agent-link node <url> [opts]        → connect to remote panel as a node
//   agent-link status                   → show status of running server
//   agent-link list                     → list managed agents
//   agent-link inspect <name|id>...     → inspect agent details
//   agent-link send <name|id> <message> → send message to an agent
//
// Legacy flags (no subcommand) are still supported for backward compatibility.

import { getMachineId } from "./identity";
import { initAuth, verifyCookie, isEnabled as authEnabled } from "./auth";
import { Router } from "./router";
import { createApp } from "./routes";
import { getActiveServerById } from "./vscode";
import * as logger from "./logger";

const args = process.argv.slice(2);

const SUBCOMMANDS = new Set(["server", "node", "status", "list", "inspect", "send", "bio", "intro", "skill", "help"]);
const subcommand = SUBCOMMANDS.has(args[0]) ? args[0] : null;
const subArgs = subcommand ? args.slice(1) : args;

function getArg(a: string[], flag: string): string | undefined {
  const i = a.indexOf(flag);
  return i >= 0 ? a[i + 1] : undefined;
}

// --- Introspection commands ---

if (subcommand === "bio") {
  const { runBio } = await import("./cli/selfwrite");
  await runBio(subArgs);
  process.exit(0);
}

if (subcommand === "intro") {
  const { runIntro } = await import("./cli/selfwrite");
  await runIntro(subArgs);
  process.exit(0);
}

if (subcommand === "skill") {
  const { runSkill } = await import("./cli/skill");
  await runSkill(subArgs);
  process.exit(0);
}

if (subcommand === "status") {
  const { runStatus } = await import("./cli/status");
  await runStatus(subArgs);
  process.exit(0);
}

if (subcommand === "list") {
  const { runList } = await import("./cli/list");
  await runList(subArgs);
  process.exit(0);
}

if (subcommand === "inspect") {
  const { runInspect } = await import("./cli/inspect");
  await runInspect(subArgs);
  process.exit(0);
}

if (subcommand === "send") {
  const { runSend } = await import("./cli/send");
  await runSend(subArgs);
  process.exit(0);
}

// --- Help ---

if (subcommand === "help" || subArgs.includes("--help") || subArgs.includes("-h")) {
  console.log(`Usage:
  agent-link server [options]               Start web server (local or panel)
  agent-link node <url> [options]           Connect to a panel server as a node
  agent-link status [--url <url>]           Show status of running server
  agent-link list   [--url <url>]           List managed agents in a table
  agent-link inspect <name|id>... [-n N] [--url]  Inspect agent details + last N messages (default: 1)
  agent-link send <name|id> <msg> [--url]   Send message to an agent
  agent-link bio [name|id] <text>                  Set one-line bio for an agent (name|id required outside a session)
  agent-link intro [name|id] <text>                Set intro paragraph for an agent
  agent-link skill [--team-work]                   Print inter-agent teamwork cheatsheet (default)
  agent-link skill --setup                         Print installation and configuration guide

Server options:
  --port <n>        HTTP port (default: 3456)
  --bind <ip>       Bind IP address (default: 127.0.0.1, or 0.0.0.0 when --accept-nodes)
  --accept-nodes    Accept remote node connections via WebSocket
  --no-local        Disable local Claude SDK (router-only, requires --accept-nodes)
  --token <value>   Admin token for panel auth (auto-generated if omitted)
  --no-auth         Disable auth (for testing)
  --debug           Enable debug logging

Node options:
  --name <name>     Node display name (default: machine ID)
  --bind <ip>       Bind IP (default: 127.0.0.1, or 0.0.0.0 when --accept-nodes)
  --port <n>        Listen port (default: 3456)
  --accept-nodes    Also accept sub-nodes (relay mode), serves on same port
  --no-auth         Disable local API auth
  --debug           Enable debug logging

Shared options:
  --url <url>       Server URL for introspection commands
                    (default: http://localhost:3456, or AGENT_LINK_URL env)`);
  process.exit(0);
}

// --- Determine mode: server or node ---

// `agent-link node <url>` — positional URL or --connect-to (legacy)
const isNodeSubcommand = subcommand === "node";
const connectTo = isNodeSubcommand
  ? (subArgs.find((a) => !a.startsWith("--") && a.startsWith("http")) || getArg(subArgs, "--connect-to"))
  : getArg(subArgs, "--connect-to");

const acceptNodes = subArgs.includes("--accept-nodes");
const noLocal = subArgs.includes("--no-local");
const port = parseInt(getArg(subArgs, "--port") || "3456");
// Default bind: 0.0.0.0 when accepting remote connections (--accept-nodes), 127.0.0.1 otherwise
const defaultBind = acceptNodes ? "0.0.0.0" : "127.0.0.1";
const bindHost = getArg(subArgs, "--bind") || defaultBind;
const tokenArg = getArg(subArgs, "--token");
const noAuth = subArgs.includes("--no-auth");
const debug = subArgs.includes("--debug");

logger.initLogger({ debug });

if (noLocal && !acceptNodes && !connectTo) {
  logger.error("main", "--no-local requires --accept-nodes");
  process.exit(1);
}

if (isNodeSubcommand && !connectTo) {
  logger.error("main", "Usage: agent-link node <panel-url> [options]");
  process.exit(1);
}

if (connectTo) {
  // ---- Node mode ----
  const nameArg = getArg(subArgs, "--name") || Bun.env.NODE_LABEL;
  const machineId = nameArg ? `${getMachineId()}-${nameArg}` : getMachineId();
  const label = nameArg || machineId;
  logger.log("node", `Machine ID: ${machineId}`);
  logger.log("node", `Name: ${label}`);
  logger.log("node", `Connecting to: ${connectTo}`);

  const { connect } = await import("./node/connector");
  connect(connectTo, machineId, label);

  // Local HTTP API server — also handles relay WS on /ws/node when --accept-nodes
  const localRouter = new Router(machineId);
  if (!noAuth) {
    initAuth(tokenArg);
    logger.log("node", `Local API token saved to store`);
  }
  const localApp = createApp(localRouter);

  let relayHandlers: ReturnType<typeof import("./node/relay")["createRelayHandlers"]> | null = null;
  if (acceptNodes) {
    const { createRelayHandlers } = await import("./node/relay");
    relayHandlers = createRelayHandlers(connectTo);
    logger.log("relay", `Relay enabled on port ${port}, forwarding to ${connectTo}`);
  }

  interface NodeSocketData { type: "relay"; upstream: WebSocket | null; buffer: (string | ArrayBuffer)[] }

  Bun.serve<NodeSocketData>({
    port,
    hostname: bindHost,
    idleTimeout: 120,
    fetch(req: Request, server: any) {
      if (relayHandlers && new URL(req.url).pathname === "/ws/node") {
        if (server.upgrade(req, { data: { type: "relay", upstream: null, buffer: [] } }))
          return undefined;
        return new Response("WebSocket upgrade failed", { status: 500 });
      }
      return localApp.fetch(req);
    },
    websocket: {
      open(ws: any) { relayHandlers?.onOpen(ws); },
      message(ws: any, msg: string | Buffer) { relayHandlers?.onMessage(ws, msg); },
      close(ws: any) { relayHandlers?.onClose(ws); },
    },
  });
  logger.log("node", `Local API listening on ${bindHost}:${port}`);
} else {
  // ---- Server mode ----
  const localId = noLocal ? null : getMachineId();
  const router = new Router(localId);

  if (acceptNodes && !noAuth) {
    const token = initAuth(tokenArg);
    logger.log("server", `Admin token: ${token}`);
    logger.log("server", `Login URL: http://localhost:${port}/login?token=${token}`);
  }

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
      removeNode: panelNodes.removeNode,
    });
  }

  const app = createApp(router);

  const mode = noLocal ? "router-only" : acceptNodes ? "local + remote" : "standalone";
  logger.log("server", `Mode: ${mode}`);
  if (localId) logger.log("server", `Machine ID: ${localId}`);
  logger.log("server", `Listening on ${bindHost}:${port}`);

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
    target?: string;
    upstream?: WebSocket;
  }

  Bun.serve({
    port,
    hostname: bindHost,
    idleTimeout: 120,
    fetch: async (req: Request, server: any) => {
      const url = new URL(req.url);

      if (acceptNodes && panelNodes && url.pathname === "/ws/node") {
        if (server.upgrade(req, { data: { type: "node" } satisfies SocketData })) return undefined;
        return new Response("WebSocket upgrade failed", { status: 500 });
      }

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

  // --- VSCode proxy: standalone mode ---

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

  // --- VSCode proxy: multi-node mode ---

  async function handleVscodeMultiNode(
    req: Request, server: any, url: URL,
    nodes: typeof import("./panel/nodes"),
    tunnel: typeof import("./panel/tunnel"),
    router: Router,
  ): Promise<Response | undefined> {
    const parts = url.pathname.split("/");
    const nodeId = parts[2] || "";

    if (router.isLocal(nodeId)) {
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
