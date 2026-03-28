import type {
  NodeToPanel,
  PanelToNode,
  MsgRequest,
  MsgEvent,
  MsgResponse,
  MsgError,
} from "../protocol";

type Listener = (msg: any) => void;

export interface ConnectedNode {
  nodeId: string;
  label: string;
  ws: WebSocket;
  online: boolean;
  activeSessionIds: string[];
  vscodeServers: { cwd: string; id: string; commit: string; port: number }[];
  connectedAt: number;
  lastHeartbeat: number;
}

const nodes = new Map<string, ConnectedNode>();
const pendingRequests = new Map<
  string,
  { resolve: (data: any) => void; reject: (err: Error) => void; timer: Timer }
>();

// SSE event listeners per session: Panel subscribes browser SSE here
const eventListeners = new Map<string, Set<Listener>>();
const eventBuffers = new Map<string, any[]>();

// Valid tokens (simple set for POC)
const validTokens = new Set<string>();

let tokenCounter = 0;

export function generateToken(): string {
  const token = `tok_${Date.now()}_${++tokenCounter}_${Math.random().toString(36).slice(2, 10)}`;
  validTokens.add(token);
  return token;
}

export function listTokens(): string[] {
  return [...validTokens];
}

export function revokeToken(token: string): boolean {
  return validTokens.delete(token);
}

export function getNode(nodeId: string): ConnectedNode | undefined {
  return nodes.get(nodeId);
}

export function listNodes(): {
  nodeId: string;
  label: string;
  online: boolean;
  activeSessionIds: string[];
  vscodeServers: ConnectedNode["vscodeServers"];
}[] {
  return [...nodes.values()].map((n) => ({
    nodeId: n.nodeId,
    label: n.label,
    online: n.online,
    activeSessionIds: n.activeSessionIds,
    vscodeServers: n.vscodeServers,
  }));
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
  if (!node || !node.online) {
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

// Subscribe to session events coming from any node
export function subscribeSession(
  sessionId: string,
  listener: Listener
): () => void {
  // Replay buffer
  const buf = eventBuffers.get(sessionId);
  if (buf) buf.forEach((msg) => listener(msg));

  if (!eventListeners.has(sessionId))
    eventListeners.set(sessionId, new Set());
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

// Clear event buffer when a new query starts
export function clearEventBuffer(sessionId: string) {
  eventBuffers.set(sessionId, []);
}

// Find which node owns a session
export function findNodeForSession(
  sessionId: string
): ConnectedNode | undefined {
  for (const node of nodes.values()) {
    if (node.activeSessionIds.includes(sessionId)) return node;
  }
  return undefined;
}

// Send raw protocol message to a node's WS
export function sendRaw(nodeId: string, msg: PanelToNode) {
  const node = nodes.get(nodeId);
  if (node) sendToNode(node, msg);
}

// Handle incoming WS message from a node
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
        node.activeSessionIds = msg.activeSessionIds;
        node.vscodeServers = msg.vscodeServers;
      }
      break;

    case "event":
      broadcastEvent(msg.sessionId, msg.event);
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

    // Tunnel messages are handled by tunnel.ts via onTunnelMessage callback
    case "tunnel:response":
    case "tunnel:ws-opened":
    case "tunnel:ws-data":
    case "tunnel:ws-close":
      tunnelHandler?.(msg);
      break;
  }
}

type TunnelMessageHandler = (
  msg: Extract<
    NodeToPanel,
    { type: `tunnel:${string}` }
  >
) => void;

let tunnelHandler: TunnelMessageHandler | null = null;

export function onTunnelMessage(handler: TunnelMessageHandler) {
  tunnelHandler = handler;
}

// Register a new node connection
export function registerNode(
  ws: WebSocket,
  token: string,
  label: string,
  requestedNodeId?: string
): string | null {
  if (!validTokens.has(token)) return null;

  // Reuse nodeId if reconnecting, otherwise generate new
  let nodeId = requestedNodeId;
  if (nodeId && nodes.has(nodeId)) {
    const existing = nodes.get(nodeId)!;
    // Close old connection if still open
    if (
      existing.ws !== ws &&
      existing.ws.readyState !== WebSocket.CLOSED
    ) {
      existing.ws.close();
    }
  }
  if (!nodeId) {
    nodeId = `node_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  nodes.set(nodeId, {
    nodeId,
    label,
    ws: ws as any,
    online: true,
    activeSessionIds: [],
    vscodeServers: [],
    connectedAt: Date.now(),
    lastHeartbeat: Date.now(),
  });

  return nodeId;
}

export function markOffline(nodeId: string) {
  const node = nodes.get(nodeId);
  if (node) {
    node.online = false;
  }
}

// Ping all nodes periodically
setInterval(() => {
  for (const node of nodes.values()) {
    if (node.online) {
      sendToNode(node, { type: "ping" });
    }
  }
}, 30000);
