import { connect } from "./connector";

const panelUrl = Bun.env.PANEL_URL;
const nodeToken = Bun.env.NODE_TOKEN;

if (!panelUrl || !nodeToken) {
  console.error("Usage: PANEL_URL=http://... NODE_TOKEN=tok_... bun src/node/main.ts");
  console.error("  Optional: NODE_LABEL=my-node (default: random)");
  process.exit(1);
}

console.log(`[node] Starting Agent Link Node`);
console.log(`[node] Panel: ${panelUrl}`);
console.log(`[node] Label: ${Bun.env.NODE_LABEL || "(auto)"}`);

connect(panelUrl, nodeToken);
