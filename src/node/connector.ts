import type { PanelToNode, NodeToPanel } from "../protocol";
import * as sessions from "../sessions";
import {
  listInstalledVersions,
  startVscodeServer,
  stopVscodeServer,
  listActiveServers,
  getInstallCommand,
} from "../vscode";
import {
  startFork,
  getFork,
  listForks,
  cancelFork,
  deleteForkDir,
} from "../fork";
import { handleTunnelRequest, handleTunnelWsOpen, handleTunnelWsData, handleTunnelWsClose } from "./tunnel";

let ws: WebSocket | null = null;
let nodeId: string | null = null;
let reconnectDelay = 1000;
let heartbeatTimer: Timer | null = null;
let eventForwardingTimer: Timer | null = null;
let connected = false;

const label = Bun.env.NODE_LABEL || `node-${Math.random().toString(36).slice(2, 8)}`;

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
        cwd: s.cwd,
        id: s.id,
        commit: s.commit,
        port: s.port,
      })),
    });
  }, 10000);
}

async function handleRequest(msg: { requestId: string; action: string; params: any }) {
  try {
    let data: any;
    switch (msg.action) {
      case "query": {
        const { prompt, cwd, model, sessionId } = msg.params;
        const id = await sessions.startQuery(prompt, { sessionId, cwd, model });
        data = { sessionId: id };
        break;
      }
      case "interrupt": {
        await sessions.interrupt(msg.params.sessionId);
        data = { ok: true };
        break;
      }
      case "setModel": {
        await sessions.setModel(msg.params.sessionId, msg.params.model);
        data = { ok: true };
        break;
      }
      case "listSessions": {
        data = await sessions.listSessions(
          msg.params.cwd,
          msg.params.limit || 50,
          msg.params.offset || 0
        );
        break;
      }
      case "getSessionInfo": {
        data = await sessions.getSessionInfo(
          msg.params.sessionId,
          msg.params.cwd
        );
        break;
      }
      case "getSessionMessages": {
        data = await sessions.getSessionMessages(
          msg.params.sessionId,
          msg.params.cwd,
          msg.params.limit || 200,
          msg.params.offset || 0
        );
        break;
      }
      case "listVscodeVersions": {
        data = await listInstalledVersions();
        break;
      }
      case "startVscodeServer": {
        data = await startVscodeServer(msg.params.cwd, msg.params.commit);
        break;
      }
      case "stopVscodeServer": {
        data = { ok: await stopVscodeServer(msg.params.cwd) };
        break;
      }
      case "getInstallCommand": {
        data = getInstallCommand(msg.params.version);
        break;
      }
      case "startFork": {
        data = await startFork(msg.params.sessionId, msg.params.cwd);
        break;
      }
      case "getFork": {
        data = getFork(msg.params.forkId);
        break;
      }
      case "listForks": {
        data = listForks();
        break;
      }
      case "cancelFork": {
        data = { ok: cancelFork(msg.params.forkId) };
        break;
      }
      case "deleteFork": {
        data = { ok: await deleteForkDir(msg.params.forkId) };
        break;
      }
      default:
        throw new Error(`Unknown action: ${msg.action}`);
    }
    send({ type: "response", requestId: msg.requestId, data });
  } catch (err: any) {
    send({ type: "error", requestId: msg.requestId, error: err.message });
  }
}

function handleMessage(raw: string) {
  let msg: PanelToNode;
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }

  switch (msg.type) {
    case "registered":
      nodeId = msg.nodeId;
      console.log(`[node] Registered as ${nodeId}`);
      break;
    case "request":
      handleRequest(msg);
      break;
    case "ping":
      // No-op, keeps connection alive
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

// Set up session event forwarding: subscribe to all active sessions
// and forward events through the WS
const forwarded = new Map<string, () => void>(); // sessionId → unsub

function setupEventForwarding() {
  // Clean up previous timer if reconnecting
  if (eventForwardingTimer) clearInterval(eventForwardingTimer);

  // Check for new active sessions periodically and subscribe
  eventForwardingTimer = setInterval(() => {
    const activeIds = new Set(sessions.getActiveIds());

    // Subscribe to new sessions
    for (const id of activeIds) {
      if (forwarded.has(id)) continue;
      try {
        const unsub = sessions.subscribe(id, (event) => {
          send({ type: "event", sessionId: id, event });
        });
        forwarded.set(id, unsub);
      } catch {}
    }

    // Clean up ended sessions
    for (const [id, unsub] of forwarded) {
      if (!activeIds.has(id)) {
        unsub();
        forwarded.delete(id);
      }
    }
  }, 500);
}

export function connect(panelUrl: string, token: string) {
  const wsUrl = panelUrl.replace(/^http/, "ws") + "/ws/node";
  console.log(`[node] Connecting to ${wsUrl}...`);

  ws = new WebSocket(wsUrl);

  ws.addEventListener("open", () => {
    connected = true;
    reconnectDelay = 1000;
    console.log("[node] Connected to Panel");

    send({
      type: "register",
      token,
      nodeId: nodeId || undefined,
      label,
    });

    scheduleHeartbeat();
    setupEventForwarding();
  });

  ws.addEventListener("message", (e) => {
    handleMessage(typeof e.data === "string" ? e.data : new TextDecoder().decode(e.data as any));
  });

  ws.addEventListener("close", () => {
    connected = false;
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (eventForwardingTimer) clearInterval(eventForwardingTimer);
    // Clean up all forwarding subscriptions
    for (const [, unsub] of forwarded) unsub();
    forwarded.clear();
    console.log(`[node] Disconnected. Reconnecting in ${reconnectDelay}ms...`);
    setTimeout(() => {
      reconnectDelay = Math.min(reconnectDelay * 2, 60000);
      connect(panelUrl, token);
    }, reconnectDelay);
  });

  ws.addEventListener("error", () => {
    // close event will fire after this
  });
}
