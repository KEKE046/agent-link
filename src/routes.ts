// Unified Hono API routes — written once, dispatched via Router.

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { Router } from "./router";
import {
  addManaged, listManaged, removeManaged,
  listFolders, addFolder, removeFolder, renameFolder,
} from "./managed";
import assets from "./assets";

const isDev = Bun.env.NODE_ENV === "development";

const MIME: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "application/javascript",
  css: "text/css; charset=utf-8",
};

function getNodeId(c: any): string | undefined {
  return c.req.query("nodeId") || c.req.header("x-node-id") || undefined;
}

export function createApp(router: Router): Hono {
  const app = new Hono();

  // --- Session APIs ---

  app.post("/api/query", async (c) => {
    const body = await c.req.json();
    const nodeId = body.nodeId || getNodeId(c) || router.localId;
    if (!nodeId) return c.json({ error: "nodeId required" }, 400);
    try {
      return c.json(await router.dispatch(nodeId, "query", {
        prompt: body.prompt, cwd: body.cwd, model: body.model, sessionId: body.sessionId,
      }));
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  app.post("/api/interrupt/:id", async (c) => {
    const sessionId = c.req.param("id");
    const nodeId = getNodeId(c) || router.findNodeForSession(sessionId);
    if (!nodeId) return c.json({ error: "node not found for session" }, 404);
    try {
      return c.json(await router.dispatch(nodeId, "interrupt", { sessionId }));
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  app.post("/api/model/:id", async (c) => {
    const sessionId = c.req.param("id");
    const { model } = await c.req.json();
    const nodeId = getNodeId(c) || router.findNodeForSession(sessionId);
    if (!nodeId) return c.json({ error: "node not found for session" }, 404);
    try {
      return c.json(await router.dispatch(nodeId, "setModel", { sessionId, model }));
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  app.get("/api/events/:id", (c) => {
    const sessionId = c.req.param("id");
    return streamSSE(c, async (stream) => {
      let closed = false;
      stream.onAbort(() => { closed = true; });

      const unsub = router.subscribe(sessionId, (msg) => {
        if (!closed) stream.writeSSE({ data: JSON.stringify(msg), event: "message" });
      });

      const keepAlive = setInterval(() => {
        if (!closed) stream.writeSSE({ data: "", event: "ping" });
      }, 15000);

      await new Promise<void>((resolve) => {
        stream.onAbort(() => { unsub(); clearInterval(keepAlive); resolve(); });
      });
    });
  });

  app.get("/api/sessions", async (c) => {
    const cwd = c.req.query("cwd");
    const limit = parseInt(c.req.query("limit") || "50");
    const offset = parseInt(c.req.query("offset") || "0");
    const nodeId = getNodeId(c);

    if (nodeId) {
      try {
        return c.json(await router.dispatch(nodeId, "listSessions", { cwd, limit, offset }));
      } catch (err: any) {
        return c.json({ error: err.message }, 500);
      }
    }
    return c.json(await router.listAllSessions(cwd || undefined, limit, offset));
  });

  app.get("/api/sessions/:id", async (c) => {
    const sessionId = c.req.param("id");
    const cwd = c.req.query("cwd");
    const nodeId = getNodeId(c) || router.findNodeForSession(sessionId);

    if (nodeId) {
      try {
        return c.json(await router.dispatch(nodeId, "getSessionInfo", { sessionId, cwd }));
      } catch (err: any) {
        return c.json({ error: err.message }, 500);
      }
    }
    const info = await router.findSessionInfo(sessionId, cwd || undefined);
    return info ? c.json(info) : c.json({ error: "session not found" }, 404);
  });

  app.get("/api/sessions/:id/messages", async (c) => {
    const sessionId = c.req.param("id");
    const cwd = c.req.query("cwd");
    const limit = parseInt(c.req.query("limit") || "200");
    const offset = parseInt(c.req.query("offset") || "0");
    const nodeId = getNodeId(c) || router.findNodeForSession(sessionId);

    if (nodeId) {
      try {
        return c.json(await router.dispatch(nodeId, "getSessionMessages", { sessionId, cwd, limit, offset }));
      } catch (err: any) {
        return c.json({ error: err.message }, 500);
      }
    }
    const msgs = await router.findSessionMessages(sessionId, cwd || undefined, limit, offset);
    return msgs ? c.json(msgs) : c.json({ error: "session not found" }, 404);
  });

  app.get("/api/active", (c) => {
    return c.json(router.getAllActiveIds());
  });

  // --- Node APIs (only when accepting remote nodes) ---

  app.get("/api/nodes", (c) => {
    if (!router.hasRemote) return c.notFound();
    return c.json(router.listNodes());
  });

  app.post("/api/nodes/:nodeId/approve", (c) => {
    if (!router.hasRemote) return c.notFound();
    const nodeId = c.req.param("nodeId");
    return c.json({ ok: router.approveNode(nodeId) });
  });

  app.post("/api/nodes/:nodeId/label", async (c) => {
    if (!router.hasRemote) return c.notFound();
    const nodeId = c.req.param("nodeId");
    const body = await c.req.json();
    const label = typeof body?.label === "string" ? body.label.trim() : "";
    if (!label) return c.json({ error: "label required" }, 400);
    return c.json({ ok: router.renameNode(nodeId, label) });
  });

  // --- Managed sessions ---

  app.get("/api/managed", (c) => c.json(listManaged()));

  app.post("/api/managed", async (c) => {
    const body = await c.req.json();
    const id = typeof body?.id === "string" ? body.id : "";
    const cwd = typeof body?.cwd === "string" ? body.cwd : "";
    if (!id || !cwd) return c.json({ error: "id and cwd required" }, 400);
    return c.json(addManaged({
      id, cwd,
      nodeId: typeof body?.nodeId === "string" ? body.nodeId : undefined,
      createdAt: typeof body?.createdAt === "number" ? body.createdAt : Date.now(),
    }));
  });

  app.delete("/api/managed/:id", (c) => c.json(removeManaged(c.req.param("id"))));

  // --- Managed folders ---

  app.get("/api/managed-folders", (c) => c.json(listFolders()));

  app.post("/api/managed-folders", async (c) => {
    const body = await c.req.json();
    const cwd = typeof body?.cwd === "string" ? body.cwd : "";
    if (!cwd) return c.json({ error: "cwd required" }, 400);
    return c.json(addFolder({
      cwd,
      nodeId: typeof body?.nodeId === "string" ? body.nodeId : undefined,
    }));
  });

  app.delete("/api/managed-folders", async (c) => {
    const body = await c.req.json();
    const cwd = typeof body?.cwd === "string" ? body.cwd : "";
    if (!cwd) return c.json({ error: "cwd required" }, 400);
    return c.json(removeFolder(cwd, typeof body?.nodeId === "string" ? body.nodeId : undefined));
  });

  app.patch("/api/managed-folders", async (c) => {
    const body = await c.req.json();
    const cwd = typeof body?.cwd === "string" ? body.cwd : "";
    if (!cwd) return c.json({ error: "cwd required" }, 400);
    const label = typeof body?.label === "string" ? body.label.trim() : "";
    return c.json(renameFolder(cwd, typeof body?.nodeId === "string" ? body.nodeId : undefined, label));
  });

  // --- VSCode APIs ---

  app.get("/api/vscode/versions", async (c) => {
    const nodeId = getNodeId(c) || router.localId;
    if (!nodeId) return c.json({ error: "nodeId required" }, 400);
    try {
      return c.json(await router.dispatch(nodeId, "listVscodeVersions", {}));
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  app.post("/api/vscode/start", async (c) => {
    const body = await c.req.json();
    const nodeId = body.nodeId || getNodeId(c) || router.localId;
    if (!nodeId) return c.json({ error: "nodeId required" }, 400);
    try {
      return c.json(await router.dispatch(nodeId, "startVscodeServer", { cwd: body.cwd, commit: body.commit }));
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  app.post("/api/vscode/stop", async (c) => {
    const body = await c.req.json();
    const nodeId = body.nodeId || getNodeId(c) || router.localId;
    if (!nodeId) return c.json({ error: "nodeId required" }, 400);
    try {
      return c.json(await router.dispatch(nodeId, "stopVscodeServer", { cwd: body.cwd }));
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  app.get("/api/vscode/active", (c) => {
    const all: any[] = [];
    for (const node of router.listNodes()) {
      for (const vs of node.vscodeServers || []) {
        all.push({ ...vs, nodeId: node.nodeId });
      }
    }
    return c.json(all);
  });

  app.get("/api/vscode/install-command", async (c) => {
    const nodeId = getNodeId(c) || router.localId;
    if (!nodeId) return c.json({ error: "nodeId required" }, 400);
    try {
      return c.json(await router.dispatch(nodeId, "getInstallCommand", { version: c.req.query("version") }));
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  // --- Static assets ---

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

  return app;
}
