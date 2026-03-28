import { load, save } from "./store";

export interface ManagedSession {
  id: string;
  nodeId?: string;
  cwd: string;
  createdAt: number;
}

function readAll(): ManagedSession[] {
  const data = load<ManagedSession[]>("managed-sessions", []);
  return Array.isArray(data) ? data : [];
}

export function listManaged(): ManagedSession[] {
  return readAll();
}

export function addManaged(session: ManagedSession): ManagedSession[] {
  const all = readAll().filter((item) => item.id !== session.id);
  all.unshift(session);
  save("managed-sessions", all);
  return all;
}

export function removeManaged(id: string): ManagedSession[] {
  const all = readAll().filter((item) => item.id !== id);
  save("managed-sessions", all);
  return all;
}
