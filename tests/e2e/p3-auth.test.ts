// P3 E2E tests — authentication
//
// 15. No-auth mode (default in tests)
// 16. Auth mode (token login flow)

import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { type BrowserContext, type Page } from "playwright";
import {
  startTestServer, stopTestServer, createPage,
  type TestContext,
} from "./setup";
import { initAuth, resetAuth } from "../../src/auth";

let ctx: TestContext;
let context: BrowserContext;
let page: Page;

beforeAll(async () => {
  ctx = await startTestServer();
}, 30_000);

afterAll(async () => {
  resetAuth();
  await stopTestServer(ctx);
}, 10_000);

beforeEach(async () => {
  ({ context, page } = await createPage(ctx));
  page.on("pageerror", (err) => console.log(`[page error] ${err.message}`));
});

afterEach(async () => {
  resetAuth();
  try { await context.close(); } catch {}
});

describe("P3: Auth", () => {
  test("15. No-auth mode — API works without token", async () => {
    // Default test server has no auth (initAuth not called)
    await page.goto(ctx.baseUrl);
    await page.waitForSelector("text=Agent Link");

    // Login screen should NOT appear
    expect(await page.isVisible("input[placeholder='Admin token']")).toBe(false);

    // Main app should be visible
    await page.waitForSelector("text=No agents");
    expect(await page.isVisible("text=No agents")).toBe(true);

    // API should report no auth required
    const res = await fetch(`${ctx.baseUrl}/api/auth/check`);
    const data = await res.json();
    expect(data.authenticated).toBe(true);
    expect(data.required).toBe(false);

    // API calls should succeed without credentials
    const managedRes = await fetch(`${ctx.baseUrl}/api/managed`);
    expect(managedRes.status).toBe(200);
  }, 15_000);

  test("16. Auth mode — login screen and token flow", async () => {
    // Enable auth with a known token
    const token = initAuth("test-secret-token");
    expect(token).toBe("test-secret-token");

    // Auth check should report required
    const checkRes = await fetch(`${ctx.baseUrl}/api/auth/check`);
    const checkData = await checkRes.json();
    expect(checkData.required).toBe(true);
    expect(checkData.authenticated).toBe(false);

    // Protected API should return 401 without token
    const protectedRes = await fetch(`${ctx.baseUrl}/api/managed`);
    expect(protectedRes.status).toBe(401);

    // Protected API should work with Bearer token
    const bearerRes = await fetch(`${ctx.baseUrl}/api/managed`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(bearerRes.status).toBe(200);

    // --- Browser login flow ---
    await page.goto(ctx.baseUrl);

    // Login screen should appear
    await page.waitForSelector("input[placeholder='Admin token']", { timeout: 10_000 });
    expect(await page.isVisible("input[placeholder='Admin token']")).toBe(true);

    // Main app should NOT be visible
    expect(await page.isVisible("text=No agents")).toBe(false);

    // Try wrong token
    await page.fill("input[placeholder='Admin token']", "wrong-token");
    await page.click("button:has-text('Login')");

    // Should show error
    await page.waitForSelector("text=invalid token", { timeout: 5_000 });
    expect(await page.isVisible("text=invalid token")).toBe(true);

    // Enter correct token
    await page.fill("input[placeholder='Admin token']", "test-secret-token");
    await page.click("button:has-text('Login')");

    // Login screen should disappear, main app should appear
    await page.waitForSelector("text=No agents", { timeout: 10_000 });
    expect(await page.isVisible("text=No agents")).toBe(true);
    expect(await page.isVisible("input[placeholder='Admin token']")).toBe(false);

    // URL-based auto-login should also work (new page, no cookie)
    const page2 = await context.newPage();
    await page2.goto(`${ctx.baseUrl}/login?token=${token}`);
    await page2.waitForSelector("text=Agent Link", { timeout: 10_000 });
    // After redirect, should be authenticated (cookie set)
    await page2.waitForSelector("text=No agents", { timeout: 10_000 });
    expect(await page2.isVisible("text=No agents")).toBe(true);
    await page2.close();
  }, 30_000);
});
