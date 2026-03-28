import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import {
  listNodes,
  getNode,
  requestNode,
  subscribeSession,
  clearEventBuffer,
  findNodeForSession,
  registerNode,
  approveNode,
  renameNode,
  markOffline,
  handleNodeMessage,
  sendRaw,
} from "./nodes";
import {
  tunnelHttpRequest,
  tunnelWsOpen,
  tunnelWsSendToNode,
  tunnelWsClose,
} from "./tunnel";
import type { MsgRegister } from "../protocol";
import { addManaged, listManaged, removeManaged } from "../managed";
import indexHtml from "../public/index.html" with { type: "text" };
import rendererJs from "../public/renderer.js" with { type: "text" };
import stylesCss from "../public/styles.css" with { type: "text" };

const app = new Hono();
const isDev = Bun.env.NODE_ENV === "development";

// Admin secret for admin-only endpoints. Set PANEL_ADMIN_SECRET env var.
const adminSecret = Bun.env.PANEL_ADMIN_SECRET;

function checkAdminAuth(c: Context): Response | null {
  if (!adminSecret) {
    // If no secret is configured, treat as a server misconfiguration
    return c.json({ error: "PANEL_ADMIN_SECRET is not configured" }, 503);
  }
  const auth = c.req.header("authorization") || "";
  if (auth !== `Bearer ${adminSecret}`) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  return null;
}

async function readAsset(path: string, embedded: string): Promise<string> {
  if (!isDev) return embedded;
  const file = Bun.file(import.meta.dir + "/.." + path);
  if (!(await file.exists())) return embedded;
  return file.text();
}

// --- Node management APIs ---

app.get("/api/nodes", (c) => {
  return c.json(listNodes());
});

app.post("/api/nodes/:nodeId/approve", (c) => {
  const deny = checkAdminAuth(c);
  if (deny) return deny;
  const nodeId = c.req.param("nodeId");
  return c.json({ ok: approveNode(nodeId) });
});

app.post("/api/nodes/:nodeId/label", async (c) => {
  const deny = checkAdminAuth(c);
  if (deny) return deny;
  const nodeId = c.req.param("nodeId");
  const body = await c.req.json();
  const label = typeof body?.label === "string" ? body.label.trim() : "";
  if (!label) return c.json({ error: "label required" }, 400);
  return c.json({ ok: renameNode(nodeId, label) });
});

// --- Forwarded session APIs ---

// Helper: resolve nodeId from request, or auto-find by sessionId
function getNodeId(c: any): string | undefined {
  return c.req.query("nodeId") || c.req.header("x-node-id");
}

app.post("/api/query", async (c) => {
  const body = await c.req.json();
  const nodeId = body.nodeId || getNodeId(c);
  if (!nodeId) return c.json({ error: "nodeId required" }, 400);

  try {
    if (body.sessionId) clearEventBuffer(body.sessionId);
    const data = await requestNode(nodeId, "query", {
      prompt: body.prompt,
      cwd: body.cwd,
      model: body.model,
      sessionId: body.sessionId,
    });
    return c.json(data);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

app.post("/api/interrupt/:id", async (c) => {
  const sessionId = c.req.param("id");
  const nodeId = getNodeId(c) || findNodeForSession(sessionId)?.nodeId;
  if (!nodeId) return c.json({ error: "node not found for session" }, 404);

  try {
    await requestNode(nodeId, "interrupt", { sessionId });
    return c.json({ ok: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

app.post("/api/model/:id", async (c) => {
  const sessionId = c.req.param("id");
  const { model } = await c.req.json();
  const nodeId = getNodeId(c) || findNodeForSession(sessionId)?.nodeId;
  if (!nodeId) return c.json({ error: "node not found for session" }, 404);

  try {
    await requestNode(nodeId, "setModel", { sessionId, model });
    return c.json({ ok: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

app.get("/api/events/:id", (c) => {
  const sessionId = c.req.param("id");
  return streamSSE(c, async (stream) => {
    let closed = false;
    stream.onAbort(() => {
      closed = true;
    });

    const unsub = subscribeSession(sessionId, (event) => {
      if (!closed) {
        stream.writeSSE({ data: JSON.stringify(event), event: "message" });
      }
    });

    const keepAlive = setInterval(() => {
      if (!closed) {
        stream.writeSSE({ data: "", event: "ping" });
      }
    }, 15000);

    await new Promise<void>((resolve) => {
      stream.onAbort(() => {
        unsub();
        clearInterval(keepAlive);
        resolve();
      });
    });
  });
});

app.get("/api/sessions", async (c) => {
  const cwd = c.req.query("cwd");
  const limit = parseInt(c.req.query("limit") || "50");
  const offset = parseInt(c.req.query("offset") || "0");
  const nodeId = getNodeId(c);

  // If nodeId specified, query that node; otherwise aggregate all
  if (nodeId) {
    try {
      return c.json(
        await requestNode(nodeId, "listSessions", { cwd, limit, offset })
      );
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  }

  // Aggregate from all online nodes
  const results: any[] = [];
  for (const node of listNodes()) {
    if (!node.online) continue;
    try {
      const sessions = await requestNode(node.nodeId, "listSessions", {
        cwd,
        limit,
        offset,
      });
      for (const s of sessions || []) {
        results.push({ ...s, nodeId: node.nodeId });
      }
    } catch {}
  }
  // Sort by lastModified descending, apply limit
  results.sort((a, b) => (b.lastModified || 0) - (a.lastModified || 0));
  return c.json(results.slice(0, limit));
});

app.get("/api/sessions/:id", async (c) => {
  const sessionId = c.req.param("id");
  const cwd = c.req.query("cwd");
  const nodeId = getNodeId(c) || findNodeForSession(sessionId)?.nodeId;
  if (!nodeId) {
    // Try all nodes
    for (const node of listNodes()) {
      if (!node.online) continue;
      try {
        const info = await requestNode(node.nodeId, "getSessionInfo", {
          sessionId,
          cwd,
        });
        if (info) return c.json({ ...info, nodeId: node.nodeId });
      } catch {}
    }
    return c.json({ error: "session not found" }, 404);
  }
  try {
    const info = await requestNode(nodeId, "getSessionInfo", {
      sessionId,
      cwd,
    });
    return c.json(info);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

app.get("/api/sessions/:id/messages", async (c) => {
  const sessionId = c.req.param("id");
  const cwd = c.req.query("cwd");
  const limit = parseInt(c.req.query("limit") || "200");
  const offset = parseInt(c.req.query("offset") || "0");
  const nodeId = getNodeId(c) || findNodeForSession(sessionId)?.nodeId;

  if (!nodeId) {
    // Try all nodes
    for (const node of listNodes()) {
      if (!node.online) continue;
      try {
        return c.json(
          await requestNode(node.nodeId, "getSessionMessages", {
            sessionId,
            cwd,
            limit,
            offset,
          })
        );
      } catch {}
    }
    return c.json({ error: "session not found" }, 404);
  }

  try {
    return c.json(
      await requestNode(nodeId, "getSessionMessages", {
        sessionId,
        cwd,
        limit,
        offset,
      })
    );
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

app.get("/api/active", (c) => {
  const all: string[] = [];
  for (const node of listNodes()) {
    if (node.online) all.push(...node.activeSessionIds);
  }
  return c.json(all);
});

app.get("/api/managed", (c) => {
  return c.json(listManaged());
});

app.post("/api/managed", async (c) => {
  const body = await c.req.json();
  const id = typeof body?.id === "string" ? body.id : "";
  const cwd = typeof body?.cwd === "string" ? body.cwd : "";
  if (!id || !cwd) return c.json({ error: "id and cwd required" }, 400);
  return c.json(
    addManaged({
      id,
      nodeId: typeof body?.nodeId === "string" ? body.nodeId : undefined,
      cwd,
      createdAt:
        typeof body?.createdAt === "number" ? body.createdAt : Date.now(),
    })
  );
});

app.delete("/api/managed/:id", (c) => {
  return c.json(removeManaged(c.req.param("id")));
});

// VSCode APIs — aggregated from nodes
app.get("/api/vscode/versions", async (c) => {
  const nodeId = getNodeId(c);
  if (nodeId) {
    try {
      return c.json(await requestNode(nodeId, "listVscodeVersions", {}));
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  }
  // Aggregate from all nodes
  const results: any[] = [];
  for (const node of listNodes()) {
    if (!node.online) continue;
    try {
      const versions = await requestNode(node.nodeId, "listVscodeVersions", {});
      results.push(...(versions || []));
    } catch {}
  }
  return c.json(results);
});

app.post("/api/vscode/start", async (c) => {
  const body = await c.req.json();
  const nodeId = body.nodeId || getNodeId(c);
  if (!nodeId) return c.json({ error: "nodeId required" }, 400);
  try {
    return c.json(
      await requestNode(nodeId, "startVscodeServer", {
        cwd: body.cwd,
        commit: body.commit,
      })
    );
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

app.post("/api/vscode/stop", async (c) => {
  const body = await c.req.json();
  const nodeId = body.nodeId || getNodeId(c);
  if (!nodeId) return c.json({ error: "nodeId required" }, 400);
  try {
    return c.json(
      await requestNode(nodeId, "stopVscodeServer", { cwd: body.cwd })
    );
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

app.get("/api/vscode/active", (c) => {
  const all: any[] = [];
  for (const node of listNodes()) {
    if (!node.online) continue;
    for (const vs of node.vscodeServers) {
      all.push({ ...vs, nodeId: node.nodeId });
    }
  }
  return c.json(all);
});

app.get("/api/vscode/install-command", async (c) => {
  const nodeId = getNodeId(c);
  if (!nodeId) {
    // Pick first online node
    const first = listNodes().find((n) => n.online);
    if (!first) return c.json({ error: "no online nodes" }, 503);
    try {
      return c.json(
        await requestNode(first.nodeId, "getInstallCommand", {
          version: c.req.query("version"),
        })
      );
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  }
  try {
    return c.json(
      await requestNode(nodeId, "getInstallCommand", {
        version: c.req.query("version"),
      })
    );
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// Static assets
app.get("/renderer.js", async (c) => {
  return new Response(await readAsset("/public/renderer.js", rendererJs), {
    headers: { "Content-Type": "application/javascript" },
  });
});

app.get("/styles.css", async (c) => {
  return new Response(await readAsset("/public/styles.css", stylesCss), {
    headers: { "Content-Type": "text/css; charset=utf-8" },
  });
});

app.get("/", async (c) => {
  return c.html(await readAsset("/public/index.html", indexHtml));
});

// --- Bun server export ---

interface PanelSocketData {
  type: "node" | "tunnel";
  nodeId?: string;
  tunnelId?: string;
  tunnelPath?: string;
  tunnelHeaders?: Record<string, string>;
}

export default {
  port: parseInt(Bun.env.PANEL_PORT || "3457"),
  idleTimeout: 120,
  fetch: async (req: Request, server: any) => {
    const url = new URL(req.url);

    // Node WS connection endpoint
    if (url.pathname === "/ws/node") {
      if (server.upgrade(req, { data: { type: "node" } satisfies PanelSocketData })) {
        return undefined;
      }
      return new Response("WebSocket upgrade failed", { status: 500 });
    }

    // VSCode tunnel: /vscode/<nodeId>/<encoded-cwd>/...
    if (url.pathname.startsWith("/vscode/")) {
      const parts = url.pathname.split("/");
      const nodeId = parts[2] || "";
      const node = getNode(nodeId);
      if (!node || !node.online || !node.approved) {
        return new Response("Node not found or offline", { status: 502 });
      }

      // Forward path is everything from the 3rd segment on: /<encoded-cwd>/...
      const forwardPath = "/" + parts.slice(3).join("/") + (url.search || "");

      // WS upgrade
      if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
        const wsHeaders: Record<string, string> = {};
        for (const [k, v] of req.headers) {
          if (!["host", "connection", "upgrade", "sec-websocket-key", "sec-websocket-version", "sec-websocket-extensions"].includes(k)) {
            wsHeaders[k] = v;
          }
        }
        if (
          server.upgrade(req, {
            data: {
              type: "tunnel",
              nodeId,
              tunnelPath: forwardPath,
              tunnelHeaders: wsHeaders,
            } satisfies PanelSocketData,
          })
        ) {
          return undefined;
        }
        return new Response("WebSocket upgrade failed", { status: 500 });
      }

      // HTTP tunnel
      const headers: Record<string, string> = {};
      for (const [k, v] of req.headers) {
        if (!["host", "connection", "upgrade"].includes(k)) {
          headers[k] = v;
        }
      }
      // Force identity encoding so we get raw body for rewriting
      headers["accept-encoding"] = "identity";

      const body =
        req.method !== "GET" && req.method !== "HEAD"
          ? await req.arrayBuffer()
          : null;

      const authority =
        req.headers.get("x-forwarded-host") ||
        req.headers.get("host") ||
        "localhost";

      try {
        return await tunnelHttpRequest(
          nodeId,
          req.method,
          forwardPath,
          headers,
          body,
          authority
        );
      } catch (err: any) {
        return new Response(err.message, { status: 502 });
      }
    }

    return app.fetch(req);
  },
  websocket: {
    open(ws: any) {
      const data = ws.data as PanelSocketData;
      if (data.type === "tunnel" && data.nodeId && data.tunnelPath) {
        const tunnelId = tunnelWsOpen(
          data.nodeId,
          ws,
          data.tunnelPath,
          data.tunnelHeaders || {}
        );
        data.tunnelId = tunnelId;
      }
    },
    message(ws: any, message: string | Buffer) {
      const data = ws.data as PanelSocketData;
      if (data.type === "node") {
        if (!data.nodeId) {
          // First message should be register
          try {
            const msg: MsgRegister = JSON.parse(
              typeof message === "string"
                ? message
                : new TextDecoder().decode(message)
            );
            if (msg.type === "register") {
              const reg = registerNode(
                ws as any,
                msg.key,
                msg.label
              );
              data.nodeId = reg.nodeId;
              if (reg.approved) {
                ws.send(
                  JSON.stringify({ type: "registered", nodeId: reg.nodeId })
                );
                console.log(`[panel] Node registered: ${reg.nodeId} (${msg.label})`);
              } else {
                ws.send(
                  JSON.stringify({ type: "pending" })
                );
                console.log(`[panel] Node pending approval: ${reg.nodeId} (${msg.label})`);
              }
            }
          } catch {}
          return;
        }
        // Subsequent messages
        handleNodeMessage(
          data.nodeId,
          typeof message === "string"
            ? message
            : new TextDecoder().decode(message)
        );
      } else if (data.type === "tunnel" && data.tunnelId) {
        tunnelWsSendToNode(data.tunnelId, message);
      }
    },
    close(ws: any) {
      const data = ws.data as PanelSocketData;
      if (data.type === "node" && data.nodeId) {
        markOffline(data.nodeId);
        console.log(`[panel] Node disconnected: ${data.nodeId}`);
      } else if (data.type === "tunnel" && data.tunnelId) {
        tunnelWsClose(data.tunnelId);
      }
    },
  },
};
