// Local action dispatcher — single source of truth for action→function mapping.
// Used by Router (local dispatch) and Node connector (panel request handling).

import * as sessions from "./sessions";
import {
  listInstalledVersions,
  startVscodeServer,
  stopVscodeServer,
  getInstallCommand,
} from "./vscode";

export async function dispatch(action: string, params: any): Promise<any> {
  switch (action) {
    case "query":
      return { sessionId: await sessions.startQuery(params.prompt, {
        sessionId: params.sessionId, cwd: params.cwd, model: params.model,
      })};
    case "interrupt":
      await sessions.interrupt(params.sessionId);
      return { ok: true };
    case "setModel":
      await sessions.setModel(params.sessionId, params.model);
      return { ok: true };
    case "listSessions":
      return sessions.listSessions(params.cwd, params.limit || 50, params.offset || 0);
    case "getSessionInfo":
      return sessions.getSessionInfo(params.sessionId, params.cwd);
    case "getSessionMessages":
      return sessions.getSessionMessages(params.sessionId, params.cwd, params.limit || 200, params.offset || 0);
    case "listVscodeVersions":
      return listInstalledVersions();
    case "startVscodeServer":
      return startVscodeServer(params.cwd, params.commit);
    case "stopVscodeServer":
      return { ok: await stopVscodeServer(params.cwd) };
    case "getInstallCommand":
      return getInstallCommand(params.version);
    default:
      throw new Error(`Unknown action: ${action}`);
  }
}
