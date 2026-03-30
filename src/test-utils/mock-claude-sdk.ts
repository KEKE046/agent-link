import type { ClaudeSdk, Query } from "../claude-sdk";

type QueryMessage = {
  type: string;
  [key: string]: unknown;
};

type QueryControls = {
  interruptCalls: number;
  setModelCalls: string[];
};

type QueryArgs = Parameters<ClaudeSdk["query"]>[0];
type ListSessionsArgs = Parameters<ClaudeSdk["listSessions"]>;
type GetSessionInfoArgs = Parameters<ClaudeSdk["getSessionInfo"]>;
type GetSessionMessagesArgs = Parameters<ClaudeSdk["getSessionMessages"]>;
type ListSessionsResult = Awaited<ReturnType<ClaudeSdk["listSessions"]>>;
type GetSessionInfoResult = Awaited<ReturnType<ClaudeSdk["getSessionInfo"]>>;
type GetSessionMessagesResult = Awaited<
  ReturnType<ClaudeSdk["getSessionMessages"]>
>;

type QueryFactory = (args: QueryArgs) => {
  messages: QueryMessage[];
  throwError?: Error;
};

type SessionFactory = () => {
  listSessions?: ListSessionsResult;
  sessionInfo?: GetSessionInfoResult;
  sessionMessages?: GetSessionMessagesResult;
};

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function createQueryFromMessages(
  messages: QueryMessage[],
  controls: QueryControls,
  completion: () => void,
  throwError?: Error
): Query {
  return {
    async interrupt() {
      controls.interruptCalls += 1;
    },
    async setModel(model: string) {
      controls.setModelCalls.push(model);
    },
    async stopTask(_taskId: string) {
      // no-op in mock
    },
    async supportedCommands() {
      return [
        { name: "compact", description: "Compact conversation history", argumentHint: "" },
        { name: "clear", description: "Clear conversation", argumentHint: "" },
        { name: "help", description: "Show help", argumentHint: "" },
        { name: "model", description: "Switch model", argumentHint: "<model>" },
      ];
    },
    async *[Symbol.asyncIterator]() {
      try {
        for (const message of messages) {
          yield message;
        }
        if (throwError) throw throwError;
      } finally {
        completion();
      }
    },
  } as Query;
}

export function createMockClaudeSdk(opts?: {
  queryFactory?: QueryFactory;
  sessionFactory?: SessionFactory;
}) {
  const queryCalls: QueryArgs[] = [];
  const queryControls: QueryControls[] = [];
  const queryCompletions: Promise<void>[] = [];
  const listSessionsCalls: ListSessionsArgs[] = [];
  const getSessionInfoCalls: GetSessionInfoArgs[] = [];
  const getSessionMessagesCalls: GetSessionMessagesArgs[] = [];

  const sdk: ClaudeSdk = {
    query(args: QueryArgs) {
      queryCalls.push(args);
      const controls: QueryControls = { interruptCalls: 0, setModelCalls: [] };
      queryControls.push(controls);
      const done = createDeferred();
      queryCompletions.push(done.promise);
      const result = opts?.queryFactory?.(args) || {
        messages: [
          {
            type: "system",
            subtype: "init",
            session_id: "mock-session-id",
            model: args?.options?.model,
            cwd: args?.options?.cwd,
            tools: [],
          },
          {
            type: "result",
            subtype: "success",
            total_cost_usd: 0,
            num_turns: 1,
            usage: { input_tokens: 0, output_tokens: 0 },
          },
        ],
      };

      return createQueryFromMessages(
        result.messages,
        controls,
        done.resolve,
        result.throwError
      );
    },
    async listSessions(...args: ListSessionsArgs) {
      listSessionsCalls.push(args);
      const defaults = opts?.sessionFactory?.() || {};
      return defaults.listSessions || [];
    },
    async getSessionInfo(...args: GetSessionInfoArgs) {
      getSessionInfoCalls.push(args);
      const defaults = opts?.sessionFactory?.() || {};
      if (defaults.sessionInfo) return defaults.sessionInfo;
      return { session_id: args[0] } as GetSessionInfoResult;
    },
    async getSessionMessages(...args: GetSessionMessagesArgs) {
      getSessionMessagesCalls.push(args);
      const defaults = opts?.sessionFactory?.() || {};
      if (defaults.sessionMessages) return defaults.sessionMessages;
      return [{ session_id: args[0] }] as GetSessionMessagesResult;
    },
  };

  return {
    sdk,
    async waitForCompletion(index = queryCompletions.length - 1) {
      if (index < 0 || !queryCompletions[index]) return;
      await queryCompletions[index];
    },
    state: {
      queryCalls,
      queryControls,
      listSessionsCalls,
      getSessionInfoCalls,
      getSessionMessagesCalls,
    },
  };
}
