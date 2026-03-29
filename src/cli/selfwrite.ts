import { getServerUrl, apiFetchOpt, apiFetch, findAgent, positionalArgs, authFetch } from "./client";

const BIO_PROMPT =
  "In one sentence, describe yourself as an AI agent: what specific types of problems or requests should other agents come to you with? " +
  "Reply with ONLY the sentence — no preamble, no quotes, no punctuation other than what is natural in the sentence.";

const INTRO_PROMPT =
  "Write a brief self-introduction (2-4 sentences) as an AI agent: who you are, what you specialize in, and what kinds of tasks or problems other agents should bring to you. " +
  "Reply with ONLY the introduction, no preamble or headers.";

async function queryAndCollect(url: string, agent: any, prompt: string): Promise<string> {
  // Subscribe to SSE BEFORE posting query to avoid missing the idle event
  const sseRes = await authFetch(`${url}/api/events/${agent.id}`, {
    headers: { Accept: "text/event-stream" },
  });
  if (!sseRes.ok || !sseRes.body) throw new Error("Failed to connect to event stream");

  const body: any = {
    prompt,
    sessionId: agent.id,
    cwd: agent.cwd,
  };
  if (agent.nodeId) body.nodeId = agent.nodeId;
  if (agent.params?.claude) body.claudeParams = agent.params.claude;

  await apiFetch(url, "/api/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const reader = sseRes.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const chunks: string[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop()!;
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      let msg: any;
      try { msg = JSON.parse(line.slice(6).trim()); } catch { continue; }
      if (msg.type === "stream_event") {
        const ev = msg.event;
        if (ev?.type === "content_block_delta" && ev.delta?.type === "text_delta") {
          process.stdout.write(ev.delta.text);
          chunks.push(ev.delta.text);
        }
      } else if (msg.type === "status" && msg.status === "idle") {
        reader.cancel(); break;
      } else if (msg.type === "error") {
        throw new Error(msg.error);
      }
    }
  }
  process.stdout.write("\n");
  return chunks.join("").trim();
}

export async function runBio(args: string[]) {
  await runSelfWrite(args, "bio");
}

export async function runIntro(args: string[]) {
  await runSelfWrite(args, "intro");
}

async function runSelfWrite(args: string[], field: "bio" | "intro") {
  const url = getServerUrl(args);
  const pos = positionalArgs(args);
  const targetQuery = pos[0] || Bun.env.AGENT_LINK_AGENT_NAME;

  if (!targetQuery) {
    console.error(`Usage: agent-link ${field} <name|id>\n(or set AGENT_LINK_AGENT_NAME)`);
    process.exit(1);
  }

  const [managed, active] = await Promise.all([
    apiFetchOpt(url, "/api/managed"),
    apiFetchOpt(url, "/api/active"),
  ]);
  if (!managed) { console.error("Error: could not connect to server"); process.exit(1); }

  const agent = findAgent(managed, targetQuery);
  if (!agent) { console.error(`Agent not found: ${targetQuery}`); process.exit(1); }

  const activeSet = new Set<string>(Array.isArray(active) ? active : []);
  if (activeSet.has(agent.id)) {
    console.error(`Warning: ${agent.name} is currently active — waiting may result in queued messages`);
  }

  const prompt = field === "bio" ? BIO_PROMPT : INTRO_PROMPT;
  const label = field === "bio" ? "bio" : "intro";
  console.log(`Asking ${agent.name} to write its ${label}...\n`);

  const text = await queryAndCollect(url, agent, prompt);
  if (!text) { console.error("No response received"); process.exit(1); }

  await apiFetch(url, `/api/managed/${agent.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ [field]: text }),
  });

  console.log(`\n✓ Saved as ${agent.name}'s ${label}`);
}
