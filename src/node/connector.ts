import type { PanelToNode, NodeToPanel } from "../protocol";
import { dispatch } from "../dispatch";
import * as sessions from "../sessions";
import { listActiveServers } from "../vscode";
import { handleTunnelRequest, handleTunnelWsOpen, handleTunnelWsData, handleTunnelWsClose } from "./tunnel";
import * as logger from "../logger";

let ws: WebSocket | null = null;
let reconnectDelay = 1000;
let heartbeatTimer: Timer | null = null;
let eventForwardingTimer: Timer | null = null;

export function send(msg: NodeToPanel) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function scheduleHeartbeat() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => {
    send({
      type: "heartbeat",
      activeSessionIds: sessions.getActiveIds(),
      vscodeServers: listActiveServers().map((s) => ({
        cwd: s.cwd, id: s.id, commit: s.commit, port: s.port,
      })),
    });
  }, 10000);
}

async function handleRequest(msg: { requestId: string; action: string; params: any }) {
  logger.debug("node", `← ${msg.action} [${msg.requestId}]`);
  try {
    const data = await dispatch(msg.action, msg.params);
    logger.debug("node", `→ response [${msg.requestId}]`);
    send({ type: "response", requestId: msg.requestId, data });
  } catch (err: any) {
    logger.error("node", `Error in ${msg.action} [${msg.requestId}]: ${err.message}`);
    send({ type: "error", requestId: msg.requestId, error: err.message });
  }
}

function handleMessage(raw: string) {
  let msg: PanelToNode;
  try { msg = JSON.parse(raw); } catch { return; }

  switch (msg.type) {
    case "registered":
      logger.log("node", `Registered as ${msg.nodeId}`);
      break;
    case "pending":
      logger.log("node", "Waiting for approval from panel...");
      break;
    case "request":
      handleRequest(msg);
      break;
    case "ping":
      break;
    case "tunnel:request":
      handleTunnelRequest(msg);
      break;
    case "tunnel:ws-open":
      handleTunnelWsOpen(msg);
      break;
    case "tunnel:ws-data":
      handleTunnelWsData(msg);
      break;
    case "tunnel:ws-close":
      handleTunnelWsClose(msg);
      break;
  }
}

// Session event forwarding: subscribe to active sessions and relay to panel
const forwarded = new Map<string, () => void>();

function setupEventForwarding() {
  if (eventForwardingTimer) clearInterval(eventForwardingTimer);
  eventForwardingTimer = setInterval(() => {
    const activeIds = new Set(sessions.getActiveIds());
    for (const id of activeIds) {
      if (forwarded.has(id)) continue;
      try {
        const unsub = sessions.subscribe(id, (event) => {
          send({ type: "event", sessionId: id, event });
        });
        forwarded.set(id, unsub);
      } catch {}
    }
    for (const [id, unsub] of forwarded) {
      if (!activeIds.has(id)) { unsub(); forwarded.delete(id); }
    }
  }, 500);
}

export function connect(panelUrl: string, machineId: string, label: string) {
  const wsUrl = panelUrl.replace(/^http/, "ws") + "/ws/node";
  logger.log("node", `Connecting to ${wsUrl}...`);

  ws = new WebSocket(wsUrl);

  ws.addEventListener("open", () => {
    reconnectDelay = 1000;
    logger.log("node", "Connected to panel");
    send({ type: "register", machineId, label });
    scheduleHeartbeat();
    setupEventForwarding();
  });

  ws.addEventListener("message", (e) => {
    handleMessage(typeof e.data === "string" ? e.data : new TextDecoder().decode(e.data as any));
  });

  ws.addEventListener("close", () => {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (eventForwardingTimer) clearInterval(eventForwardingTimer);
    for (const [, unsub] of forwarded) unsub();
    forwarded.clear();
    logger.warn("node", `Disconnected. Reconnecting in ${reconnectDelay}ms...`);
    setTimeout(() => {
      reconnectDelay = Math.min(reconnectDelay * 2, 60000);
      connect(panelUrl, machineId, label);
    }, reconnectDelay);
  });

  ws.addEventListener("error", () => {});
}
