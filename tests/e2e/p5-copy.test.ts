// P5 E2E tests — folder copy feature
//
// 1. GET /api/copy/next-name returns auto-incremented destination
// 2. POST /api/copy/start copies folder and tracks task
// 3. Copy with custom destination
// 4. Failed copy shows error, can be deleted
// 5. Task record can be removed
// 6. UI: Duplicate popup opens with pre-filled dest
// 7. UI: Copying folder shows spinner, no ... menu
// 8. UI: Failed folder shows red dot, Delete Failed Copy in menu

import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, existsSync, chmodSync, rmSync } from "node:fs";
import { join } from "node:path";
import { type BrowserContext, type Page } from "playwright";
import { startTestServer, stopTestServer, createPage, type TestContext } from "./setup";
import { save } from "../../src/store";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await startTestServer();
}, 30_000);

afterAll(async () => {
  await stopTestServer(ctx);
}, 10_000);

// Helper: create a test folder with files
function createTestFolder(name: string): string {
  const dir = join(ctx.tmpDir, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "file.txt"), "test content");
  mkdirSync(join(dir, "sub"), { recursive: true });
  writeFileSync(join(dir, "sub", "nested.txt"), "nested");
  return dir;
}

// Helper: add a managed folder via API
async function addManagedFolder(cwd: string) {
  await fetch(`${ctx.baseUrl}/api/managed-folders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd, nodeId: "test-local" }),
  });
}

// Helper: wait for copy task to reach a status
async function waitForTaskStatus(taskId: string, status: string, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(`${ctx.baseUrl}/api/copy/tasks/${taskId}`);
    const task = await res.json();
    if (task.status === status) return task;
    await Bun.sleep(100);
  }
  throw new Error(`Task ${taskId} did not reach status ${status} within ${timeoutMs}ms`);
}

describe("P5: Copy API", () => {
  test("1. next-name returns .1 for base folder", async () => {
    const src = createTestFolder("proj-api");
    const res = await fetch(`${ctx.baseUrl}/api/copy/next-name?cwd=${encodeURIComponent(src)}`);
    const data = await res.json();
    expect(data.dest).toBe(src + ".1");
    expect(data.number).toBe(1);
  });

  test("2. next-name skips existing", async () => {
    const src = createTestFolder("proj-skip");
    mkdirSync(src + ".1");
    mkdirSync(src + ".2");
    const res = await fetch(`${ctx.baseUrl}/api/copy/next-name?cwd=${encodeURIComponent(src)}`);
    const data = await res.json();
    expect(data.dest).toBe(src + ".3");
    expect(data.number).toBe(3);
  });

  test("3. start copy with auto dest", async () => {
    const src = createTestFolder("proj-copy");
    const res = await fetch(`${ctx.baseUrl}/api/copy/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ src }),
    });
    const task = await res.json();
    expect(task.status).toBe("copying");
    expect(task.dest).toBe(src + ".1");

    await waitForTaskStatus(task.id, "done");

    // Verify files
    const { readFileSync } = await import("node:fs");
    expect(readFileSync(join(src + ".1", "file.txt"), "utf8")).toBe("test content");
    expect(readFileSync(join(src + ".1", "sub", "nested.txt"), "utf8")).toBe("nested");
  });

  test("4. start copy with custom dest", async () => {
    const src = createTestFolder("proj-custom");
    const dest = join(ctx.tmpDir, "my-backup");
    const res = await fetch(`${ctx.baseUrl}/api/copy/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ src, dest }),
    });
    const task = await res.json();
    expect(task.dest).toBe(dest);

    await waitForTaskStatus(task.id, "done");
    expect(existsSync(join(dest, "file.txt"))).toBe(true);
  });

  test("5. error: source missing", async () => {
    const res = await fetch(`${ctx.baseUrl}/api/copy/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ src: "/tmp/nonexistent-xyz" }),
    });
    const data = await res.json();
    expect(data.error).toContain("Source does not exist");
  });

  test("6. error: dest exists", async () => {
    const src = createTestFolder("proj-dup");
    mkdirSync(src + ".1");
    const res = await fetch(`${ctx.baseUrl}/api/copy/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ src, dest: src + ".1" }),
    });
    const data = await res.json();
    expect(data.error).toContain("Destination already exists");
  });

  test("7. failed copy + delete intermediate result", async () => {
    const src = createTestFolder("proj-fail");
    writeFileSync(join(src, "locked"), "secret");
    chmodSync(join(src, "locked"), 0o000);

    const res = await fetch(`${ctx.baseUrl}/api/copy/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ src }),
    });
    const task = await res.json();

    const failed = await waitForTaskStatus(task.id, "failed");
    expect(failed.error).toContain("Permission denied");
    expect(existsSync(task.dest)).toBe(true);

    // Delete the failed copy
    const delRes = await fetch(`${ctx.baseUrl}/api/copy/tasks/${task.id}/delete`, { method: "POST" });
    const delTask = await delRes.json();
    expect(delTask.status).toBe("deleting");

    await waitForTaskStatus(task.id, "deleted");
    expect(existsSync(task.dest)).toBe(false);

    // Cleanup
    chmodSync(join(src, "locked"), 0o644);
  });

  test("8. cannot delete a done copy", async () => {
    const src = createTestFolder("proj-nodelete");
    const startRes = await fetch(`${ctx.baseUrl}/api/copy/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ src }),
    });
    const task = await startRes.json();
    await waitForTaskStatus(task.id, "done");

    const res = await fetch(`${ctx.baseUrl}/api/copy/tasks/${task.id}/delete`, { method: "POST" });
    const data = await res.json();
    expect(data.error).toContain("Can only delete failed copies");
  });

  test("9. remove task record", async () => {
    const src = createTestFolder("proj-remove");
    const startRes = await fetch(`${ctx.baseUrl}/api/copy/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ src }),
    });
    const task = await startRes.json();
    await waitForTaskStatus(task.id, "done");

    const delRes = await fetch(`${ctx.baseUrl}/api/copy/tasks/${task.id}`, { method: "DELETE" });
    const data = await delRes.json();
    expect(data.ok).toBe(true);

    const getRes = await fetch(`${ctx.baseUrl}/api/copy/tasks/${task.id}`);
    expect(getRes.status).toBe(404);
  });

  test("10. list tasks returns all", async () => {
    // Clear tasks first
    save("copy-tasks", []);

    const src = createTestFolder("proj-list");
    await fetch(`${ctx.baseUrl}/api/copy/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ src }),
    });
    await Bun.sleep(500);

    const res = await fetch(`${ctx.baseUrl}/api/copy/tasks`);
    const tasks = await res.json();
    expect(tasks.length).toBeGreaterThanOrEqual(1);
    expect(tasks.some((t: any) => t.src === src)).toBe(true);
  });
});

describe("P5: Copy UI", () => {
  let context: BrowserContext;
  let page: Page;

  beforeEach(async () => {
    ({ context, page } = await createPage(ctx));
    // Clear tasks
    save("copy-tasks", []);
  });

  afterEach(async () => {
    try { await context.close(); } catch {}
  });

  test("11. Duplicate popup shows with pre-filled dest", async () => {
    const src = createTestFolder("proj-ui-dup");
    await addManagedFolder(src);

    await page.goto(ctx.baseUrl);
    await page.waitForFunction((s) => document.body.textContent?.includes(s), src);

    // Hover folder row to reveal ... button — use xpath to find the row containing this path
    const folderRow = page.locator(`.pl-7`).filter({ hasText: "proj-ui-dup" }).first();
    await folderRow.hover();
    await folderRow.locator("button:has-text('…')").click();

    // Click Duplicate
    await page.click("text=Duplicate");
    await page.waitForSelector("text=Duplicate Folder");

    // Check dest is pre-filled (async fetch, wait for value to appear)
    const destInput = page.locator("input#copy-dest-input");
    await page.waitForFunction(
      () => (document.querySelector("input#copy-dest-input") as HTMLInputElement)?.value?.includes(".1"),
      { timeout: 5000 },
    );
    const value = await destInput.inputValue();
    expect(value).toBe(src + ".1");

    // Cancel
    await page.click("button:has-text('Cancel')");
  }, 15_000);

  test("12. Copying folder shows spinner and hides menu", async () => {
    const src = createTestFolder("proj-ui-spin");
    await addManagedFolder(src);
    await addManagedFolder(src + ".1");

    // Inject a mock copying task
    save("copy-tasks", [{
      id: "mock-spin",
      src,
      dest: src + ".1",
      status: "copying",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      pid: 999999,
    }]);

    await page.goto(ctx.baseUrl);
    await page.waitForFunction((s) => document.body.textContent?.includes(s), src + ".1");

    // The copying folder row should have a spinner (svg.animate-spin)
    const destRow = page.locator(`.pl-7`).filter({ hasText: "proj-ui-spin.1" }).first();
    const spinner = destRow.locator("svg.animate-spin");
    expect(await spinner.isVisible()).toBe(true);

    // The ... button should not be visible
    const menuBtn = destRow.locator("button:has-text('…')");
    expect(await menuBtn.isVisible()).toBe(false);
  }, 15_000);

  test("13. Failed folder shows red dot and Delete option", async () => {
    const src = createTestFolder("proj-ui-fail");
    await addManagedFolder(src);
    await addManagedFolder(src + ".1");

    // Inject a mock failed task
    save("copy-tasks", [{
      id: "mock-fail",
      src,
      dest: src + ".1",
      status: "failed",
      error: "Permission denied",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }]);

    await page.goto(ctx.baseUrl);
    await page.waitForFunction((s) => document.body.textContent?.includes(s), src + ".1");

    // The failed folder should show a red dot instead of arrow
    const destRow = page.locator(`.pl-7`).filter({ hasText: "proj-ui-fail.1" }).first();
    const redDot = destRow.locator("span[title='Copy failed']");
    expect(await redDot.isVisible()).toBe(true);

    // Open ... menu
    await destRow.hover();
    await destRow.locator("button:has-text('…')").click();

    // Should have "Delete Failed Copy" option
    await page.waitForSelector("text=Delete Failed Copy");
    expect(await page.isVisible("text=Delete Failed Copy")).toBe(true);
  }, 15_000);
});
