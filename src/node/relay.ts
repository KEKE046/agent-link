// Relay — accepts sub-node WS connections and proxies them to the panel.
// Each sub-node gets a dedicated WS to the panel, messages piped bidirectionally.
// No protocol changes: the panel sees each sub-node as a direct connection.

interface RelaySocket {
  upstream: WebSocket | null;
  buffer: (string | ArrayBuffer)[];
}

export function startRelay(panelUrl: string, port: number) {
  const wsUrl = panelUrl.replace(/^http/, "ws") + "/ws/node";

  Bun.serve<RelaySocket>({
    port,
    idleTimeout: 120,
    fetch(req, server) {
      const url = new URL(req.url);
      if (url.pathname === "/ws/node") {
        if (server.upgrade(req, { data: { upstream: null, buffer: [] } }))
          return undefined;
        return new Response("WebSocket upgrade failed", { status: 500 });
      }
      return new Response("Not found", { status: 404 });
    },
    websocket: {
      open(ws) {
        const upstream = new WebSocket(wsUrl);
        ws.data.upstream = upstream;

        upstream.addEventListener("open", () => {
          // Flush buffered messages from sub-node
          for (const msg of ws.data.buffer) {
            upstream.send(msg);
          }
          ws.data.buffer = [];
        });

        upstream.addEventListener("message", (e: MessageEvent) => {
          try {
            ws.send(typeof e.data === "string" ? e.data : new Uint8Array(e.data));
          } catch {}
        });

        upstream.addEventListener("close", () => {
          try { ws.close(); } catch {}
        });

        upstream.addEventListener("error", () => {
          try { ws.close(); } catch {}
        });
      },

      message(ws, message) {
        const upstream = ws.data.upstream;
        if (upstream?.readyState === WebSocket.OPEN) {
          upstream.send(message);
        } else {
          // Buffer until upstream is connected
          ws.data.buffer.push(
            typeof message === "string" ? message : (message as Buffer).buffer,
          );
        }
      },

      close(ws) {
        const upstream = ws.data.upstream;
        if (upstream && upstream.readyState !== WebSocket.CLOSED) {
          upstream.close();
        }
      },
    },
  });

  console.log(`[relay] Accepting sub-nodes on port ${port}, forwarding to ${panelUrl}`);
}
