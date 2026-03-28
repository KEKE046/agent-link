import { afterEach, describe, expect, test } from "bun:test";
import {
  getActiveIds,
  interrupt,
  isActive,
  listSessions,
  setModel,
  startQuery,
  subscribe,
} from "./sessions";
import { setClaudeSdk } from "./claude-sdk";
import { createMockClaudeSdk } from "./test-utils/mock-claude-sdk";

afterEach(() => {
  setClaudeSdk(null);
});

describe("sessions with mock claude sdk", () => {
  test("startQuery initializes a new mocked session and emits idle", async () => {
    const { sdk, state } = createMockClaudeSdk({
      queryFactory: () => ({
        messages: [
          {
            type: "system",
            subtype: "init",
            session_id: "session-a",
            model: "claude-sonnet-4.5",
            cwd: "/tmp/project",
            tools: [],
          },
          {
            type: "assistant",
            message: { content: [{ type: "text", text: "hello" }] },
          },
        ],
      }),
    });
    setClaudeSdk(sdk);

    const events: any[] = [];
    const unSub = subscribe("session-a", (msg) => events.push(msg));

    const sessionId = await startQuery("hi", {
      cwd: "/tmp/project",
      model: "claude-sonnet-4.5",
    });

    await new Promise((r) => setTimeout(r, 0));

    expect(sessionId).toBe("session-a");
    expect(state.queryCalls.length).toBe(1);
    expect(state.queryCalls[0].options.model).toBe("claude-sonnet-4.5");
    expect(events.some((e) => e.type === "assistant")).toBe(true);
    expect(events.at(-1)).toEqual({ type: "status", status: "idle" });
    expect(isActive("session-a")).toBe(false);
    expect(getActiveIds()).not.toContain("session-a");

    unSub();
  });

  test("resume query sets resume option and supports interrupt/model change", async () => {
    const { sdk, state } = createMockClaudeSdk({
      queryFactory: () => ({
        messages: [
          {
            type: "assistant",
            message: { content: [{ type: "text", text: "resumed" }] },
          },
        ],
      }),
    });
    setClaudeSdk(sdk);

    const promise = startQuery("continue", {
      sessionId: "session-b",
      cwd: "/repo",
      model: "claude-opus-4.6",
    });

    expect(isActive("session-b")).toBe(true);
    await setModel("session-b", "claude-sonnet-4.5");
    await interrupt("session-b");

    const id = await promise;
    await new Promise((r) => setTimeout(r, 0));

    expect(id).toBe("session-b");
    expect(state.queryCalls[0].options.resume).toBe("session-b");
    expect(state.queryControls[0].setModelCalls).toEqual(["claude-sonnet-4.5"]);
    expect(state.queryControls[0].interruptCalls).toBe(1);
    expect(isActive("session-b")).toBe(false);
  });

  test("listSessions delegates to mocked sdk", async () => {
    const { sdk } = createMockClaudeSdk({
      sessionFactory: () => ({
        listSessions: [{ session_id: "x" }],
      }),
    });
    setClaudeSdk(sdk);

    const sessions = await listSessions("/workspace", 10, 5);
    expect(sessions).toEqual([{ session_id: "x" }]);
  });
});
