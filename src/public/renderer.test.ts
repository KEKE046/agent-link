import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

let messagesFactory: any;

function createMessagesInstance() {
  const rendered = { innerHTML: "" };
  const instance = messagesFactory();
  instance.$refs = { rendered };
  instance.$el = { scrollTop: 0, scrollHeight: 0 };
  instance.$nextTick = (fn: () => void) => fn();
  return { instance, rendered };
}

beforeAll(() => {
  let alpineInitHandler: (() => void) | null = null;

  (globalThis as any).window = {};
  (globalThis as any).document = {
    addEventListener(type: string, handler: () => void) {
      if (type === "alpine:init") alpineInitHandler = handler;
    },
  };
  (globalThis as any).marked = { parse: (text: string) => text };
  (globalThis as any).Alpine = {
    data(name: string, factory: any) {
      if (name === "messages") messagesFactory = factory;
    },
  };

  const code = readFileSync(join(import.meta.dir, "renderer.js"), "utf8");
  // eslint-disable-next-line no-new-func
  new Function(code)();
  alpineInitHandler?.();
});

describe("renderer history rendering", () => {
  test("tool groups and tool outputs are collapsed by default", () => {
    const { instance, rendered } = createMessagesInstance();

    instance.loadHistory([
      {
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", id: "t1", name: "Bash", input: { command: "echo hi" } },
          ],
        },
      },
      {
        type: "user",
        message: {
          content: [
            { type: "tool_result", tool_use_id: "t1", content: "ok" },
            { type: "text", text: "next question" },
          ],
        },
      },
    ]);

    expect(rendered.innerHTML).toContain('class="tool-details tool-group');
    expect(rendered.innerHTML).toContain('class="tool-details" data-tool-id="t1"');
    expect(rendered.innerHTML).not.toContain('<details open class="tool-details tool-group');
    expect(rendered.innerHTML).not.toContain('<details open class="tool-details" data-tool-id="t1"');
  });

  test("renders task-notification as tag + summary", () => {
    const { instance, rendered } = createMessagesInstance();

    instance.loadHistory([
      {
        type: "assistant",
        message: {
          content: [
            {
              type: "text",
              text: `<task-notification><summary>Background command failed</summary></task-notification>`,
            },
          ],
        },
      },
    ]);

    expect(rendered.innerHTML).toContain("task-notification");
    expect(rendered.innerHTML).toContain("Background command failed");
  });

  test("renders task-notification in user message and keeps non-tag text escaped", () => {
    const { instance, rendered } = createMessagesInstance();

    instance.loadHistory([
      {
        type: "user",
        message: {
          content: `prefix <task-notification><summary>Failed task</summary></task-notification> <script>alert(1)</script>`,
        },
      },
    ]);

    expect(rendered.innerHTML).toContain("task-notification");
    expect(rendered.innerHTML).toContain("Failed task");
    expect(rendered.innerHTML).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(rendered.innerHTML).not.toContain("<task-notification>");
  });

  test("tool kinds keep semantic color classes", () => {
    const { instance, rendered } = createMessagesInstance();

    instance.loadHistory([
      {
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", id: "b1", name: "Bash", input: { command: "echo hi" } },
            { type: "tool_use", id: "r1", name: "Read", input: { file_path: "/tmp/a" } },
            { type: "tool_use", id: "w1", name: "Write", input: { file_path: "/tmp/b" } },
            { type: "tool_use", id: "e1", name: "Edit", input: { file_path: "/tmp/c" } },
            { type: "tool_use", id: "g1", name: "Grep", input: { pattern: "x", path: "." } },
          ],
        },
      },
      { type: "result", subtype: "success", total_cost_usd: 0, num_turns: 1, usage: { input_tokens: 0, output_tokens: 0 } },
    ]);

    expect(rendered.innerHTML).toContain("tool-kind-bash");
    expect(rendered.innerHTML).toContain("tool-kind-read");
    expect(rendered.innerHTML).toContain("tool-kind-write");
    expect(rendered.innerHTML).toContain("tool-kind-edit");
    expect(rendered.innerHTML).toContain("tool-kind-search");
  });

  test("user and assistant rows use distinct classes and last process stays open", () => {
    const { instance, rendered } = createMessagesInstance();

    instance.loadHistory([
      { type: "user", message: { content: "hello" } },
      { type: "assistant", message: { content: [{ type: "text", text: "working..." }] } },
    ]);

    expect(rendered.innerHTML).toContain("message-user");
    expect(rendered.innerHTML).toContain("message-assistant");
    expect(rendered.innerHTML).toContain('<details open class="process-details mt-0.5">');
  });

  test("result is rendered outside process details", () => {
    const { instance, rendered } = createMessagesInstance();

    instance.loadHistory([
      { type: "assistant", message: { content: [{ type: "text", text: "thinking..." }] } },
      { type: "result", subtype: "success", total_cost_usd: 0.1, num_turns: 1, usage: { input_tokens: 1, output_tokens: 2 } },
    ]);

    const processClose = rendered.innerHTML.indexOf("</details>");
    const resultPos = rendered.innerHTML.indexOf("success | cost:");
    expect(processClose).toBeGreaterThan(-1);
    expect(resultPos).toBeGreaterThan(processClose);
  });

  test("long user message is collapsed by default", () => {
    const { instance, rendered } = createMessagesInstance();

    instance.loadHistory([
      { type: "user", message: { content: "line1\nline2\nline3\nline4" } },
    ]);

    expect(rendered.innerHTML).toContain('class="user-message-details"');
    expect(rendered.innerHTML).toContain("user-message-summary");
    expect(rendered.innerHTML).toContain("<summary");
  });
});
