import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import * as sessions from "./sessions";

const app = new Hono();

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

// Serve static assets
app.get("/renderer.js", async (c) => {
  const file = Bun.file(import.meta.dir + "/public/renderer.js");
  return new Response(await file.arrayBuffer(), {
    headers: { "Content-Type": "application/javascript" },
  });
});

// Serve index.html
app.get("/", async (c) => {
  const file = Bun.file(import.meta.dir + "/public/index.html");
  return c.html(await file.text());
});

export default {
  port: 3456,
  idleTimeout: 120,
  fetch: app.fetch,
};
