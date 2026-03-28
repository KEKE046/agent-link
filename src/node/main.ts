import { connect } from "./connector";
import { loadOrCreateNodeKey } from "./key";

const panelUrl = Bun.env.PANEL_URL;

if (!panelUrl) {
  console.error("Usage: PANEL_URL=http://... bun src/node/main.ts");
  console.error("  Optional: NODE_LABEL=my-node (default: random)");
  process.exit(1);
}

console.log(`[node] Starting Agent Link Node`);
console.log(`[node] Panel: ${panelUrl}`);
console.log(`[node] Label: ${Bun.env.NODE_LABEL || "(auto)"}`);
const nodeKey = loadOrCreateNodeKey();
console.log(`[node] Key: ${nodeKey}`);

connect(panelUrl, nodeKey);
