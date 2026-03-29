import { getServerUrl, apiFetch, apiFetchOpt, findAgent, positionalArgs } from "./client";

export async function runBio(args: string[]) {
  await runSelfWrite(args, "bio");
}

export async function runIntro(args: string[]) {
  await runSelfWrite(args, "intro");
}

async function runSelfWrite(args: string[], field: "bio" | "intro") {
  const url = getServerUrl(args);
  const pos = positionalArgs(args);

  // With 2+ positional args: first is name|id, second is text
  // With 1 positional arg: text, agent from AGENT_LINK_AGENT_NAME
  let targetQuery: string | undefined;
  let text: string | undefined;

  const selfName = Bun.env.AGENT_LINK_AGENT_NAME;

  if (pos.length >= 2) {
    if (selfName) {
      console.error(`Error: cannot set another agent's ${field} from within a managed session`);
      process.exit(1);
    }
    targetQuery = pos[0];
    text = pos.slice(1).join(" ");
  } else if (pos.length === 1) {
    targetQuery = selfName;
    text = pos[0];
  }

  if (!targetQuery || !text) {
    const label = field === "bio" ? "one-line bio" : "intro paragraph";
    console.error(`Usage: agent-link ${field} [name|id] <${label}>`);
    console.error(`(or set AGENT_LINK_AGENT_NAME and omit name|id)`);
    process.exit(1);
  }

  const managed = await apiFetchOpt(url, "/api/managed");
  if (!managed) { console.error("Error: could not connect to server"); process.exit(1); }

  const agent = findAgent(managed, targetQuery);
  if (!agent) { console.error(`Agent not found: ${targetQuery}`); process.exit(1); }

  await apiFetch(url, `/api/managed/${agent.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ [field]: text }),
  });

  console.log(`✓ Saved ${agent.name}'s ${field}: ${text}`);
}
