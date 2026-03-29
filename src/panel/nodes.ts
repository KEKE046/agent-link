import type { NodeToPanel, PanelToNode } from "../protocol";
import { load, save } from "../store";

type Listener = (msg: any) => void;

interface NodeRecord {
  nodeId: string;
  label: string;
  approved: boolean;
  firstSeen: number;
  lastSeen: number;
}

export interface ConnectedNode {
  nodeId: string;
  machineId: string;
  label: string;
  ws: WebSocket;
  online: boolean;
  approved: boolean;
  activeSessionIds: string[];
  vscodeServers: { cwd: string; id: string; commit: string; port: number }[];
  connectedAt: number;
  lastHeartbeat: number;
}

// Persisted records keyed by machineId
const nodeRecords = load<Record<string, NodeRecord>>("nodes", {});
// Live connected nodes keyed by nodeId (= machineId)
const nodes = new Map<string, ConnectedNode>();

const pendingRequests = new Map<
  string,
  { resolve: (data: any) => void; reject: (err: Error) => void; timer: Timer }
>();

const eventListeners = new Map<string, Set<Listener>>();
const eventBuffers = new Map<string, any[]>();

function persistNodeRecords() {
  save("nodes", nodeRecords);
}

export function getNode(nodeId: string): ConnectedNode | undefined {
  return nodes.get(nodeId);
}

export function listNodes(): {
  nodeId: string; label: string; online: boolean; approved: boolean;
  activeSessionIds: string[]; vscodeServers: ConnectedNode["vscodeServers"];
}[] {
  const seen = new Set<string>();
  const data: any[] = [];

  // Persisted records (includes offline nodes)
  for (const [machineId, record] of Object.entries(nodeRecords)) {
    seen.add(record.nodeId);
    const live = nodes.get(record.nodeId);
    data.push({
      nodeId: record.nodeId,
      label: live?.label || record.label,
      online: !!live?.online,
      approved: record.approved,
      activeSessionIds: live?.activeSessionIds || [],
      vscodeServers: live?.vscodeServers || [],
    });
  }

  // Live nodes not yet persisted (shouldn't happen but be safe)
  for (const node of nodes.values()) {
    if (seen.has(node.nodeId)) continue;
    data.push({
      nodeId: node.nodeId, label: node.label, online: node.online,
      approved: node.approved, activeSessionIds: node.activeSessionIds,
      vscodeServers: node.vscodeServers,
    });
  }

  return data;
}

function sendToNode(node: ConnectedNode, msg: PanelToNode) {
  if (node.ws.readyState === WebSocket.OPEN) {
    node.ws.send(JSON.stringify(msg));
  }
}

let reqCounter = 0;

export function requestNode(
  nodeId: string, action: string, params: any, timeoutMs = 30000,
): Promise<any> {
  const node = nodes.get(nodeId);
  if (!node || !node.online || !node.approved) {
    return Promise.reject(new Error(`Node ${nodeId} is not online`));
  }
  const requestId = `r_${Date.now()}_${++reqCounter}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error(`Request ${action} to node ${nodeId} timed out`));
    }, timeoutMs);
    pendingRequests.set(requestId, { resolve, reject, timer });
    sendToNode(node, { type: "request", requestId, action, params });
  });
}

export function subscribeSession(sessionId: string, listener: Listener): () => void {
  const buf = eventBuffers.get(sessionId);
  if (buf) buf.forEach((msg) => listener(msg));
  if (!eventListeners.has(sessionId)) eventListeners.set(sessionId, new Set());
  eventListeners.get(sessionId)!.add(listener);
  return () => { eventListeners.get(sessionId)?.delete(listener); };
}

function broadcastEvent(sessionId: string, event: any) {
  if (!eventBuffers.has(sessionId)) eventBuffers.set(sessionId, []);
  eventBuffers.get(sessionId)!.push(event);
  eventListeners.get(sessionId)?.forEach((fn) => { try { fn(event); } catch {} });
}

export function clearEventBuffer(sessionId: string) {
  eventBuffers.set(sessionId, []);
}

export function findNodeForSession(sessionId: string): ConnectedNode | undefined {
  for (const node of nodes.values()) {
    if (node.activeSessionIds.includes(sessionId)) return node;
  }
  return undefined;
}

export function sendRaw(nodeId: string, msg: PanelToNode) {
  const node = nodes.get(nodeId);
  if (node) sendToNode(node, msg);
}

export function handleNodeMessage(nodeId: string, raw: string) {
  let msg: NodeToPanel;
  try { msg = JSON.parse(raw); } catch { return; }

  const node = nodes.get(nodeId);

  switch (msg.type) {
    case "heartbeat":
      if (node) {
        node.lastHeartbeat = Date.now();
        if (node.approved) {
          node.activeSessionIds = msg.activeSessionIds;
          node.vscodeServers = msg.vscodeServers;
        }
      }
      break;
    case "event":
      if (node?.approved) broadcastEvent(msg.sessionId, msg.event);
      break;
    case "response": {
      const pending = pendingRequests.get(msg.requestId);
      if (pending) {
        clearTimeout(pending.timer);
        pendingRequests.delete(msg.requestId);
        pending.resolve(msg.data);
      }
      break;
    }
    case "error": {
      const pending = pendingRequests.get(msg.requestId);
      if (pending) {
        clearTimeout(pending.timer);
        pendingRequests.delete(msg.requestId);
        pending.reject(new Error(msg.error));
      }
      break;
    }
    case "tunnel:response":
    case "tunnel:ws-opened":
    case "tunnel:ws-data":
    case "tunnel:ws-close":
      if (node?.approved) tunnelHandler?.(msg);
      break;
  }
}

type TunnelMessageHandler = (msg: Extract<NodeToPanel, { type: `tunnel:${string}` }>) => void;
let tunnelHandler: TunnelMessageHandler | null = null;

export function onTunnelMessage(handler: TunnelMessageHandler) {
  tunnelHandler = handler;
}

export function registerNode(
  ws: WebSocket, machineId: string, label: string,
): { nodeId: string; approved: boolean } {
  const now = Date.now();
  // machineId IS the nodeId — no separate ID generation
  const nodeId = machineId;

  let record = nodeRecords[machineId];
  if (!record) {
    record = { nodeId, label, approved: false, firstSeen: now, lastSeen: now };
    nodeRecords[machineId] = record;
    persistNodeRecords();
  } else {
    record.label = label || record.label;
    record.lastSeen = now;
    persistNodeRecords();
  }

  // Close existing connection if any
  const existing = nodes.get(nodeId);
  if (existing && existing.ws !== ws && existing.ws.readyState !== WebSocket.CLOSED) {
    existing.ws.close();
  }

  nodes.set(nodeId, {
    nodeId, machineId, label: record.label,
    ws: ws as any, online: true, approved: record.approved,
    activeSessionIds: [], vscodeServers: [],
    connectedAt: now, lastHeartbeat: now,
  });

  return { nodeId, approved: record.approved };
}

export function approveNode(nodeId: string): boolean {
  const record = nodeRecords[nodeId];
  if (!record) return false;
  record.approved = true;
  record.lastSeen = Date.now();
  persistNodeRecords();
  const node = nodes.get(nodeId);
  if (node) {
    node.approved = true;
    sendToNode(node, { type: "registered", nodeId });
  }
  return true;
}

export function renameNode(nodeId: string, label: string): boolean {
  const record = nodeRecords[nodeId];
  if (!record || !label) return false;
  record.label = label;
  record.lastSeen = Date.now();
  persistNodeRecords();
  const node = nodes.get(nodeId);
  if (node) node.label = label;
  return true;
}

export function removeNode(nodeId: string): boolean {
  const record = nodeRecords[nodeId];
  if (!record) return false;
  delete nodeRecords[nodeId];
  persistNodeRecords();
  const node = nodes.get(nodeId);
  if (node) {
    nodes.delete(nodeId);
    if (node.ws.readyState !== WebSocket.CLOSED) node.ws.close();
  }
  return true;
}

export function markOffline(nodeId: string) {
  const node = nodes.get(nodeId);
  if (node) {
    node.online = false;
    node.activeSessionIds = [];
    node.vscodeServers = [];
    const record = nodeRecords[node.machineId];
    if (record) { record.lastSeen = Date.now(); persistNodeRecords(); }
  }
}

// Periodic ping to keep connections alive
setInterval(() => {
  for (const node of nodes.values()) {
    if (node.online) sendToNode(node, { type: "ping" });
  }
}, 30000);
