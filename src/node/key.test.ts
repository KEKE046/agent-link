import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { loadOrCreateNodeKey } from "./key";

describe("node key persistence", () => {
  test("loadOrCreateNodeKey is idempotent", () => {
    const root = join("/tmp", `agent-link-key-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    Bun.env.AGENT_LINK_HOME = root;
    const first = loadOrCreateNodeKey();
    const second = loadOrCreateNodeKey();
    expect(first).toBe(second);
    expect(first.length).toBe(8);
    rmSync(root, { recursive: true, force: true });
  });
});
