// P2 E2E tests — config & details
//
// 11. Agent config panel (model/thinking/effort)
// 12. Create-time config (system prompt, env)
// 13. Bio / Intro editing
// 14. Load existing session

import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { type BrowserContext, type Page } from "playwright";
import {
  startTestServer, stopTestServer, createPage,
  type TestContext,
} from "./setup";

let ctx: TestContext;
let context: BrowserContext;
let page: Page;

beforeAll(async () => {
  ctx = await startTestServer();
}, 30_000);

afterAll(async () => {
  await stopTestServer(ctx);
}, 10_000);

beforeEach(async () => {
  ({ context, page } = await createPage(ctx));
  page.on("pageerror", (err) => console.log(`[page error] ${err.message}`));
});

afterEach(async () => {
  try { await context.close(); } catch {}
});

// Helper: create an agent through the UI dialog
async function createAgent(p: Page, name: string, cwd = "/tmp/test") {
  await p.click("button[title='Options']");
  await p.click("text=Add Agent");
  await p.waitForSelector("input[placeholder='e.g. Code Helper']");
  await p.fill("input[placeholder='e.g. Code Helper']", name);
  await p.fill("input[placeholder='/path/to/project']", cwd);
  await p.click("button:has-text('Create'):not([disabled])");
  await p.waitForSelector(`text=${name}`);
}

// Helper: open the right sidebar config panel
async function openConfigPanel(p: Page) {
  // Click the gear button in header to toggle config panel
  await p.click("button[title='Agent config']");
  await p.waitForTimeout(300);
}

describe("P2: Config & Details", () => {
  test("11. Agent config panel (model/thinking/effort)", async () => {
    await page.goto(ctx.baseUrl);
    await page.waitForSelector("text=No agents");
    await createAgent(page, "Config Agent");
    await page.waitForSelector("text=idle", { timeout: 15_000 });

    // Open right sidebar config panel
    await openConfigPanel(page);

    // Should show the agent name in the config panel
    await page.waitForSelector("text=Config Agent");

    // Change model to opus
    const modelSelect = page.locator("select[x-model='model']");
    await modelSelect.selectOption("opus");

    // Change thinking to enabled
    const thinkingSelect = page.locator("select[x-model='thinking']");
    await thinkingSelect.selectOption("enabled");

    // Change effort to high
    const effortSelect = page.locator("select[x-model='effort']");
    await effortSelect.selectOption("high");

    // Save button should appear (dirty state)
    await page.waitForSelector("text=Save Config");
    await page.click("button:has-text('Save Config')");

    // Save button should disappear after saving
    await page.waitForSelector("text=Save Config", { state: "hidden", timeout: 5_000 });

    // Verify the values persisted by checking the API
    const res = await fetch(`${ctx.baseUrl}/api/managed`);
    const managed = await res.json();
    const agent = managed.find((m: any) => m.name === "Config Agent");
    expect(agent).toBeTruthy();
    expect(agent.params?.claude?.model).toBe("opus");
    expect(agent.params?.claude?.thinking?.type).toBe("enabled");
    expect(agent.params?.claude?.effort).toBe("high");
  }, 30_000);

  test("12. Create-time config (system prompt, env)", async () => {
    await page.goto(ctx.baseUrl);
    await page.waitForSelector("text=No agents");

    // Open add-agent dialog
    await page.click("button[title='Options']");
    await page.click("text=Add Agent");
    await page.waitForSelector("input[placeholder='e.g. Code Helper']");

    // Fill name
    await page.fill("input[placeholder='e.g. Code Helper']", "Configured Agent");
    await page.fill("input[placeholder='/path/to/project']", "/tmp/configured");

    // Open config panel in dialog (gear button)
    await page.click("button[title='Toggle config']");
    await page.waitForSelector("text=Agent Config");

    // Set model to haiku
    const dialogModelSelect = page.locator("select[x-model='agentDialog.cfgModel']");
    await dialogModelSelect.selectOption("haiku");

    // Set effort to low
    const dialogEffortSelect = page.locator("select[x-model='agentDialog.cfgEffort']");
    await dialogEffortSelect.selectOption("low");

    // Expand System Prompt section and type
    await page.click("button:has-text('System Prompt')");
    const sysTa = page.locator("textarea[x-model='agentDialog.cfgSystemPrompt']");
    await sysTa.waitFor({ state: "visible" });
    // The textarea is pre-filled with default; append custom text
    const currentVal = await sysTa.inputValue();
    await sysTa.fill(currentVal + "\nCustom system instructions here.");

    // Expand ENV section and type
    await page.click("button:has-text('ENV')");
    const envTa = page.locator("textarea[x-model='agentDialog.cfgEnvText']");
    await envTa.waitFor({ state: "visible" });
    await envTa.fill("MY_VAR=hello\nOTHER=world");

    // Create the agent
    await page.click("button:has-text('Create'):not([disabled])");
    await page.waitForSelector("text=Configured Agent");
    await page.waitForSelector("text=idle", { timeout: 15_000 });

    // Verify params were saved via API
    const res = await fetch(`${ctx.baseUrl}/api/managed`);
    const managed = await res.json();
    const agent = managed.find((m: any) => m.name === "Configured Agent");
    expect(agent).toBeTruthy();
    expect(agent.params?.claude?.model).toBe("haiku");
    expect(agent.params?.claude?.effort).toBe("low");
    expect(agent.params?.claude?.systemPrompt?.append).toContain("Custom system instructions here.");
    expect(agent.params?.claude?.env?.MY_VAR).toBe("hello");
    expect(agent.params?.claude?.env?.OTHER).toBe("world");
  }, 30_000);

  test("13. Bio / Intro editing", async () => {
    await page.goto(ctx.baseUrl);
    await page.waitForSelector("text=No agents");
    await createAgent(page, "Bio Agent");
    await page.waitForSelector("text=idle", { timeout: 15_000 });

    // Open right sidebar config panel
    await openConfigPanel(page);
    await page.waitForSelector("text=Bio Agent");

    // Fill bio
    const bioInput = page.locator("input[placeholder='Short description...']");
    await bioInput.fill("A helpful coding assistant");

    // Expand Intro section and fill
    await page.click("button:has-text('Intro')");
    const introTa = page.locator("textarea[placeholder='Self-introduction for other agents...']");
    await introTa.waitFor({ state: "visible" });
    await introTa.fill("Hello, I am Bio Agent and I help with code.");

    // Save
    await page.waitForSelector("text=Save Config");
    await page.click("button:has-text('Save Config')");
    await page.waitForSelector("text=Save Config", { state: "hidden", timeout: 5_000 });

    // Verify via API
    const res = await fetch(`${ctx.baseUrl}/api/managed`);
    const managed = await res.json();
    const agent = managed.find((m: any) => m.name === "Bio Agent");
    expect(agent).toBeTruthy();
    expect(agent.bio).toBe("A helpful coding assistant");
    expect(agent.intro).toBe("Hello, I am Bio Agent and I help with code.");

    // Bio should also appear in the config panel display
    const bioDisplay = page.locator(".italic.truncate");
    expect(await bioDisplay.textContent()).toContain("A helpful coding assistant");
  }, 30_000);

  test("14. Load existing session", async () => {
    await page.goto(ctx.baseUrl);
    await page.waitForSelector("text=No agents");

    // First create an agent so there's a session in the system
    await createAgent(page, "First Agent", "/tmp/loadtest");
    await page.waitForSelector("text=idle", { timeout: 15_000 });

    // Now open the Add Agent dialog again
    await page.click("button[title='Options']");
    await page.click("text=Add Agent");
    await page.waitForSelector("input[placeholder='e.g. Code Helper']");

    // Fill the name
    await page.fill("input[placeholder='e.g. Code Helper']", "Loaded Agent");

    // Switch to Load tab
    await page.click("button:has-text('Load')");

    // Wait for sessions to load (the mock SDK returns session data)
    await page.waitForFunction(
      () => {
        const container = document.querySelector("[x-html*='renderSessionsHtml']");
        return container && container.textContent && !container.textContent.includes("Loading...");
      },
      { timeout: 10_000 },
    );

    // Check that the sessions container has content (not "No sessions found" means mock returned data)
    const sessionsContent = await page.evaluate(() => {
      const container = document.querySelector("[x-html*='renderSessionsHtml']") ||
                        document.querySelector(".overflow-y-auto.border.border-gray-800");
      return container?.textContent || "";
    });

    // If no sessions are found (mock returns empty by default), we should see that text
    // The mock listSessions returns [] by default, so we might see "No sessions found"
    // But the Load tab uses /api/sessions which goes through the Router's listAllSessions

    // Click the first session entry if there is one
    const sessionEntry = page.locator("[data-sid]").first();
    const hasSession = await sessionEntry.isVisible().catch(() => false);

    if (hasSession) {
      await sessionEntry.click();

      // Create button should be enabled now
      const createBtn = page.locator("button:has-text('Create'):not([disabled])");
      await createBtn.waitFor({ state: "visible", timeout: 3_000 });
      await createBtn.click();

      // Agent should appear in sidebar
      await page.waitForSelector("text=Loaded Agent");
      expect(await page.isVisible("text=Loaded Agent")).toBe(true);
    } else {
      // No sessions available (expected with mock) — verify the "No sessions found" message
      expect(sessionsContent).toContain("No sessions found");

      // Create button should be disabled when no session is selected on Load tab
      const createBtn = page.locator("button:has-text('Create')");
      const isDisabled = await createBtn.getAttribute("disabled");
      expect(isDisabled).not.toBeNull();
    }
  }, 30_000);
});
