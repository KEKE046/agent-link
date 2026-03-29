import { getServerUrl, apiFetchOpt, apiFetch, findAgent, positionalArgs, authFetch } from "./client";

export async function runSend(args: string[]) {
  const url = getServerUrl(args);
  const pos = positionalArgs(args);

  // Usage: agent-link send <name|id> <message...>
  // Or with AGENT_LINK_TARGET set: agent-link send <message...>
  let targetQuery: string;
  let messageParts: string[];

  if (pos.length < 2) {
    console.error("Usage: agent-link send <name|id> <message>");
    process.exit(1);
  }
  targetQuery = pos[0];
  messageParts = pos.slice(1);

  const message = messageParts.join(" ");
  const senderName = Bun.env.AGENT_LINK_AGENT_NAME;

  const managed = await apiFetchOpt(url, "/api/managed");
  if (!managed) {
    console.error("Error: could not connect to server");
    process.exit(1);
  }

  const agent = findAgent(managed, targetQuery);
  if (!agent) {
    console.error(`Agent not found: ${targetQuery}`);
    process.exit(1);
  }

  if (senderName) {
    process.stdout.write(`[${senderName} → ${agent.name}] `);
  } else {
    process.stdout.write(`[→ ${agent.name}] `);
  }
  console.log(message);
  console.log();

  // Send the query
  const body: any = {
    prompt: message,
    sessionId: agent.id,
    cwd: agent.cwd,
  };
  if (agent.nodeId) body.nodeId = agent.nodeId;
  if (agent.params?.claude) body.claudeParams = agent.params.claude;

  try {
    await apiFetch(url, "/api/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err: any) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }

  // Stream SSE events until idle
  const res = await authFetch(`${url}/api/events/${agent.id}`, {
    headers: { Accept: "text/event-stream" },
  });

  if (!res.ok || !res.body) {
    console.error("Failed to connect to event stream");
    process.exit(1);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let inAssistantBlock = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop()!;

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (!data) continue;
      let msg: any;
      try { msg = JSON.parse(data); } catch { continue; }

      if (msg.type === "stream_event") {
        const ev = msg.event;
        if (ev?.type === "content_block_start" && ev.content_block?.type === "text") {
          inAssistantBlock = true;
        } else if (ev?.type === "content_block_delta" && ev.delta?.type === "text_delta") {
          process.stdout.write(ev.delta.text);
        } else if (ev?.type === "content_block_stop") {
          if (inAssistantBlock) { process.stdout.write("\n"); inAssistantBlock = false; }
        } else if (ev?.type === "content_block_start" && ev.content_block?.type === "tool_use") {
          process.stdout.write(`\n[tool: ${ev.content_block.name}]\n`);
        }
      } else if (msg.type === "status" && msg.status === "idle") {
        reader.cancel();
        break;
      } else if (msg.type === "error") {
        console.error(`\nError: ${msg.error}`);
        reader.cancel();
        process.exit(1);
      }
    }
  }
}
