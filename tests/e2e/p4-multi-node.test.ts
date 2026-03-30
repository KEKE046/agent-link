// P4 Integration tests — multi-node and relay scenarios.
// These spawn real CLI processes on random ports.

import { describe, test, expect, afterAll } from "bun:test";
import {
  spawnPanel, spawnNode, waitForNode, approveNode, waitForNodeOnline, stopProcess,
  type ProcessContext,
} from "./multi-node-setup";

const procs: ProcessContext[] = [];
function track(ctx: ProcessContext) { procs.push(ctx); return ctx; }

afterAll(() => {
  for (const p of procs) stopProcess(p);
});

describe("P4: Multi-node", () => {
  let panel: ProcessContext;
  let nodeA: ProcessContext;

  test("Panel starts and accepts nodes", async () => {
    panel = track(await spawnPanel());
    const resp = await fetch(`${panel.url}/api/nodes`);
    const nodes = await resp.json();
    // Panel's own local node should be listed
    expect(Array.isArray(nodes)).toBe(true);
    expect(nodes.length).toBeGreaterThanOrEqual(1);
    expect(nodes[0].online).toBe(true);
  }, 20_000);

  test("Node connects and appears in panel", async () => {
    nodeA = track(await spawnNode(panel.url, { name: "worker-a" }));
    const nodeId = await waitForNode(panel.url, "worker-a");
    expect(nodeId).toContain("worker-a");
  }, 20_000);

  test("Node starts as unapproved", async () => {
    const resp = await fetch(`${panel.url}/api/nodes`);
    const nodes: any[] = await resp.json();
    const remote = nodes.find((n) => n.nodeId.includes("worker-a"));
    expect(remote).toBeDefined();
    expect(remote.online).toBe(true);
    expect(remote.approved).toBe(false);
  }, 5_000);

  test("Approve node and dispatch remote command", async () => {
    const nodeId = await waitForNode(panel.url, "worker-a");
    const ok = await approveNode(panel.url, nodeId);
    expect(ok).toBe(true);

    await waitForNodeOnline(panel.url, nodeId);

    // Dispatch listVscodeVersions to remote node
    const resp = await fetch(`${panel.url}/api/vscode/versions?nodeId=${encodeURIComponent(nodeId)}`);
    expect(resp.ok).toBe(true);
    const versions = await resp.json();
    expect(Array.isArray(versions)).toBe(true);
  }, 15_000);

  test("Remote node lists sessions via panel", async () => {
    const nodeId = await waitForNode(panel.url, "worker-a");
    const resp = await fetch(`${panel.url}/api/sessions?nodeId=${encodeURIComponent(nodeId)}`);
    expect(resp.ok).toBe(true);
    const sessions = await resp.json();
    expect(Array.isArray(sessions)).toBe(true);
  }, 10_000);

  test("Node local API also works", async () => {
    const resp = await fetch(`${nodeA.url}/api/vscode/versions`);
    expect(resp.ok).toBe(true);
    const versions = await resp.json();
    expect(Array.isArray(versions)).toBe(true);
  }, 5_000);
});

describe("P4: Relay", () => {
  let panel: ProcessContext;
  let relay: ProcessContext;
  let subNode: ProcessContext;

  test("Relay connects to panel", async () => {
    panel = track(await spawnPanel());
    relay = track(await spawnNode(panel.url, { name: "relay-1", relay: true }));

    const relayId = await waitForNode(panel.url, "relay-1");
    expect(relayId).toContain("relay-1");
    await approveNode(panel.url, relayId);
    await waitForNodeOnline(panel.url, relayId);

    const resp = await fetch(`${panel.url}/api/nodes`);
    const nodes: any[] = await resp.json();
    const relayNode = nodes.find((n) => n.nodeId === relayId);
    expect(relayNode?.online).toBe(true);
    expect(relayNode?.approved).toBe(true);
  }, 25_000);

  test("Sub-node connects via relay and appears on panel", async () => {
    subNode = track(await spawnNode(relay.url, { name: "sub-1" }));

    // Sub-node should appear on the panel (via relay transparent proxy)
    const subId = await waitForNode(panel.url, "sub-1", 15000);
    expect(subId).toContain("sub-1");
  }, 25_000);

  test("Approve sub-node and dispatch command through relay", async () => {
    const subId = await waitForNode(panel.url, "sub-1");
    await approveNode(panel.url, subId);
    await waitForNodeOnline(panel.url, subId);

    // Dispatch to sub-node through relay
    const resp = await fetch(`${panel.url}/api/vscode/versions?nodeId=${encodeURIComponent(subId)}`);
    expect(resp.ok).toBe(true);
    const versions = await resp.json();
    expect(Array.isArray(versions)).toBe(true);
  }, 15_000);

  test("Three nodes visible from panel", async () => {
    const resp = await fetch(`${panel.url}/api/nodes`);
    const nodes: any[] = await resp.json();
    // Panel's local + relay + sub-node
    const onlineNodes = nodes.filter((n) => n.online);
    expect(onlineNodes.length).toBeGreaterThanOrEqual(3);
  }, 5_000);
});
