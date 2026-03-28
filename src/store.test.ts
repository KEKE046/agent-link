import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { load, save } from "./store";

describe("store json persistence", () => {
  test("save then load returns consistent data", () => {
    const root = join("/tmp", `agent-link-store-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    Bun.env.AGENT_LINK_HOME = root;
    const payload = { a: 1, nested: { b: "x" } };
    save("sample", payload);
    const loaded = load("sample", { a: 0, nested: { b: "" } });
    expect(loaded).toEqual(payload);
    rmSync(root, { recursive: true, force: true });
  });
});
