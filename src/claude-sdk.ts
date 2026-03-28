import {
  query as sdkQuery,
  listSessions as sdkListSessions,
  getSessionInfo as sdkGetSessionInfo,
  getSessionMessages as sdkGetSessionMessages,
  type Query,
} from "@anthropic-ai/claude-agent-sdk";

export type { Query };

export interface ClaudeSdk {
  query: typeof sdkQuery;
  listSessions: typeof sdkListSessions;
  getSessionInfo: typeof sdkGetSessionInfo;
  getSessionMessages: typeof sdkGetSessionMessages;
}

const defaultSdk: ClaudeSdk = {
  query: sdkQuery,
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
