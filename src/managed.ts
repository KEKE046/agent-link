import { load, save } from "./store";

export interface ManagedSession {
  id: string;
  nodeId?: string;
  cwd: string;
  createdAt: number;
}

export interface ManagedFolder {
  cwd: string;
  nodeId?: string;
  label?: string;
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

// --- Managed Folders ---

function readFolders(): ManagedFolder[] {
  const data = load<ManagedFolder[]>("managed-folders", []);
  return Array.isArray(data) ? data : [];
}

export function listFolders(): ManagedFolder[] {
  return readFolders();
}

export function addFolder(folder: ManagedFolder): ManagedFolder[] {
  const all = readFolders();
  const exists = all.some(
    (f) => f.cwd === folder.cwd && (f.nodeId || "") === (folder.nodeId || "")
  );
  if (exists) return all;
  all.push(folder);
  save("managed-folders", all);
  return all;
}

export function removeFolder(cwd: string, nodeId?: string): ManagedFolder[] {
  const all = readFolders().filter(
    (f) => !(f.cwd === cwd && (f.nodeId || "") === (nodeId || ""))
  );
  save("managed-folders", all);
  return all;
}

export function renameFolder(cwd: string, nodeId: string | undefined, label: string): ManagedFolder[] {
  const all = readFolders();
  const f = all.find(
    (f) => f.cwd === cwd && (f.nodeId || "") === (nodeId || "")
  );
  if (f) {
    f.label = label || undefined;
    save("managed-folders", all);
  }
  return all;
}
