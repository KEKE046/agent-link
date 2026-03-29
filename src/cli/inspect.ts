import { getServerUrl, apiFetchOpt, findAgent, positionalArgs, getShortArg } from "./client";

function extractText(content: any[]): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text || "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatMessage(msg: any): string | null {
  const time = msg.message?.timestamp
    ? new Date(msg.message.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "";
  const ts = time ? ` ${time}` : "";

  if (msg.type === "user") {
    const content = msg.message?.content ?? [];
    const text = extractText(content);
    if (!text) return null;
    const truncated = text.length > 300 ? text.slice(0, 300) + "…" : text;
    return `[user]${ts}  ${truncated}`;
  }

  if (msg.type === "assistant") {
    const content = msg.message?.content ?? [];
    const parts: string[] = [];
    for (const b of content) {
      if (b.type === "text" && b.text?.trim()) {
        const t = b.text.trim();
        parts.push(t.length > 300 ? t.slice(0, 300) + "…" : t);
      } else if (b.type === "tool_use") {
        parts.push(`[tool: ${b.name}]`);
      }
    }
    if (!parts.length) return null;
    return `[asst]${ts}  ${parts.join("  ")}`;
  }

  return null;
}

export async function runInspect(args: string[]) {
  const url = getServerUrl(args);
  const queries = positionalArgs(args);
  const nRaw = getShortArg(args, "-n");
  const msgCount = nRaw !== undefined ? Math.max(0, parseInt(nRaw) || 0) : 1;

  if (queries.length === 0) {
    console.error("Usage: agent-link inspect <name|id>... [-n <messages>]");
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

    if (msgCount === 0) continue;

    // Fetch messages — get enough to tail msgCount from
    const fetchLimit = Math.max(msgCount * 3, 50);
    const params = new URLSearchParams({ limit: String(fetchLimit), cwd: agent.cwd || "" });
    if (agent.nodeId) params.set("nodeId", agent.nodeId);
    const msgs = await apiFetchOpt(url, `/api/sessions/${agent.id}/messages?${params}`);

    if (!Array.isArray(msgs) || msgs.length === 0) {
      console.log(`Messages:  (none)`);
      continue;
    }

    const lines = msgs.map(formatMessage).filter((l): l is string => l !== null);
    const tail = lines.slice(-msgCount);

    const label = tail.length === 1 ? "last message" : `last ${tail.length} messages`;
    const rule = `── ${label} ${"─".repeat(Math.max(0, 40 - label.length - 4))}`;
    console.log(rule);
    for (const line of tail) console.log(line);
  }
}
