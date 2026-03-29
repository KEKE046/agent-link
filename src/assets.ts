import indexHtml from "./public/index.html" with { type: "text" };
import appJs from "./public/app.js" with { type: "text" };
import sidebarJs from "./public/sidebar.js" with { type: "text" };
import rendererJs from "./public/renderer.js" with { type: "text" };
import stylesCss from "./public/styles.css" with { type: "text" };

export default {
  "index.html": indexHtml,
  "app.js": appJs,
  "sidebar.js": sidebarJs,
  "renderer.js": rendererJs,
  "styles.css": stylesCss,
} as Record<string, string>;
