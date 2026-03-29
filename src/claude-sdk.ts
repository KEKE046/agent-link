import {
  query as sdkQuery,
  listSessions as sdkListSessions,
  getSessionInfo as sdkGetSessionInfo,
  getSessionMessages as sdkGetSessionMessages,
  type Query,
} from "@anthropic-ai/claude-agent-sdk";
// embed.js uses Bun's `import ... with { type: 'file' }` to embed the Claude CLI
// into compiled binaries and extract it to a temp dir before spawning.
import embeddedCliPath from "@anthropic-ai/claude-agent-sdk/embed";

export type { Query };

export interface ClaudeSdk {
  query: (_params: { prompt: string; options?: Record<string, any> }) => Query;
  listSessions: typeof sdkListSessions;
  getSessionInfo: typeof sdkGetSessionInfo;
  getSessionMessages: typeof sdkGetSessionMessages;
}

// Wrap query to always inject the embedded CLI path so compiled binaries work
function wrappedQuery(params: { prompt: string; options?: Record<string, any> }): Query {
  return sdkQuery({
    prompt: params.prompt,
    options: { pathToClaudeCodeExecutable: embeddedCliPath, ...params.options } as any,
  });
}

const defaultSdk: ClaudeSdk = {
  query: wrappedQuery,
  listSessions: sdkListSessions,
  getSessionInfo: sdkGetSessionInfo,
  getSessionMessages: sdkGetSessionMessages,
};

let currentSdk: ClaudeSdk = defaultSdk;

export function getClaudeSdk(): ClaudeSdk {
  return currentSdk;
}

export function setClaudeSdk(sdk: ClaudeSdk | null | undefined) {
  currentSdk = sdk || defaultSdk;
}
