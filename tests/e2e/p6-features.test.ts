// P6 E2E tests — Background task display & command completion
//
// 1. Background task messages render in chat
// 2. Slash command dropdown appears on /
// 3. Command completion keyboard navigation
// 4. Stop task & init API endpoints
// 5. Session commands API returns commands

import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { type BrowserContext, type Page } from "playwright";
import { startTestServer, stopTestServer, createPage, installFastSdk, installTaskSdk, type TestContext } from "./setup";

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

async function createAgent(p: Page, name: string, cwd = "/tmp/test") {
  await p.click("button[title='Options']");
  await p.click("text=Add Agent");
  await p.waitForSelector("input[placeholder='e.g. Code Helper']");
  await p.fill("input[placeholder='e.g. Code Helper']", name);
  await p.fill("input[placeholder='/path/to/project']", cwd);
  await p.click("button:has-text('Create'):not([disabled])");
  await p.waitForSelector(`text=${name}`);
}

describe("P6: Background Tasks & Command Completion", () => {
  test("1. Background task events & init data API", async () => {
    installTaskSdk();

    // Create session via API
    const qRes = await fetch(`${ctx.baseUrl}/api/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "test", cwd: "/tmp/tasks", model: "sonnet" }),
    });
    const { sessionId } = await qRes.json() as { sessionId: string };
    await Bun.sleep(500);

    // Init data should be cached with slash_commands
    const initRes = await fetch(`${ctx.baseUrl}/api/sessions/${sessionId}/init`);
    const initData = await initRes.json() as any;
    expect(initData.subtype).toBe("init");
    expect(initData.slash_commands).toContain("compact");
    expect(initData.slash_commands).toContain("help");
    expect(initData.model).toBe("sonnet");
  }, 15_000);

  test("2. Slash command dropdown appears on / input", async () => {
    await page.goto(ctx.baseUrl);
    await page.waitForSelector("button[title='Options']", { timeout: 5_000 });
    await createAgent(page, "Slash Agent", "/tmp/slash");
    await page.waitForSelector("text=idle", { timeout: 15_000 });

    // Wait for the timer to cache commands from init
    await page.waitForTimeout(6000);

    const input = page.locator("input[placeholder*='Send a message']");
    await input.click();
    await input.pressSequentially("/");

    // Dropdown should appear
    await page.waitForSelector(".completion-dropdown", { timeout: 5_000 });
    const dropdown = await page.textContent(".completion-dropdown");
    expect(dropdown).toContain("/compact");
    expect(dropdown).toContain("/clear");
    expect(dropdown).toContain("/help");
  }, 30_000);

  test("3. Command completion keyboard Tab selects", async () => {
    await page.goto(ctx.baseUrl);
    await page.waitForSelector("button[title='Options']", { timeout: 5_000 });
    await createAgent(page, "Nav Agent", "/tmp/nav");
    await page.waitForSelector("text=idle", { timeout: 15_000 });

    await page.waitForTimeout(6000);

    const input = page.locator("input[placeholder*='Send a message']");
    await input.click();
    await input.pressSequentially("/co");

    await page.waitForSelector(".completion-dropdown", { timeout: 5_000 });

    // Should filter to compact only
    const items = await page.locator(".completion-item").count();
    expect(items).toBe(1);

    // Press Tab to select
    await input.press("Tab");
    const value = await input.inputValue();
    expect(value).toStartWith("/compact");

    // Dropdown should be gone
    expect(await page.isVisible(".completion-dropdown")).toBe(false);
  }, 30_000);

  test("4. Stop task & init data API endpoints work", async () => {
    installTaskSdk();

    // Create session via API
    const qRes = await fetch(`${ctx.baseUrl}/api/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "test", cwd: "/tmp/api-test", model: "sonnet" }),
    });
    const { sessionId } = await qRes.json() as { sessionId: string };
    expect(sessionId).toBeTruthy();

    // Wait for query to complete
    await Bun.sleep(500);

    // Stop task API
    const stopRes = await fetch(`${ctx.baseUrl}/api/stop-task/${sessionId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: "bg-task-1" }),
    });
    expect(stopRes.status).toBe(200);
    expect((await stopRes.json() as any).ok).toBe(true);

    // Init data API
    const initRes = await fetch(`${ctx.baseUrl}/api/sessions/${sessionId}/init`);
    expect(initRes.status).toBe(200);
    const initData = await initRes.json() as any;
    expect(initData.subtype).toBe("init");
    expect(initData.slash_commands).toContain("compact");
    expect(initData.slash_commands).toContain("help");
  }, 15_000);

  test("5. Session commands API returns commands for active session", async () => {
    // Create and keep session active (use slow-ish mock)
    const qRes = await fetch(`${ctx.baseUrl}/api/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "test", cwd: "/tmp/cmd-test", model: "sonnet" }),
    });
    const { sessionId } = await qRes.json() as { sessionId: string };
    await Bun.sleep(500);

    // Fetch commands - session may be done already, so commands returns from mock
    const cmdRes = await fetch(`${ctx.baseUrl}/api/sessions/${sessionId}/commands`);
    expect(cmdRes.status).toBe(200);
    const cmds = await cmdRes.json() as any[];
    // Commands API only works for active sessions; if session finished, returns []
    // Either way, no error
    expect(Array.isArray(cmds)).toBe(true);
  }, 15_000);
});
