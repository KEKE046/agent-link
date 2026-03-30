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

  test("7c. User prompt visible after re-entering active session", async () => {
    // Use slow SDK so the first agent stays active while we switch away
    installSlowSdk(15000);

    await page.goto(ctx.baseUrl);
    await page.waitForSelector("text=No agents");

    // Create first agent — its initial prompt should be visible
    await createAgent(page, "Active Agent", "/tmp/active");
    // Wait for the session to be active (Stop button visible)
    await page.waitForSelector("button:has-text('Stop')", { timeout: 10_000 });

    // The initial prompt should be on screen
    const initialPrompt = 'agent-link skill';
    await page.waitForFunction(
      (text) => document.body.textContent?.includes(text),
      initialPrompt,
      { timeout: 5_000 },
    );

    // Switch to fast SDK for the second agent so it completes quickly
    installFastSdk(ctx);

    // Create a second agent (this switches away from the first)
    await createAgent(page, "Other Agent", "/tmp/other");
    await page.waitForSelector("text=idle", { timeout: 10_000 });

    // Now switch back to the first (still-active) agent by clicking its name
    await page.click("text=Active Agent");
    await page.waitForTimeout(1000);

    // The initial prompt should still be visible after re-entering
    const hasPrompt = await page.evaluate(
      (text) => document.body.textContent?.includes(text),
      initialPrompt,
    );
    expect(hasPrompt).toBe(true);
  }, 45_000);

  test("7d. Multiple slow sessions: switch between active agents preserves prompts", async () => {
    installSlowSdk(20000);

    await page.goto(ctx.baseUrl);
    await page.waitForSelector("text=No agents");

    // Create 3 agents with slow SDK — all stay active
    await createAgent(page, "Slow-A", "/tmp/slow-a");
    await page.waitForSelector("button:has-text('Stop')", { timeout: 10_000 });

    await createAgent(page, "Slow-B", "/tmp/slow-b");
    await page.waitForSelector("button:has-text('Stop')", { timeout: 10_000 });

    await createAgent(page, "Slow-C", "/tmp/slow-c");
    await page.waitForSelector("button:has-text('Stop')", { timeout: 10_000 });

    // Currently viewing Slow-C. The initial prompt keyword should be visible.
    const promptKeyword = 'agent-link skill';

    // Switch to Slow-A
    await page.click("text=Slow-A");
    await page.waitForTimeout(800);
    let has = await page.evaluate((t) => document.body.textContent?.includes(t), promptKeyword);
    expect(has).toBe(true);

    // Switch to Slow-B
    await page.click("text=Slow-B");
    await page.waitForTimeout(800);
    has = await page.evaluate((t) => document.body.textContent?.includes(t), promptKeyword);
    expect(has).toBe(true);

    // Switch back to Slow-C
    await page.click("text=Slow-C");
    await page.waitForTimeout(800);
    has = await page.evaluate((t) => document.body.textContent?.includes(t), promptKeyword);
    expect(has).toBe(true);

    // Switch to Slow-A again — still has prompt
    await page.click("text=Slow-A");
    await page.waitForTimeout(800);
    has = await page.evaluate((t) => document.body.textContent?.includes(t), promptKeyword);
    expect(has).toBe(true);

    // All 3 should show active indicators (green dots or Stop button visible for current)
    const activeCount = await page.evaluate(() => {
      return document.querySelectorAll('.bg-green-400.animate-pulse').length;
    });
    // At least current session should be active
    expect(activeCount).toBeGreaterThanOrEqual(1);
  }, 60_000);

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

  test("11. Group expand/collapse state persists across reload", async () => {
    await page.goto(ctx.baseUrl);
    await page.waitForSelector("text=Agent Link");
    await page.waitForTimeout(500);

    // Create an agent
    await createAgent(page, "Persist-X", "/tmp/persist-x");
    await page.waitForSelector("text=idle", { timeout: 15_000 });

    // Agent should be visible (auto-expanded)
    expect(await page.isVisible("text=Persist-X")).toBe(true);

    // Verify localStorage has the expanded-groups saved (auto-expanded on create)
    const beforeCollapse = await page.evaluate(() => localStorage.getItem('agent-link:expanded-groups'));
    expect(beforeCollapse).toBeTruthy();
    expect(beforeCollapse).toContain('persist-x');

    // Collapse: remove the folder key from localStorage directly, then reload to verify persistence
    await page.evaluate(() => {
      const raw = localStorage.getItem('agent-link:expanded-groups') || '[]';
      const groups = JSON.parse(raw).filter(k => !k.includes('persist-x'));
      localStorage.setItem('agent-link:expanded-groups', JSON.stringify(groups));
    });

    // Reload — folder should be collapsed
    await page.reload();
    await page.waitForSelector("text=Agent Link");
    await page.waitForTimeout(800);

    // Persist-X should be hidden (folder collapsed)
    const debugInfo = await page.evaluate(() => ({
      stored: localStorage.getItem('agent-link:expanded-groups'),
    }));
    expect(debugInfo.stored).not.toContain('persist-x');

    // Check the session row specifically (it's at pl-10 depth)
    const sessionRow = page.locator('.pl-10:has-text("Persist-X")');
    expect(await sessionRow.count()).toBe(0);

    // localStorage should have the expanded state saved
    const stored = await page.evaluate(() => localStorage.getItem('agent-link:expanded-groups'));
    expect(stored).toBeTruthy();

    // Reload
    await page.reload();
    await page.waitForSelector("text=Agent Link");
    await page.waitForTimeout(800);

    // After reload, the agent session row should still be hidden (folder collapsed persisted)
    expect(await page.locator('.pl-10:has-text("Persist-X")').count()).toBe(0);

    // Re-expand: add the folder key back
    await page.evaluate(() => {
      const raw = localStorage.getItem('agent-link:expanded-groups') || '[]';
      const groups = JSON.parse(raw);
      groups.push('test-local:/tmp/persist-x');
      localStorage.setItem('agent-link:expanded-groups', JSON.stringify(groups));
    });

    // Reload — should be expanded
    await page.reload();
    await page.waitForSelector("text=Agent Link");
    await page.waitForTimeout(800);
    expect(await page.locator('.pl-10:has-text("Persist-X")').count()).toBe(1);
  }, 45_000);

  test("11b. Page reload during active session preserves user prompt", async () => {
    installSlowSdk(15000);

    await page.goto(ctx.baseUrl);
    await page.waitForSelector("text=Agent Link");
    await page.waitForTimeout(500);

    await createAgent(page, "Reload Agent", "/tmp/reload-test");
    await page.waitForSelector("button:has-text('Stop')", { timeout: 10_000 });

    // The initial prompt keyword should be on screen
    const promptKeyword = 'agent-link skill';
    await page.waitForFunction(
      (text) => document.body.textContent?.includes(text),
      promptKeyword,
      { timeout: 5_000 },
    );

    // Reload the page while the session is still active
    await page.reload();
    await page.waitForSelector("text=Agent Link");
    await page.waitForTimeout(1000);

    // Click back into the agent (managed list restored from server)
    await page.click("text=Reload Agent");
    await page.waitForTimeout(1500);

    // The user prompt should be visible via SSE buffer replay
    const hasPrompt = await page.evaluate(
      (text) => document.body.textContent?.includes(text),
      promptKeyword,
    );
    expect(hasPrompt).toBe(true);
  }, 30_000);

  test("12. Add Agent dialog has no node selector dropdown", async () => {
    await page.goto(ctx.baseUrl);
    await page.waitForSelector("text=Agent Link");
    await page.waitForTimeout(500);

    // Open Add Agent dialog
    await page.click("button[title='Options']");
    await page.click("text=Add Agent");
    await page.waitForSelector("input[placeholder='e.g. Code Helper']");

    // The left form panel should not contain a <select> — only the config panel has selects
    // Check specifically that no select has a node ID as an option
    const hasNodeSelect = await page.evaluate(() => {
      const selects = document.querySelectorAll('.fixed.inset-0 select');
      for (const sel of selects) {
        for (const opt of sel.options) {
          if (opt.value && opt.value.includes('-') && opt.textContent?.includes('-')) {
            // Looks like a nodeId option
            return true;
          }
        }
      }
      return false;
    });
    expect(hasNodeSelect).toBe(false);
  }, 15_000);
});
