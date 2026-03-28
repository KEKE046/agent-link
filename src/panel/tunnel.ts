import {
  sendRaw,
  onTunnelMessage,
  getNode,
} from "./nodes";
import type {
  MsgTunnelResponse,
  MsgTunnelWsOpened,
  MsgTunnelWsData,
  MsgTunnelWsClose,
} from "../protocol";

let tunnelCounter = 0;

// Pending HTTP tunnel requests
const httpPending = new Map<
  string,
  {
    resolve: (resp: MsgTunnelResponse) => void;
    reject: (err: Error) => void;
    timer: Timer;
  }
>();

// Active WS tunnels: tunnelId → browser-side websocket
const wsTunnels = new Map<
  string,
  {
    browserWs: any; // Bun.ServerWebSocket
    nodeId: string;
  }
>();

function rewriteRemoteAuthority(html: string, authority: string): string {
  return html
    .replace(/("remoteAuthority"\s*:\s*")[^"]+(")/, `$1${authority}$2`)
    .replace(
      /(&quot;remoteAuthority&quot;\s*:\s*&quot;)[^&]+(&quot;)/,
      `$1${authority}$2`
    );
}

// Initialize tunnel message handler
onTunnelMessage((msg) => {
  switch (msg.type) {
    case "tunnel:response": {
      const pending = httpPending.get(msg.tunnelId);
      if (pending) {
        clearTimeout(pending.timer);
        httpPending.delete(msg.tunnelId);
        pending.resolve(msg);
      }
      break;
    }
    case "tunnel:ws-opened": {
      // Node connected upstream WS successfully — nothing extra needed
      break;
    }
    case "tunnel:ws-data": {
      const tunnel = wsTunnels.get(msg.tunnelId);
      if (tunnel?.browserWs) {
        try {
          if (msg.binary) {
            tunnel.browserWs.send(Buffer.from(msg.data, "base64"));
          } else {
            tunnel.browserWs.send(msg.data);
          }
        } catch {}
      }
      break;
    }
    case "tunnel:ws-close": {
      const tunnel = wsTunnels.get(msg.tunnelId);
      if (tunnel?.browserWs) {
        try {
          tunnel.browserWs.close(msg.code || 1000);
        } catch {}
      }
      wsTunnels.delete(msg.tunnelId);
      break;
    }
  }
});

// HTTP tunnel: send request through node WS, wait for response
export async function tunnelHttpRequest(
  nodeId: string,
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: ArrayBuffer | null,
  proxyAuthority?: string,
  timeoutMs = 30000
): Promise<Response> {
  const node = getNode(nodeId);
  if (!node || !node.online) {
    return new Response("Node not online", { status: 502 });
  }

  const tunnelId = `t_${++tunnelCounter}_${Date.now()}`;
  const bodyBase64 = body
    ? Buffer.from(body).toString("base64")
    : undefined;

  const resp = await new Promise<MsgTunnelResponse>((resolve, reject) => {
    const timer = setTimeout(() => {
      httpPending.delete(tunnelId);
      reject(new Error("Tunnel request timed out"));
    }, timeoutMs);
    httpPending.set(tunnelId, { resolve, reject, timer });

    sendRaw(nodeId, {
      type: "tunnel:request",
      tunnelId,
      method,
      path,
      headers,
      body: bodyBase64,
    });
  });

  // Decode response
  let responseBody: string | ArrayBuffer = Buffer.from(
    resp.body,
    "base64"
  );

  const respHeaders = new Headers(resp.headers);

  // Rewrite remoteAuthority in HTML responses at Panel side
  if (resp.isHtml && proxyAuthority) {
    const html = rewriteRemoteAuthority(responseBody.toString(), proxyAuthority);
    respHeaders.delete("content-length");
    return new Response(html, {
      status: resp.status,
      headers: respHeaders,
    });
  }

  return new Response(responseBody, {
    status: resp.status,
    headers: respHeaders,
  });
}

// WS tunnel: open browser-side, tell node to open upstream
export function tunnelWsOpen(
  nodeId: string,
  browserWs: any,
  path: string,
  headers: Record<string, string>
): string {
  const tunnelId = `wt_${++tunnelCounter}_${Date.now()}`;
  wsTunnels.set(tunnelId, { browserWs, nodeId });

  sendRaw(nodeId, {
    type: "tunnel:ws-open",
    tunnelId,
    path,
    headers,
  });

  return tunnelId;
}

// Browser WS sent data → forward to node
export function tunnelWsSendToNode(
  tunnelId: string,
  data: string | Buffer | ArrayBuffer | Uint8Array
) {
  const tunnel = wsTunnels.get(tunnelId);
  if (!tunnel) return;

  const binary = typeof data !== "string";
  const encoded = binary
    ? Buffer.from(data as any).toString("base64")
    : (data as string);

  sendRaw(tunnel.nodeId, {
    type: "tunnel:ws-data",
    tunnelId,
    data: encoded,
    binary,
  });
}

// Browser WS closed → tell node
export function tunnelWsClose(tunnelId: string, code?: number) {
  const tunnel = wsTunnels.get(tunnelId);
  if (!tunnel) return;

  sendRaw(tunnel.nodeId, {
    type: "tunnel:ws-close",
    tunnelId,
    code,
  });

  wsTunnels.delete(tunnelId);
}
