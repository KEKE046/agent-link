import { getServerUrl, apiFetchOpt } from "./client";

export async function runStatus(args: string[]) {
  const url = getServerUrl(args);
  console.log(`Server: ${url}`);

  const [auth, nodes, active] = await Promise.all([
    apiFetchOpt(url, "/api/auth/check"),
    apiFetchOpt(url, "/api/nodes"),
    apiFetchOpt(url, "/api/active"),
  ]);

  if (!auth && !nodes && !active) {
    console.error("Error: could not connect to server");
    process.exit(1);
  }

  if (auth) {
    const authStatus = !auth.required ? "disabled" : auth.authenticated ? "enabled" : "enabled (not authenticated)";
    console.log(`Auth:   ${authStatus}`);
  }

  if (Array.isArray(nodes)) {
    console.log(`Mode:   panel (${nodes.filter((n: any) => n.online).length} nodes online)`);
    console.log();
    console.log("Nodes:");
    if (nodes.length === 0) {
      console.log("  (none)");
    } else {
      for (const n of nodes) {
        const dot = n.online ? "●" : "○";
        const approved = n.approved ? "" : " [pending]";
        const label = n.label && n.label !== n.nodeId ? ` (${n.label})` : "";
        console.log(`  ${dot}  ${n.nodeId}${label}${approved}`);
      }
    }
  } else {
    console.log(`Mode:   standalone`);
  }

  if (Array.isArray(active) && active.length > 0) {
    console.log();
    console.log(`Active sessions: ${active.length}`);
    for (const id of active) console.log(`  ${id}`);
  } else {
    console.log();
    console.log(`Active sessions: 0`);
  }
}
