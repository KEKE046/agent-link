import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import * as sessions from "./sessions";
import { addManaged, listManaged, removeManaged, listFolders, addFolder, removeFolder } from "./managed";
import {
  getActiveServerById,
  getInstallCommand,
  listActiveServers,
  listInstalledVersions,
  startVscodeServer,
  stopVscodeServer,
} from "./vscode";
import assets from "./assets";

const app = new Hono();
const isDev = Bun.env.NODE_ENV === "development";

const MIME: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "application/javascript",
  css: "text/css; charset=utf-8",
};

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

function vscodeTarget(req: Request, port: number): string {
  const u = new URL(req.url);
  u.protocol = "http:";
  u.hostname = "127.0.0.1";
  u.port = String(port);
  return u.toString();
}

function rewriteRemoteAuthority(html: string, authority: string): string {
  // Only rewrite the first matching configuration token in the HTML payload.
  // This avoids touching repeated string literals that may appear in bundled JS.
  return html
    .replace(/("remoteAuthority"\s*:\s*")[^"]+(")/, `$1${authority}$2`)
    .replace(
      /(&quot;remoteAuthority&quot;\s*:\s*&quot;)[^&]+(&quot;)/,
      `$1${authority}$2`
    );
}

// API: Start new query or resume existing session
app.post("/api/query", async (c) => {
  const { prompt, cwd, model, sessionId } = await c.req.json();
  try {
    const id = await sessions.startQuery(prompt, { sessionId, cwd, model });
    return c.json({ sessionId: id });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// API: Interrupt active session
app.post("/api/interrupt/:id", async (c) => {
  await sessions.interrupt(c.req.param("id"));
  return c.json({ ok: true });
});

// API: Change model on active session
app.post("/api/model/:id", async (c) => {
  const { model } = await c.req.json();
  await sessions.setModel(c.req.param("id"), model);
  return c.json({ ok: true });
});

// API: SSE event stream
app.get("/api/events/:id", (c) => {
  const id = c.req.param("id");
  return streamSSE(c, async (stream) => {
    let closed = false;
    stream.onAbort(() => {
      closed = true;
    });

    const unsub = sessions.subscribe(id, (msg) => {
      if (!closed) {
        stream.writeSSE({ data: JSON.stringify(msg), event: "message" });
      }
    });

    // Keep-alive ping every 15s
    const keepAlive = setInterval(() => {
      if (!closed) {
        stream.writeSSE({ data: "", event: "ping" });
      }
    }, 15000);

    // Wait until client disconnects
    await new Promise<void>((resolve) => {
      stream.onAbort(() => {
        unsub();
        clearInterval(keepAlive);
        resolve();
      });
    });
  });
});

// API: List all existing sessions (for "Load" dialog)
app.get("/api/sessions", async (c) => {
  const cwd = c.req.query("cwd");
  const limit = parseInt(c.req.query("limit") || "50");
  const offset = parseInt(c.req.query("offset") || "0");
  try {
    return c.json(await sessions.listSessions(cwd || undefined, limit, offset));
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// API: Session info
app.get("/api/sessions/:id", async (c) => {
  const cwd = c.req.query("cwd");
  try {
    return c.json(
      await sessions.getSessionInfo(c.req.param("id"), cwd || undefined)
    );
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// API: Session messages (historical)
app.get("/api/sessions/:id/messages", async (c) => {
  const cwd = c.req.query("cwd");
  const limit = parseInt(c.req.query("limit") || "200");
  const offset = parseInt(c.req.query("offset") || "0");
  try {
    return c.json(
      await sessions.getSessionMessages(
        c.req.param("id"),
        cwd || undefined,
        limit,
        offset
      )
    );
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// API: Currently active session IDs
app.get("/api/active", (c) => {
  return c.json(sessions.getActiveIds());
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

app.get("/api/managed-folders", (c) => {
  return c.json(listFolders());
});

app.post("/api/managed-folders", async (c) => {
  const body = await c.req.json();
  const cwd = typeof body?.cwd === "string" ? body.cwd : "";
  if (!cwd) return c.json({ error: "cwd required" }, 400);
  return c.json(
    addFolder({
      cwd,
      nodeId: typeof body?.nodeId === "string" ? body.nodeId : undefined,
    })
  );
});

app.delete("/api/managed-folders", async (c) => {
  const body = await c.req.json();
  const cwd = typeof body?.cwd === "string" ? body.cwd : "";
  if (!cwd) return c.json({ error: "cwd required" }, 400);
  return c.json(
    removeFolder(cwd, typeof body?.nodeId === "string" ? body.nodeId : undefined)
  );
});

app.get("/api/vscode/versions", async (c) => {
  return c.json(await listInstalledVersions());
});

app.post("/api/vscode/start", async (c) => {
  try {
    const { cwd, commit } = await c.req.json();
    return c.json(await startVscodeServer(cwd, commit));
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

app.post("/api/vscode/stop", async (c) => {
  try {
    const { cwd } = await c.req.json();
    return c.json({ ok: await stopVscodeServer(cwd) });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

app.get("/api/vscode/active", (c) => {
  return c.json(listActiveServers());
});

app.get("/api/vscode/install-command", (c) => {
  return c.json(getInstallCommand(c.req.query("version") || undefined));
});

// Serve static assets (dev: disk with auto Content-Type, prod: embedded map)
app.get("/*", async (c) => {
  const name = c.req.path === "/" ? "index.html" : c.req.path.slice(1);
  if (isDev) {
    const f = Bun.file(`${import.meta.dir}/public/${name}`);
    if (await f.exists()) return new Response(f);
  } else if (name in assets) {
    const ext = name.split(".").pop()!;
    return new Response(assets[name], {
      headers: { "Content-Type": MIME[ext] || "text/plain" },
    });
  }
  return c.notFound();
});

export default {
  port: 3456,
  idleTimeout: 120,
  fetch: async (req: Request, server: any) => {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/vscode/")) return app.fetch(req);

    const id = url.pathname.split("/")[2] || "";
    const active = getActiveServerById(id);
    if (!active) return new Response("VSCode server not found", { status: 404 });

    const target = vscodeTarget(req, active.port);

    // WebSocket: upgrade + bridge
    if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
      const ok = server.upgrade(req, { data: { target: target.replace("http:", "ws:") } });
      return ok ? undefined : new Response("WebSocket upgrade failed", { status: 500 });
    }

    // HTML GET: rewrite remoteAuthority so WS/API go through proxy
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

    // Everything else: plain proxy
    return fetch(target, {
      method: req.method,
      headers: proxyHeaders(req),
      body: req.method !== "GET" && req.method !== "HEAD" ? req.body : undefined,
      redirect: "manual",
    });
  },
  websocket: {
    open(ws: any) {
      const upstream = new WebSocket(ws.data.target);
      ws.data.upstream = upstream;
      upstream.addEventListener("message", (e: MessageEvent) => {
        try { ws.send(typeof e.data === "string" ? e.data : new Uint8Array(e.data)); } catch {}
      });
      upstream.addEventListener("close", () => { try { ws.close(); } catch {} });
      upstream.addEventListener("error", () => { try { ws.close(); } catch {} });
    },
    message(ws: any, msg: string | Buffer) {
      const u = ws.data.upstream as WebSocket | undefined;
      if (u?.readyState === WebSocket.OPEN) u.send(msg);
    },
    close(ws: any) {
      const u = ws.data.upstream as WebSocket | undefined;
      if (u && u.readyState !== WebSocket.CLOSED) u.close();
    },
  },
};
