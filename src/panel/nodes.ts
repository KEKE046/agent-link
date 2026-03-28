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
  key: string;
  label: string;
  ws: WebSocket;
  online: boolean;
  approved: boolean;
  activeSessionIds: string[];
  vscodeServers: { cwd: string; id: string; commit: string; port: number }[];
  connectedAt: number;
  lastHeartbeat: number;
}

const nodeRecords = load<Record<string, NodeRecord>>("nodes", {});
const nodes = new Map<string, ConnectedNode>();
const nodeKeyById = new Map<string, string>();
const pendingRequests = new Map<
  string,
  { resolve: (data: any) => void; reject: (err: Error) => void; timer: Timer }
>();

for (const [key, record] of Object.entries(nodeRecords)) {
  nodeKeyById.set(record.nodeId, key);
}

const eventListeners = new Map<string, Set<Listener>>();
const eventBuffers = new Map<string, any[]>();

function persistNodeRecords() {
  save("nodes", nodeRecords);
}

export function getNode(nodeId: string): ConnectedNode | undefined {
  return nodes.get(nodeId);
}

export function listNodes(): {
  nodeId: string;
  label: string;
  online: boolean;
  approved: boolean;
  activeSessionIds: string[];
  vscodeServers: ConnectedNode["vscodeServers"];
}[] {
  const knownIds = new Set<string>();
  const data = Object.entries(nodeRecords).map(([key, record]) => {
    const online = nodes.get(record.nodeId);
    knownIds.add(record.nodeId);
    return {
      nodeId: record.nodeId,
      label: online?.label || record.label,
      online: !!online?.online,
      approved: record.approved,
      activeSessionIds: online?.activeSessionIds || [],
      vscodeServers: online?.vscodeServers || [],
      key,
    };
  });
  for (const node of nodes.values()) {
    if (knownIds.has(node.nodeId)) continue;
    data.push({
      nodeId: node.nodeId,
      label: node.label,
      online: node.online,
      approved: node.approved,
      activeSessionIds: node.activeSessionIds,
      vscodeServers: node.vscodeServers,
      key: node.key,
    });
  }
  return data.map(({ key, ...rest }) => rest);
}

function sendToNode(node: ConnectedNode, msg: PanelToNode) {
  if (node.ws.readyState === WebSocket.OPEN) {
    node.ws.send(JSON.stringify(msg));
  }
}

let reqCounter = 0;

export function requestNode(
  nodeId: string,
  action: string,
  params: any,
  timeoutMs = 30000
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

export function subscribeSession(
  sessionId: string,
  listener: Listener
): () => void {
  const buf = eventBuffers.get(sessionId);
  if (buf) buf.forEach((msg) => listener(msg));

  if (!eventListeners.has(sessionId)) eventListeners.set(sessionId, new Set());
  eventListeners.get(sessionId)!.add(listener);

  return () => {
    eventListeners.get(sessionId)?.delete(listener);
  };
}

function broadcastEvent(sessionId: string, event: any) {
  if (!eventBuffers.has(sessionId)) eventBuffers.set(sessionId, []);
  eventBuffers.get(sessionId)!.push(event);
  eventListeners.get(sessionId)?.forEach((fn) => {
    try {
      fn(event);
    } catch {}
  });
}

export function clearEventBuffer(sessionId: string) {
  eventBuffers.set(sessionId, []);
}

export function findNodeForSession(
  sessionId: string
): ConnectedNode | undefined {
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
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }

  const node = nodes.get(nodeId);

  switch (msg.type) {
    case "heartbeat":
      if (node) {
        node.lastHeartbeat = Date.now();
        const record = nodeRecords[node.key];
        if (record) {
          record.lastSeen = node.lastHeartbeat;
          persistNodeRecords();
        }
        if (node.approved) {
          node.activeSessionIds = msg.activeSessionIds;
          node.vscodeServers = msg.vscodeServers;
        }
      }
      break;

    case "event":
      if (node?.approved) {
        broadcastEvent(msg.sessionId, msg.event);
      }
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
      const pending2 = pendingRequests.get(msg.requestId);
      if (pending2) {
        clearTimeout(pending2.timer);
        pendingRequests.delete(msg.requestId);
        pending2.reject(new Error(msg.error));
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

type TunnelMessageHandler = (
  msg: Extract<NodeToPanel, { type: `tunnel:${string}` }>
) => void;

let tunnelHandler: TunnelMessageHandler | null = null;

export function onTunnelMessage(handler: TunnelMessageHandler) {
  tunnelHandler = handler;
}

export function registerNode(
  ws: WebSocket,
  key: string,
  label: string
): { nodeId: string; approved: boolean } {
  const now = Date.now();
  let record = nodeRecords[key];
  if (!record) {
    const nodeId = `node_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    record = {
      nodeId,
      label,
      approved: false,
      firstSeen: now,
      lastSeen: now,
    };
    nodeRecords[key] = record;
    persistNodeRecords();
  } else {
    record.label = label || record.label;
    record.lastSeen = now;
    persistNodeRecords();
  }
  nodeKeyById.set(record.nodeId, key);

  const existing = nodes.get(record.nodeId);
  if (existing && existing.ws !== ws && existing.ws.readyState !== WebSocket.CLOSED) {
    existing.ws.close();
  }

  nodes.set(record.nodeId, {
    nodeId: record.nodeId,
    key,
    label: record.label,
    ws: ws as any,
    online: true,
    approved: record.approved,
    activeSessionIds: [],
    vscodeServers: [],
    connectedAt: now,
    lastHeartbeat: now,
  });

  return { nodeId: record.nodeId, approved: record.approved };
}

export function approveNode(nodeId: string): boolean {
  const key = nodeKeyById.get(nodeId);
  if (!key) return false;
  const record = nodeRecords[key];
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
  const key = nodeKeyById.get(nodeId);
  if (!key || !label) return false;
  const record = nodeRecords[key];
  if (!record) return false;
  record.label = label;
  record.lastSeen = Date.now();
  persistNodeRecords();
  const node = nodes.get(nodeId);
  if (node) node.label = label;
  return true;
}

export function markOffline(nodeId: string) {
  const node = nodes.get(nodeId);
  if (node) {
    node.online = false;
    node.activeSessionIds = [];
    node.vscodeServers = [];
    const record = nodeRecords[node.key];
    if (record) {
      record.lastSeen = Date.now();
      persistNodeRecords();
    }
  }
}

setInterval(() => {
  for (const node of nodes.values()) {
    if (node.online) {
      sendToNode(node, { type: "ping" });
    }
  }
}, 30000);
