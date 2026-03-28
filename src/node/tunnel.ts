import { send } from "./connector";
import {
  getActiveServerById,
  listActiveServers,
} from "../vscode";
import type {
  MsgTunnelRequest,
  MsgTunnelWsOpen,
  MsgTunnelWsData,
  MsgTunnelWsClose,
} from "../protocol";

// Active WS tunnels: tunnelId → upstream WebSocket to local VSCode
const wsTunnels = new Map<string, WebSocket>();

function findPortForPath(path: string): number | null {
  // Path format: /<id>/... where id is a short hash of the cwd
  // From Panel, we get the path after nodeId already stripped: /<id>/...
  const parts = path.split("/").filter(Boolean);
  const encodedCwd = parts[0] || "";
  if (!encodedCwd) return null;

  const server = getActiveServerById(encodedCwd);
  if (server) return server.port;

  // Fallback: try all active servers looking for matching id
  for (const s of listActiveServers()) {
    if (s.id === encodedCwd) return s.port;
  }
  return null;
}

export function handleTunnelRequest(msg: MsgTunnelRequest) {
  const port = findPortForPath(msg.path);
  if (!port) {
    send({
      type: "tunnel:response",
      tunnelId: msg.tunnelId,
      status: 404,
      headers: {},
      body: Buffer.from("VSCode server not found on this node").toString("base64"),
    });
    return;
  }

  const targetUrl = `http://127.0.0.1:${port}${msg.path}`;
  const headers = new Headers(msg.headers);
  headers.delete("host");

  const fetchBody =
    msg.body && msg.method !== "GET" && msg.method !== "HEAD"
      ? Buffer.from(msg.body, "base64")
      : undefined;

  fetch(targetUrl, {
    method: msg.method,
    headers,
    body: fetchBody,
    redirect: "manual",
  })
    .then(async (resp) => {
      const body = await resp.arrayBuffer();
      const respHeaders: Record<string, string> = {};
      for (const [k, v] of resp.headers) {
        if (k !== "transfer-encoding") respHeaders[k] = v;
      }
      // Delete content-length since panel may rewrite HTML
      const contentType = resp.headers.get("content-type") || "";
      const isHtml = contentType.includes("text/html");
      if (isHtml) delete respHeaders["content-length"];

      send({
        type: "tunnel:response",
        tunnelId: msg.tunnelId,
        status: resp.status,
        headers: respHeaders,
        body: Buffer.from(body).toString("base64"),
        isHtml,
      });
    })
    .catch(() => {
      send({
        type: "tunnel:response",
        tunnelId: msg.tunnelId,
        status: 502,
        headers: {},
        body: Buffer.from("Failed to fetch from local VSCode").toString("base64"),
      });
    });
}

export function handleTunnelWsOpen(msg: MsgTunnelWsOpen) {
  const port = findPortForPath(msg.path);
  if (!port) {
    send({ type: "tunnel:ws-close", tunnelId: msg.tunnelId, code: 1011 });
    return;
  }

  const targetUrl = `ws://127.0.0.1:${port}${msg.path}`;
  const upstream = new WebSocket(targetUrl);

  upstream.addEventListener("open", () => {
    wsTunnels.set(msg.tunnelId, upstream);
    send({ type: "tunnel:ws-opened", tunnelId: msg.tunnelId });
  });

  upstream.addEventListener("message", (e) => {
    const data = e.data;
    if (typeof data === "string") {
      send({ type: "tunnel:ws-data", tunnelId: msg.tunnelId, data, binary: false });
    } else if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
      send({
        type: "tunnel:ws-data",
        tunnelId: msg.tunnelId,
        data: Buffer.from(data as any).toString("base64"),
        binary: true,
      });
    }
  });

  upstream.addEventListener("close", (e) => {
    wsTunnels.delete(msg.tunnelId);
    send({ type: "tunnel:ws-close", tunnelId: msg.tunnelId, code: e.code });
  });

  upstream.addEventListener("error", () => {
    wsTunnels.delete(msg.tunnelId);
    send({ type: "tunnel:ws-close", tunnelId: msg.tunnelId, code: 1011 });
  });
}

export function handleTunnelWsData(msg: MsgTunnelWsData) {
  const upstream = wsTunnels.get(msg.tunnelId);
  if (!upstream || upstream.readyState !== WebSocket.OPEN) return;

  if (msg.binary) {
    upstream.send(Buffer.from(msg.data, "base64"));
  } else {
    upstream.send(msg.data);
  }
}

export function handleTunnelWsClose(msg: MsgTunnelWsClose) {
  const upstream = wsTunnels.get(msg.tunnelId);
  if (upstream) {
    if (upstream.readyState !== WebSocket.CLOSED) {
      upstream.close(msg.code || 1000);
    }
    wsTunnels.delete(msg.tunnelId);
  }
}
