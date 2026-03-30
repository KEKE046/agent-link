// P2 E2E tests — VS Code Server UI

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

async function addFolder(p: Page, cwd: string) {
  await p.click("button[title='Options']");
  await p.click("text=Add Folder");
  await p.waitForSelector("input[placeholder='/path/to/project']");
  await p.fill("input[placeholder='/path/to/project']", cwd);
  await p.click("button:has-text('Add')");
  await p.waitForTimeout(300);
}

async function openFolderMenu(p: Page, cwd: string) {
  const folderRow = p.locator(`text="${cwd}"`).first();
  const folderGroup = folderRow.locator("xpath=ancestor::div[contains(@class,'group')]").first();
  await folderGroup.hover();
  await folderGroup.locator("button:has-text('…')").click({ timeout: 5_000 });
  await p.waitForTimeout(200);
}

describe("P2: VS Code Server UI", () => {
  test("Folder menu shows Start VS Code", async () => {
    await page.goto(ctx.baseUrl);
    await page.waitForSelector("text=Agent Link");
    await addFolder(page, "/tmp/vstest1");

    await openFolderMenu(page, "/tmp/vstest1");

    expect(await page.isVisible("button:has-text('Start VS Code')")).toBe(true);
    expect(await page.isVisible("button:has-text('Stop VS Code')")).toBe(false);
    expect(await page.isVisible("button:has-text('Add Agent')")).toBe(true);
    expect(await page.isVisible("button:has-text('Remove')")).toBe(true);
  }, 15_000);

  test("Start VS Code opens modal and shows install info", async () => {
    await page.goto(ctx.baseUrl);
    await page.waitForSelector("text=Agent Link");
    await addFolder(page, "/tmp/vstest2");

    await openFolderMenu(page, "/tmp/vstest2");
    await page.click("button:has-text('Start VS Code')");

    // Modal should appear with title
    await page.waitForSelector("text=VS Code Server", { timeout: 5_000 });

    // No VS Code installed in test env — should auto-switch to install tab
    // and show install instructions after loading
    await page.waitForFunction(
      () => document.body.textContent?.includes("agent-link skill --vscode-install"),
      { timeout: 10_000 },
    );

    const bodyText = await page.textContent("body");
    expect(bodyText).toContain("Agent Prompt");
    expect(bodyText).toContain("Shell Command");
    expect(bodyText).toContain("agent-link skill --vscode-install");

    // Copy buttons should exist
    const copyButtons = page.locator("button:has-text('Copy')");
    expect(await copyButtons.count()).toBeGreaterThanOrEqual(2);
  }, 20_000);

  test("Modal closes with x and Escape", async () => {
    await page.goto(ctx.baseUrl);
    await page.waitForSelector("text=Agent Link");
    await addFolder(page, "/tmp/vstest3");

    // Open modal
    await openFolderMenu(page, "/tmp/vstest3");
    await page.click("button:has-text('Start VS Code')");
    await page.waitForSelector("text=VS Code Server", { timeout: 5_000 });

    // Close with Escape
    await page.keyboard.press("Escape");
    await page.waitForSelector("text=VS Code Server", { state: "hidden", timeout: 3_000 });

    // Reopen and close with x
    await openFolderMenu(page, "/tmp/vstest3");
    await page.click("button:has-text('Start VS Code')");
    await page.waitForSelector("text=VS Code Server", { timeout: 5_000 });
    // The x button is inside the modal header
    await page.locator("text=VS Code Server").locator("xpath=ancestor::div[1]").locator("button:has-text('x')").click();
    await page.waitForSelector("text=VS Code Server", { state: "hidden", timeout: 3_000 });
  }, 15_000);
});
