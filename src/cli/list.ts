import { getServerUrl, apiFetchOpt, col } from "./client";

export async function runList(args: string[]) {
  const url = getServerUrl(args);

  const [managed, active, nodes] = await Promise.all([
    apiFetchOpt(url, "/api/managed"),
    apiFetchOpt(url, "/api/active"),
    apiFetchOpt(url, "/api/nodes"),
  ]);

  if (!managed) {
    console.error("Error: could not connect to server");
    process.exit(1);
  }

  if (!Array.isArray(managed) || managed.length === 0) {
    console.log("No managed agents.");
    return;
  }

  // Build nodeId → label map from nodes list
  const labelMap = new Map<string, string>();
  if (Array.isArray(nodes)) {
    for (const n of nodes) labelMap.set(n.nodeId, n.label || n.nodeId);
  }

  const activeSet = new Set<string>(Array.isArray(active) ? active : []);

  const nodeLabel = (s: any) => labelMap.get(s.nodeId) || s.nodeId || "?";

  // Compute column widths
  const nodeW = Math.min(20, Math.max(6, ...managed.map((s: any) => nodeLabel(s).length)));
  const nameW = Math.min(30, Math.max(6, ...managed.map((s: any) => (s.name || "").length)));
  const bioW = Math.min(40, Math.max(4, ...managed.map((s: any) => (s.bio || "").length)));

  const header = `${"ACT"} ${ col("NODE", nodeW)} ${col("NAME", nameW)} ${col("BIO", bioW)}`;
  console.log(header);
  console.log("-".repeat(header.length));

  for (const s of managed) {
    const act = activeSet.has(s.id) ? " ● " : " ○ ";
    const node = col(nodeLabel(s), nodeW);
    const name = col(s.name || "", nameW);
    const bio = col(s.bio || "", bioW);
    console.log(`${act}${node} ${name} ${bio}`);
  }
}
