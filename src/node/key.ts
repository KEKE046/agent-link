import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

export function loadOrCreateNodeKey() {
  const dir = Bun.env.AGENT_LINK_HOME || join(homedir(), ".agent-link");
  const path = join(dir, "node-key");
  mkdirSync(dir, { recursive: true });
  try {
    const existing = readFileSync(path, "utf8").trim();
    if (existing) return existing;
  } catch {}
  // 6 bytes = 48 bits entropy; base64url encodes to 8 chars, matching required key length.
  const key = randomBytes(6).toString("base64url");
  writeFileSync(path, `${key}\n`, { encoding: "utf8", mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {}
  return key;
}
