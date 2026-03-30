// E2E test helper — starts an in-process mock server for Playwright tests.

import { createApp } from "../../src/routes";
import { Router } from "../../src/router";
import { setClaudeSdk } from "../../src/claude-sdk";
import { createMockClaudeSdk } from "../../src/test-utils/mock-claude-sdk";
import { mkdirSync, rmSync } from "node:fs";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

let queryCounter = 0;

/** Create a mock SDK that returns a simple assistant reply for each query. */
export function createTestSdk() {
  return createMockClaudeSdk({
    queryFactory: (args) => {
      const sessionId = (args.options as any)?.resume || `test-session-${++queryCounter}`;
      return {
        messages: [
          {
            type: "system",
            subtype: "init",
            session_id: sessionId,
            model: (args.options as any)?.model || "sonnet",
            cwd: (args.options as any)?.cwd || "/tmp",
            tools: [],
            slash_commands: ["compact", "clear", "help", "model"],
          },
          {
            type: "assistant",
            message: {
              content: [{ type: "text", text: `Mock reply to: ${args.prompt}` }],
            },
          },
          {
            type: "result",
            subtype: "success",
            total_cost_usd: 0.001,
            num_turns: 1,
            usage: { input_tokens: 10, output_tokens: 20 },
          },
        ],
      };
    },
  });
}

export interface TestContext {
  server: ReturnType<typeof Bun.serve>;
  port: number;
  tmpDir: string;
  browser: Browser;
  sdk: ReturnType<typeof createTestSdk>;
  baseUrl: string;
}

/** Start a test server with mock SDK on a random port. */
export async function startTestServer(): Promise<TestContext> {
  const tmpDir = `/tmp/agent-link-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  mkdirSync(tmpDir, { recursive: true });
  process.env.AGENT_LINK_HOME = tmpDir;
  process.env.NODE_ENV = "development";

  queryCounter = 0;
  const sdk = createTestSdk();
  setClaudeSdk(sdk.sdk);

  const router = new Router("test-local");
  const app = createApp(router, "test-local");

  const server = Bun.serve({ port: 0, idleTimeout: 120, fetch: app.fetch });
  const browser = await chromium.launch();

  return {
    server,
    port: server.port,
    tmpDir,
    browser,
    sdk,
    baseUrl: `http://localhost:${server.port}`,
  };
}

/** Clean up test server resources. */
export async function stopTestServer(ctx: TestContext) {
  await ctx.browser.close();
  ctx.server.stop();
  setClaudeSdk(null);
  try { rmSync(ctx.tmpDir, { recursive: true, force: true }); } catch {}
}

/** Install a slow mock SDK — the assistant reply is delayed so tests can interact mid-query. */
export function installSlowSdk(delayMs = 3000) {
  const { sdk } = createMockClaudeSdk({
    queryFactory: (args) => {
      const sessionId = (args.options as any)?.resume || `test-session-${++queryCounter}`;
      return {
        messages: [
          {
            type: "system",
            subtype: "init",
            session_id: sessionId,
            model: (args.options as any)?.model || "sonnet",
            cwd: (args.options as any)?.cwd || "/tmp",
            tools: [],
            slash_commands: ["compact", "clear", "help", "model"],
            // __delay is consumed by the patched iterator below
            __delay: delayMs,
          } as any,
          {
            type: "assistant",
            message: {
              content: [{ type: "text", text: `Slow reply to: ${args.prompt}` }],
            },
            __delay: delayMs,
          } as any,
          {
            type: "result",
            subtype: "success",
            total_cost_usd: 0.001,
            num_turns: 1,
            usage: { input_tokens: 10, output_tokens: 20 },
          },
        ],
      };
    },
  });

  // Patch the SDK query to add delays between messages
  const origQuery = sdk.query;
  sdk.query = (params) => {
    const q = origQuery(params);
    const origIter = q[Symbol.asyncIterator]();
    let first = true;
    return {
      ...q,
      [Symbol.asyncIterator]() {
        return {
          async next() {
            const result = await origIter.next();
            if (!result.done && !first) {
              const msg = result.value as any;
              if (msg?.__delay) await Bun.sleep(msg.__delay);
            }
            first = false;
            return result;
          },
        };
      },
    } as any;
  };

  setClaudeSdk(sdk);
}

/** Restore the default fast mock SDK. */
export function installFastSdk(ctx: TestContext) {
  setClaudeSdk(ctx.sdk.sdk);
}

/** Install a mock SDK that emits background task lifecycle messages. */
export function installTaskSdk() {
  const { sdk } = createMockClaudeSdk({
    queryFactory: (args) => {
      const sessionId = (args.options as any)?.resume || `test-session-${++queryCounter}`;
      return {
        messages: [
          {
            type: "system",
            subtype: "init",
            session_id: sessionId,
            model: (args.options as any)?.model || "sonnet",
            cwd: (args.options as any)?.cwd || "/tmp",
            tools: [],
            slash_commands: ["compact", "clear", "help", "model"],
          },
          {
            type: "system",
            subtype: "task_started",
            task_id: "bg-task-1",
            description: "Searching codebase",
            task_type: "background",
            uuid: "uuid-task-started",
            session_id: sessionId,
          },
          {
            type: "system",
            subtype: "task_progress",
            task_id: "bg-task-1",
            description: "Searching codebase",
            summary: "Found 3 matches so far",
            usage: { total_tokens: 500, tool_uses: 2, duration_ms: 1200 },
            last_tool_name: "Grep",
            uuid: "uuid-task-progress",
            session_id: sessionId,
          },
          {
            type: "assistant",
            message: {
              content: [{ type: "text", text: "Working on the background task..." }],
            },
          },
          {
            type: "system",
            subtype: "task_notification",
            task_id: "bg-task-1",
            status: "completed",
            summary: "Found 5 TypeScript files matching the pattern",
            output_file: "/tmp/output",
            usage: { total_tokens: 1200, tool_uses: 5, duration_ms: 3000 },
            uuid: "uuid-task-notification",
            session_id: sessionId,
          },
          {
            type: "result",
            subtype: "success",
            total_cost_usd: 0.005,
            num_turns: 2,
            usage: { input_tokens: 100, output_tokens: 200 },
          },
        ],
      };
    },
  });
  setClaudeSdk(sdk);
}

/** Create a fresh browser context + page for a single test. */
export async function createPage(ctx: TestContext): Promise<{ context: BrowserContext; page: Page }> {
  const context = await ctx.browser.newContext();
  const page = await context.newPage();
  return { context, page };
}
