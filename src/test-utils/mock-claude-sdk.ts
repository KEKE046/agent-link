import type { ClaudeSdk, Query } from "../claude-sdk";

type QueryMessage = any;

type QueryControls = {
  interruptCalls: number;
  setModelCalls: string[];
};

type QueryFactory = (args: any) => {
  messages: QueryMessage[];
  throwError?: Error;
};

type SessionFactory = () => {
  listSessions?: any;
  sessionInfo?: any;
  sessionMessages?: any;
};

function createQueryFromMessages(
  messages: QueryMessage[],
  controls: QueryControls,
  throwError?: Error
): Query {
  return {
    async interrupt() {
      controls.interruptCalls += 1;
    },
    async setModel(model: string) {
      controls.setModelCalls.push(model);
    },
    async *[Symbol.asyncIterator]() {
      for (const message of messages) {
        yield message;
      }
      if (throwError) throw throwError;
    },
  } as Query;
}

export function createMockClaudeSdk(opts?: {
  queryFactory?: QueryFactory;
  sessionFactory?: SessionFactory;
}) {
  const queryCalls: any[] = [];
  const queryControls: QueryControls[] = [];
  const defaults = opts?.sessionFactory?.() || {};

  const sdk: ClaudeSdk = {
    query(args: any) {
      queryCalls.push(args);
      const controls: QueryControls = { interruptCalls: 0, setModelCalls: [] };
      queryControls.push(controls);
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

      return createQueryFromMessages(result.messages, controls, result.throwError);
    },
    async listSessions() {
      return defaults.listSessions || [];
    },
    async getSessionInfo(sessionId: string) {
      if (defaults.sessionInfo) return defaults.sessionInfo;
      return { session_id: sessionId };
    },
    async getSessionMessages(sessionId: string) {
      if (defaults.sessionMessages) return defaults.sessionMessages;
      return [{ session_id: sessionId }];
    },
  };

  return {
    sdk,
    state: {
      queryCalls,
      queryControls,
    },
  };
}
