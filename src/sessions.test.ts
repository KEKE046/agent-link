import { afterEach, describe, expect, test } from "bun:test";
import {
  getSessionInfo,
  getSessionMessages,
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
    const { sdk, state, waitForCompletion } = createMockClaudeSdk({
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

    const events: unknown[] = [];
    const unSub = subscribe("session-a", (msg) => events.push(msg));

    const sessionId = await startQuery("hi", {
      cwd: "/tmp/project",
      model: "claude-sonnet-4.5",
    });
    await waitForCompletion();

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
    const { sdk, state, waitForCompletion } = createMockClaudeSdk({
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
    await waitForCompletion();

    expect(id).toBe("session-b");
    expect(state.queryCalls[0].options.resume).toBe("session-b");
    expect(state.queryControls[0].setModelCalls).toEqual(["claude-sonnet-4.5"]);
    expect(state.queryControls[0].interruptCalls).toBe(1);
    expect(isActive("session-b")).toBe(false);
  });

  test("listSessions delegates to mocked sdk", async () => {
    const { sdk, state } = createMockClaudeSdk({
      sessionFactory: () => ({
        listSessions: [{ session_id: "x" }],
      }),
    });
    setClaudeSdk(sdk);

    const sessions = await listSessions("/workspace", 10, 5);
    expect(sessions).toEqual([{ session_id: "x" }]);
    expect(state.listSessionsCalls).toEqual([
      [{ dir: "/workspace", limit: 10, offset: 5 }],
    ]);
  });

  test("getSessionInfo delegates to mocked sdk with args", async () => {
    const { sdk, state } = createMockClaudeSdk({
      sessionFactory: () => ({
        sessionInfo: { session_id: "info-1", title: "t1" },
      }),
    });
    setClaudeSdk(sdk);

    const info = await getSessionInfo("info-1", "/workspace");
    expect(info).toEqual({ session_id: "info-1", title: "t1" });
    expect(state.getSessionInfoCalls).toEqual([["info-1", { dir: "/workspace" }]]);
  });

  test("getSessionMessages delegates to mocked sdk with args", async () => {
    const { sdk, state } = createMockClaudeSdk({
      sessionFactory: () => ({
        sessionMessages: [{ session_id: "m1", type: "assistant" }],
      }),
    });
    setClaudeSdk(sdk);

    const messages = await getSessionMessages("m1", "/workspace", 25, 3);
    expect(messages).toEqual([{ session_id: "m1", type: "assistant" }]);
    expect(state.getSessionMessagesCalls).toEqual([
      ["m1", { dir: "/workspace", limit: 25, offset: 3 }],
    ]);
  });

  test("sessionFactory is lazy and evaluated per call", async () => {
    let count = 0;
    const { sdk } = createMockClaudeSdk({
      sessionFactory: () => {
        count += 1;
        return {
          listSessions: [{ session_id: `s-${count}` }],
        };
      },
    });
    setClaudeSdk(sdk);

    expect(await listSessions("/workspace")).toEqual([{ session_id: "s-1" }]);
    expect(await listSessions("/workspace")).toEqual([{ session_id: "s-2" }]);
  });
});
