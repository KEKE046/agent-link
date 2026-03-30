// P1 E2E tests — important interactions
//
// 6. Send follow-up message (resume session)
// 7. Interrupt session (Stop button)
// 8. Sidebar collapse/expand
// 9. Theme toggle (dark/light)
// 10. Folder management (add/rename/remove)

import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { type BrowserContext, type Page } from "playwright";
import {
  startTestServer, stopTestServer, createPage,
  installSlowSdk, installFastSdk,
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
  installFastSdk(ctx);
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

describe("P1: Interactions", () => {
  test("6. Send follow-up message (resume session)", async () => {
    await page.goto(ctx.baseUrl);
    await page.waitForSelector("text=No agents");
    await createAgent(page, "Resume Agent");
    await page.waitForSelector("text=idle", { timeout: 15_000 });

    // First query already happened during create. Now send a follow-up.
    await page.fill("input[placeholder='Send a message...']", "follow up question");
    await page.click("button:has-text('Send')");

    // Wait for response to arrive in DOM
    await page.waitForFunction(
      () => document.body.textContent?.includes("Mock reply to: follow up question"),
      { timeout: 15_000 },
    );
    const bodyText = await page.textContent("body");
    expect(bodyText).toContain("Mock reply to: follow up question");

    // Should go back to idle
    await page.waitForSelector("text=idle", { timeout: 10_000 });
  }, 30_000);

  test("7. Interrupt session (Stop button)", async () => {
    // Install slow mock so session stays active long enough to click Stop
    installSlowSdk(5000);

    await page.goto(ctx.baseUrl);
    await page.waitForSelector("text=No agents");
    await createAgent(page, "Slow Agent");

    // Wait for Stop button to appear (session is active with slow mock)
    const stopBtn = page.locator("button:has-text('Stop')");
    await stopBtn.waitFor({ state: "visible", timeout: 10_000 });

    // Click Stop
    await stopBtn.click();

    // Should go back to idle
    await page.waitForSelector("text=idle", { timeout: 10_000 });

    // Stop button should disappear
    await stopBtn.waitFor({ state: "hidden", timeout: 5_000 });
  }, 30_000);

  test("7b. Interrupt session (Escape key)", async () => {
    installSlowSdk(5000);

    await page.goto(ctx.baseUrl);
    await page.waitForSelector("text=No agents");
    await createAgent(page, "Esc Agent");

    // Wait for Stop button to appear (session is active)
    const stopBtn = page.locator("button:has-text('Stop')");
    await stopBtn.waitFor({ state: "visible", timeout: 10_000 });

    // Focus the input and press Escape
    const input = page.locator("input[placeholder='Send a message...']");
    await input.focus();
    await page.keyboard.press("Escape");

    // Should go back to idle
    await page.waitForSelector("text=idle", { timeout: 10_000 });

    // Stop button should disappear
    await stopBtn.waitFor({ state: "hidden", timeout: 5_000 });
  }, 30_000);

  test("8. Sidebar collapse/expand", async () => {
    await page.goto(ctx.baseUrl);
    await page.waitForSelector("text=Agent Link");
    // Wait for Alpine to finish init and data to load
    await page.waitForTimeout(500);

    // Ensure sidebar is expanded first
    const isCollapsed = await page.isVisible("button[title='Expand sidebar']");
    if (isCollapsed) {
      await page.click("button[title='Expand sidebar']");
      await page.waitForTimeout(300);
    }

    // Sidebar should show some content (node header with "test-local")
    const sidebarVisible = await page.evaluate(() => {
      const sidebar = document.querySelector(".bg-gray-900.flex.flex-col.flex-shrink-0");
      return sidebar ? sidebar.getBoundingClientRect().width > 10 : false;
    });
    expect(sidebarVisible).toBe(true);

    // Collapse sidebar
    await page.click("button[title='Collapse sidebar']");
    await page.waitForTimeout(300);
    const afterCollapse = await page.evaluate(() => {
      const sidebar = document.querySelector(".bg-gray-900.flex.flex-col.flex-shrink-0");
      return sidebar ? sidebar.getBoundingClientRect().width : 999;
    });
    expect(afterCollapse).toBe(0);

    // Expand again
    expect(await page.isVisible("button[title='Expand sidebar']")).toBe(true);
    await page.click("button[title='Expand sidebar']");
    await page.waitForTimeout(300);
    const afterExpand = await page.evaluate(() => {
      const sidebar = document.querySelector(".bg-gray-900.flex.flex-col.flex-shrink-0");
      return sidebar ? sidebar.getBoundingClientRect().width > 10 : false;
    });
    expect(afterExpand).toBe(true);
  }, 15_000);

  test("9. Theme toggle (auto/light/dark)", async () => {
    await page.goto(ctx.baseUrl);
    await page.waitForSelector("text=Agent Link");

    // Default is auto — effective theme depends on system, but the button shows ◑
    const autoBtn = page.locator("button:has-text('◑')");
    expect(await autoBtn.isVisible()).toBe(true);

    // Click to switch to light
    await autoBtn.click();
    let hasLight = await page.evaluate(() => document.body.classList.contains("light-theme"));
    expect(hasLight).toBe(true);
    expect(await page.isVisible("button:has-text('☼')")).toBe(true);

    // Click to switch to dark
    await page.click("button:has-text('☼')");
    hasLight = await page.evaluate(() => document.body.classList.contains("light-theme"));
    expect(hasLight).toBe(false);
    expect(await page.isVisible("button:has-text('☾')")).toBe(true);

    // Click to go back to auto
    await page.click("button:has-text('☾')");
    expect(await page.isVisible("button:has-text('◑')")).toBe(true);
  }, 15_000);

  test("10. Folder management (add/rename/remove)", async () => {
    await page.goto(ctx.baseUrl);
    await page.waitForSelector("text=No agents");

    // --- Add folder ---
    await page.click("button[title='Options']");
    await page.click("text=Add Folder");
    await page.waitForSelector("input[placeholder='/path/to/project']");
    await page.fill("input[placeholder='/path/to/project']", "/home/user/my-project");
    await page.click("button:has-text('Add')");

    // Folder should appear in sidebar (shows last segment of path)
    await page.waitForSelector("text=my-project");
    expect(await page.isVisible("text=my-project")).toBe(true);

    // --- Rename folder ---
    // Hover the folder row to reveal "..." menu
    const folderRow = page.locator("text=my-project").first();
    const folderGroup = folderRow.locator("xpath=ancestor::div[contains(@class,'group')]").first();
    await folderGroup.hover();
    await folderGroup.locator("button:has-text('…')").click({ timeout: 5_000 });
    await page.click("text=Rename");

    // Rename popup
    await page.waitForSelector("input[placeholder='Display name (empty to reset)']");
    await page.fill("input[placeholder='Display name (empty to reset)']", "My Cool Project");
    await page.click("button:has-text('Save')");

    // Should show the new label in brackets
    await page.waitForSelector("text=[My Cool Project]");
    expect(await page.isVisible("text=[My Cool Project]")).toBe(true);

    // --- Remove folder ---
    const renamedRow = page.locator("text=[My Cool Project]").first();
    const renamedGroup = renamedRow.locator("xpath=ancestor::div[contains(@class,'group')]").first();
    await renamedGroup.hover();
    await renamedGroup.locator("button:has-text('…')").click({ timeout: 5_000 });
    await page.click("text=Remove");

    // Folder should be gone
    await page.waitForSelector("text=[My Cool Project]", { state: "hidden", timeout: 5_000 });
    expect(await page.isVisible("text=[My Cool Project]")).toBe(false);
  }, 30_000);
});
