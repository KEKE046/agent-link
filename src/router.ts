// Router — dispatches requests to local backend or remote nodes by nodeId.
// Central point for all node-level operations; routes.ts delegates here.

import * as sessions from "./sessions";
import { dispatch as localDispatch } from "./dispatch";
import { listActiveServers, getActiveServerById } from "./vscode";

type Listener = (msg: any) => void;

export interface RemoteProvider {
  requestNode(nodeId: string, action: string, params: any): Promise<any>;
  subscribeSession(sessionId: string, listener: Listener): () => void;
  clearEventBuffer(sessionId: string): void;
  findNodeForSession(sessionId: string): { nodeId: string } | undefined;
  listNodes(): {
    nodeId: string; label: string; online: boolean; approved: boolean;
    activeSessionIds: string[]; vscodeServers: any[];
  }[];
  approveNode?(nodeId: string): boolean;
  renameNode?(nodeId: string, label: string): boolean;
  removeNode?(nodeId: string): boolean;
}

export class Router {
  readonly localId: string | null;
  private remote: RemoteProvider | null = null;

  constructor(localId: string | null) {
    this.localId = localId;
  }

  get hasLocal(): boolean { return this.localId !== null; }
  get hasRemote(): boolean { return this.remote !== null; }

  setRemoteProvider(provider: RemoteProvider) {
    this.remote = provider;
  }

  isLocal(nodeId?: string): boolean {
    if (!this.localId) return false;
    return !nodeId || nodeId === this.localId;
  }

  // --- Core dispatch ---

  async dispatch(nodeId: string | undefined, action: string, params: any): Promise<any> {
    if (this.isLocal(nodeId)) {
      return localDispatch(action, params);
    }
    if (this.remote && nodeId) {
      if (action === "query" && params.sessionId) {
        this.remote.clearEventBuffer(params.sessionId);
      }
      return this.remote.requestNode(nodeId, action, params);
    }
    throw new Error(`Node ${nodeId || "(none)"} not found`);
  }

  findNodeForSession(sessionId: string): string | undefined {
    if (this.localId && sessions.isActive(sessionId)) return this.localId;
    return this.remote?.findNodeForSession(sessionId)?.nodeId;
  }

  // --- SSE subscribe (unified local + remote) ---

  subscribe(sessionId: string, listener: Listener): () => void {
    const unsubs: (() => void)[] = [];
    if (this.hasLocal) unsubs.push(sessions.subscribe(sessionId, listener));
    if (this.remote) unsubs.push(this.remote.subscribeSession(sessionId, listener));
    return () => unsubs.forEach(fn => fn());
  }

  // --- Aggregation across all nodes ---

  listNodes(): any[] {
    const result: any[] = [];
    const seen = new Set<string>();
    if (this.localId) {
      seen.add(this.localId);
      result.push({
        nodeId: this.localId, label: this.localId, online: true, approved: true,
        activeSessionIds: sessions.getActiveIds(),
        vscodeServers: listActiveServers(),
      });
    }
    if (this.remote) {
      for (const node of this.remote.listNodes()) {
        if (seen.has(node.nodeId)) continue;
        result.push(node);
      }
    }
    return result;
  }

  approveNode(nodeId: string): boolean {
    if (!this.remote) return false;
    return this.remote.approveNode?.(nodeId) ?? false;
  }

  renameNode(nodeId: string, label: string): boolean {
    if (!this.remote) return false;
    return this.remote.renameNode?.(nodeId, label) ?? false;
  }

  removeNode(nodeId: string): boolean {
    if (!this.remote) return false;
    return this.remote.removeNode?.(nodeId) ?? false;
  }

  getAllActiveIds(): string[] {
    const ids: string[] = [];
    if (this.hasLocal) ids.push(...sessions.getActiveIds());
    if (this.remote) {
      for (const node of this.remote.listNodes()) {
        if (node.online) ids.push(...node.activeSessionIds);
      }
    }
    return ids;
  }

  async listAllSessions(cwd?: string, limit = 50, offset = 0): Promise<any[]> {
    const results: any[] = [];
    if (this.hasLocal) {
      try {
        const local = await sessions.listSessions(cwd, limit, offset);
        for (const s of local || []) results.push({ ...s, nodeId: this.localId });
      } catch {}
    }
    if (this.remote) {
      for (const node of this.remote.listNodes()) {
        if (!node.online) continue;
        try {
          const remote = await this.remote.requestNode(node.nodeId, "listSessions", { cwd, limit, offset });
          for (const s of remote || []) results.push({ ...s, nodeId: node.nodeId });
        } catch {}
      }
    }
    results.sort((a, b) => (b.lastModified || 0) - (a.lastModified || 0));
    return results.slice(0, limit);
  }

  async findSessionInfo(sessionId: string, cwd?: string): Promise<any | null> {
    if (this.hasLocal) {
      try {
        const info = await sessions.getSessionInfo(sessionId, cwd);
        if (info) return { ...info, nodeId: this.localId };
      } catch {}
    }
    if (this.remote) {
      for (const node of this.remote.listNodes()) {
        if (!node.online) continue;
        try {
          const info = await this.remote.requestNode(node.nodeId, "getSessionInfo", { sessionId, cwd });
          if (info) return { ...info, nodeId: node.nodeId };
        } catch {}
      }
    }
    return null;
  }

  async findSessionMessages(sessionId: string, cwd?: string, limit = 200, offset = 0): Promise<any | null> {
    if (this.hasLocal) {
      try { return await sessions.getSessionMessages(sessionId, cwd, limit, offset); } catch {}
    }
    if (this.remote) {
      for (const node of this.remote.listNodes()) {
        if (!node.online) continue;
        try {
          return await this.remote.requestNode(node.nodeId, "getSessionMessages", { sessionId, cwd, limit, offset });
        } catch {}
      }
    }
    return null;
  }

  // --- Local VSCode proxy helpers ---

  getLocalVscodeServer(id: string) {
    if (!this.hasLocal) return null;
    return getActiveServerById(id);
  }
}
