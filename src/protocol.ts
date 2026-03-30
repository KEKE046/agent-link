// Shared WS protocol types between Panel and Node

// --- Node → Panel ---

export interface MsgRegister {
  type: "register";
  machineId: string;
  label: string;
  auth?: string; // HMAC-SHA256(token, machineId) — proves knowledge of shared secret
}

export interface MsgHeartbeat {
  type: "heartbeat";
  activeSessionIds: string[];
  vscodeServers: { cwd: string; id: string; commit: string; port: number }[];
}

export interface MsgEvent {
  type: "event";
  sessionId: string;
  event: any;
}

export interface MsgResponse {
  type: "response";
  requestId: string;
  data: any;
}

export interface MsgError {
  type: "error";
  requestId: string;
  error: string;
}

export interface MsgTunnelResponse {
  type: "tunnel:response";
  tunnelId: string;
  status: number;
  headers: Record<string, string>;
  body: string; // base64
  isHtml?: boolean;
}

export interface MsgTunnelWsOpened {
  type: "tunnel:ws-opened";
  tunnelId: string;
}

export interface MsgTunnelWsData {
  type: "tunnel:ws-data";
  tunnelId: string;
  data: string; // base64 for binary, raw for text
  binary?: boolean;
}

export interface MsgTunnelWsClose {
  type: "tunnel:ws-close";
  tunnelId: string;
  code?: number;
}

export type NodeToPanel =
  | MsgRegister
  | MsgHeartbeat
  | MsgEvent
  | MsgResponse
  | MsgError
  | MsgTunnelResponse
  | MsgTunnelWsOpened
  | MsgTunnelWsData
  | MsgTunnelWsClose;

// --- Panel → Node ---

export interface MsgRegistered {
  type: "registered";
  nodeId: string;
}

export interface MsgPending {
  type: "pending";
}

export interface MsgRequest {
  type: "request";
  requestId: string;
  action: string;
  params: any;
}

export interface MsgPing {
  type: "ping";
}

export interface MsgTunnelRequest {
  type: "tunnel:request";
  tunnelId: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: string; // base64
}

export interface MsgTunnelWsOpen {
  type: "tunnel:ws-open";
  tunnelId: string;
  path: string;
  headers: Record<string, string>;
}

// Panel reuses MsgTunnelWsData and MsgTunnelWsClose for sending to Node too
export type PanelToNode =
  | MsgRegistered
  | MsgPending
  | MsgRequest
  | MsgPing
  | MsgTunnelRequest
  | MsgTunnelWsOpen
  | MsgTunnelWsData
  | MsgTunnelWsClose;
