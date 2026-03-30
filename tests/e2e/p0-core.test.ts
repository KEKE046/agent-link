// P0 E2E tests — core user flows
//
// 1. Page load (empty state)
// 2. Create agent
// 3. Send message & receive reply
// 4. Switch between agents
// 5. Delete agent

import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { type BrowserContext, type Page } from "playwright";
import { startTestServer, stopTestServer, createPage, type TestContext } from "./setup";

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
  page.on("console", (msg) => {
    if (msg.type() === "error") console.log(`[browser error] ${msg.text()}`);
  });
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
  // Wait for agent to appear in sidebar
  await p.waitForSelector(`text=${name}`);
}

describe("P0: Core Flow", () => {
  test("1. Page loads with empty state", async () => {
    await page.goto(ctx.baseUrl);
    await page.waitForSelector("text=Agent Link");
    await page.waitForSelector("text=No agents");
    expect(await page.isVisible("text=Agent Link")).toBe(true);
    expect(await page.isVisible("text=No agents")).toBe(true);
  }, 15_000);

  test("2. Create agent appears in sidebar", async () => {
    await page.goto(ctx.baseUrl);
    await page.waitForSelector("text=No agents");
    await createAgent(page, "Test Agent");

    // Agent name visible in sidebar
    expect(await page.isVisible("text=Test Agent")).toBe(true);
    // "No agents" should be gone
    expect(await page.isVisible("text=No agents")).toBe(false);
    // Session should go active then idle
    await page.waitForSelector("text=idle", { timeout: 15_000 });
    // Agent should have a status dot (green when active, gray when idle)
    const dot = page.locator(".pl-10 .rounded-full").first();
    expect(await dot.isVisible()).toBe(true);
  }, 15_000);

  test("3. Send message and receive mock reply", async () => {
    await page.goto(ctx.baseUrl);
    await page.waitForSelector("text=No agents");
    await createAgent(page, "Chat Agent");

    // Creating an agent sends the initial prompt — wait for idle
    await page.waitForSelector("text=idle", { timeout: 15_000 });

    // Send a follow-up message
    await page.fill("input[placeholder='Send a message...']", "hello world");
    await page.click("button:has-text('Send')");

    // Mock reply is inside a collapsed <details class="process-details">
    // Use page.$eval to check the DOM text content regardless of visibility
    await page.waitForFunction(
      () => document.body.textContent?.includes("Mock reply to:"),
      { timeout: 15_000 },
    );
    const bodyText = await page.textContent("body");
    expect(bodyText).toContain("Mock reply to:");
  }, 30_000);

  test("4. Switch between agents", async () => {
    await page.goto(ctx.baseUrl);
    await page.waitForSelector("text=No agents");

    await createAgent(page, "Agent Alpha", "/tmp/a");
    await page.waitForSelector("text=idle", { timeout: 15_000 });

    await createAgent(page, "Agent Beta", "/tmp/b");
    await page.waitForSelector("text=idle", { timeout: 15_000 });

    // Click Agent Alpha in sidebar
    await page.click("text=Agent Alpha");
    await page.waitForTimeout(500);
    // Status bar should show current agent name
    const statusBar = await page.textContent(".px-4.py-1");
    expect(statusBar).toContain("Agent Alpha");

    // Click Agent Beta
    await page.click("text=Agent Beta");
    await page.waitForTimeout(500);
    const statusBar2 = await page.textContent(".px-4.py-1");
    expect(statusBar2).toContain("Agent Beta");
  }, 30_000);

  test("5. Delete agent from sidebar", async () => {
    await page.goto(ctx.baseUrl);
    await page.waitForSelector("text=No agents");
    await createAgent(page, "Doomed Agent");
    await page.waitForSelector("text=idle", { timeout: 15_000 });

    expect(await page.isVisible("text=Doomed Agent")).toBe(true);

    // The "…" button is opacity-0 until group hover.
    // Force it visible, then click it.
    const agentEntry = page.locator(".pl-10 >> text=Doomed Agent").first();
    // Hover the parent row (has class "group" for hover reveal)
    const row = agentEntry.locator("xpath=ancestor::div[contains(@class,'group')]").first();
    await row.hover();
    // Click the "…" menu button
    await row.locator("button:has-text('…')").click({ timeout: 5_000 });

    // Click Remove in dropdown
    await page.click("text=Remove");

    // Confirm dialog
    await page.waitForSelector("text=Remove from sidebar");
    await page.click("button:has-text('Remove')");

    // Agent should be gone
    await page.waitForSelector("text=Doomed Agent", { state: "hidden", timeout: 5_000 });
    expect(await page.isVisible("text=Doomed Agent")).toBe(false);
  }, 30_000);
});
