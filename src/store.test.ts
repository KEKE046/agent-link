import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
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

  test("load reloads when file mtime changes", async () => {
    const root = join("/tmp", `agent-link-store-${Date.now()}-mtime`);
    mkdirSync(root, { recursive: true });
    Bun.env.AGENT_LINK_HOME = root;
    save("sample", { v: 1 });
    const first = load("sample", { v: 0 });
    expect(first).toEqual({ v: 1 });
    await Bun.sleep(5);
    writeFileSync(join(root, "sample.json"), JSON.stringify({ v: 2 }), "utf8");
    const second = load("sample", { v: 0 });
    expect(second).toEqual({ v: 2 });
    rmSync(root, { recursive: true, force: true });
  });
});
