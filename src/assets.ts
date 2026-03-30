import indexHtml from "./public/index.html" with { type: "text" };
import appJs from "./public/app.js" with { type: "text" };
import sidebarJs from "./public/sidebar.js" with { type: "text" };
import agentConfigJs from "./public/agent-config.js" with { type: "text" };
import rendererJs from "./public/renderer.js" with { type: "text" };
import vscodeUiJs from "./public/vscode-ui.js" with { type: "text" };
import stylesCss from "./public/styles.css" with { type: "text" };

export default {
  "index.html": indexHtml,
  "app.js": appJs,
  "sidebar.js": sidebarJs,
  "agent-config.js": agentConfigJs,
  "renderer.js": rendererJs,
  "vscode-ui.js": vscodeUiJs,
  "styles.css": stylesCss,
} as Record<string, string>;
