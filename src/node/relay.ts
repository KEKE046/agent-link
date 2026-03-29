// Relay — accepts sub-node WS connections and proxies them to the panel.
// Each sub-node gets a dedicated WS to the panel, messages piped bidirectionally.
// No protocol changes: the panel sees each sub-node as a direct connection.

import * as logger from "../logger";

export interface RelaySocket {
  upstream: WebSocket | null;
  buffer: (string | ArrayBuffer)[];
}

export function createRelayHandlers(panelUrl: string) {
  const wsUrl = panelUrl.replace(/^http/, "ws") + "/ws/node";

  function onOpen(ws: { data: RelaySocket; send: (m: any) => void; close: () => void }) {
    const upstream = new WebSocket(wsUrl);
    ws.data.upstream = upstream;

    upstream.addEventListener("open", () => {
      for (const msg of ws.data.buffer) upstream.send(msg);
      ws.data.buffer = [];
      logger.debug("relay", "Upstream connected for sub-node");
    });

    upstream.addEventListener("message", (e: MessageEvent) => {
      try { ws.send(typeof e.data === "string" ? e.data : new Uint8Array(e.data)); } catch {}
    });

    upstream.addEventListener("close", () => { try { ws.close(); } catch {} });
    upstream.addEventListener("error", () => { try { ws.close(); } catch {} });
  }

  function onMessage(ws: { data: RelaySocket }, message: string | Buffer) {
    const upstream = ws.data.upstream;
    if (upstream?.readyState === WebSocket.OPEN) {
      upstream.send(message);
    } else {
      ws.data.buffer.push(
        typeof message === "string" ? message : (message as Buffer).buffer,
      );
    }
  }

  function onClose(ws: { data: RelaySocket }) {
    const upstream = ws.data.upstream;
    if (upstream && upstream.readyState !== WebSocket.CLOSED) upstream.close();
  }

  return { onOpen, onMessage, onClose };
}
