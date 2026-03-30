import { getServerUrl, apiFetch, positionalArgs } from "./client";

export async function runApprove(args: string[]) {
  const url = getServerUrl(args);
  const nodeIds = positionalArgs(args);

  if (nodeIds.length === 0) {
    console.error("Usage: agent-link approve <nodeId>...");
    process.exit(1);
  }

  for (const nodeId of nodeIds) {
    try {
      await apiFetch(url, `/api/nodes/${encodeURIComponent(nodeId)}/approve`, { method: "POST" });
      console.log(`Approved: ${nodeId}`);
    } catch (err: any) {
      console.error(`Failed to approve ${nodeId}: ${err.message}`);
    }
  }
}
