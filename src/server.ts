import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import * as sessions from "./sessions";
import {
  getActiveServerById,
  getInstallCommand,
  listActiveServers,
  listInstalledVersions,
  startVscodeServer,
  stopVscodeServer,
} from "./vscode";
import indexHtml from "./public/index.html" with { type: "text" };
import rendererJs from "./public/renderer.js" with { type: "text" };
import stylesCss from "./public/styles.css" with { type: "text" };

const app = new Hono();
const isDev = Bun.env.NODE_ENV === "development";

async function readAsset(path: string, embedded: string): Promise<string> {
  if (!isDev) return embedded;
  const file = Bun.file(import.meta.dir + path);
  if (!(await file.exists())) return embedded;
  return file.text();
}

function getProxyAuthority(req: Request): string {
  return req.headers.get("host") || req.headers.get("x-forwarded-host") || "localhost";
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

function isWebSocketUpgrade(req: Request): boolean {
  return req.headers.get("upgrade")?.toLowerCase() === "websocket";
}

function buildVscodeTargetUrl(req: Request, activePort: number): URL {
  const targetUrl = new URL(req.url);
  targetUrl.protocol = "http:";
  targetUrl.hostname = "127.0.0.1";
  targetUrl.port = String(activePort);
  return targetUrl;
}

function shouldRewriteHtml(req: Request): boolean {
  if (req.method !== "GET") return false;
  const accept = req.headers.get("accept") || "";
  return accept.includes("text/html");
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

// Serve static assets
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

// Serve index.html
app.get("/", async (c) => {
  return c.html(await readAsset("/public/index.html", indexHtml));
});

export default {
  port: 3456,
  idleTimeout: 120,
  // Reverse proxy for /vscode/{encoded-cwd}/...
  // - HTTP: forward to matching local serve-web port
  // - HTML: rewrite remoteAuthority to current proxy authority so follow-up API/WS go through proxy
  // - WS: handled by Bun.proxy upgrade support
  fetch: async (req: Request) => {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/vscode/")) {
      const id = url.pathname.split("/")[2] || "";
      const active = getActiveServerById(id);
      if (!active) return new Response("VSCode server not found", { status: 404 });

      const targetUrl = buildVscodeTargetUrl(req, active.port);

      if (isWebSocketUpgrade(req)) {
        return Bun.proxy(req, targetUrl);
      }

      if (shouldRewriteHtml(req)) {
        const headers = new Headers(req.headers);
        headers.set("accept-encoding", "identity");
        const resp = await fetch(targetUrl, {
          method: req.method,
          headers,
          redirect: "manual",
        });
        const contentType = resp.headers.get("content-type") || "";
        if (contentType.includes("text/html")) {
          const html = rewriteRemoteAuthority(
            await resp.text(),
            getProxyAuthority(req)
          );
          const outHeaders = new Headers(resp.headers);
          outHeaders.delete("content-length");
          return new Response(html, { status: resp.status, headers: outHeaders });
        }
        return resp;
      }
      return Bun.proxy(req, targetUrl);
    }
    return app.fetch(req);
  },
};
