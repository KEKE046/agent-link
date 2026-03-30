import SKILL_MARKDOWN from "./skill-teamwork.md" with { type: "text" };
import SETUP_MARKDOWN from "./skill-setup.md" with { type: "text" };
import installVscodeServerScript from "../install-vscode-server.sh" with { type: "text" };

export { SKILL_MARKDOWN, SETUP_MARKDOWN };

export async function runSkill(args: string[]) {
  if (args.includes("--setup")) {
    process.stdout.write(SETUP_MARKDOWN);
  } else if (args.includes("--vscode-install")) {
    process.stdout.write(installVscodeServerScript);
  } else {
    // --team-work or no flag
    process.stdout.write(SKILL_MARKDOWN);
  }
}
