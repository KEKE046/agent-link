import { getServerUrl, apiFetchOpt, findAgent, positionalArgs } from "./client";

export async function runInspect(args: string[]) {
  const url = getServerUrl(args);
  const queries = positionalArgs(args);

  if (queries.length === 0) {
    console.error("Usage: agent-link inspect <name|id>...");
    process.exit(1);
  }

  const [managed, active] = await Promise.all([
    apiFetchOpt(url, "/api/managed"),
    apiFetchOpt(url, "/api/active"),
  ]);

  if (!managed) {
    console.error("Error: could not connect to server");
    process.exit(1);
  }

  const activeSet = new Set<string>(Array.isArray(active) ? active : []);

  for (let i = 0; i < queries.length; i++) {
    if (i > 0) console.log();
    const q = queries[i];
    const agent = findAgent(managed, q);
    if (!agent) {
      console.error(`Not found: ${q}`);
      continue;
    }
    console.log(`Name:      ${agent.name}`);
    if (agent.bio) console.log(`Bio:       ${agent.bio}`);
    console.log(`Session:   ${agent.id}`);
    console.log(`Node:      ${agent.nodeId || "(local)"}`);
    console.log(`CWD:       ${agent.cwd}`);
    console.log(`Active:    ${activeSet.has(agent.id) ? "yes" : "no"}`);
    console.log(`Created:   ${new Date(agent.createdAt).toLocaleString()}`);
    if (agent.params?.claude && Object.keys(agent.params.claude).length > 0) {
      console.log(`Params:    ${JSON.stringify(agent.params.claude)}`);
    }
  }
}
