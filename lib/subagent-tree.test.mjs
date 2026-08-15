import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { buildSubagentTree, findOwnedSubagent, collectLiveSubagentSessionIds } = await jiti.import("./subagent-tree.ts");

function session(id, name, parentSessionId, overrides = {}) {
  return {
    path: `/tmp/${id}.jsonl`,
    id,
    cwd: "/tmp",
    name,
    created: "2026-01-01T00:00:00.000Z",
    modified: "2026-01-01T00:00:00.000Z",
    messageCount: 1,
    firstMessage: `first ${id}`,
    ...(parentSessionId ? { parentSessionId } : {}),
    ...overrides,
  };
}

function live(runId, index, overrides = {}) {
  return {
    version: 1,
    entries: [{
      runId,
      ...(index !== undefined ? { index } : {}),
      agent: "worker",
      state: "running",
      startedAt: 1000,
      updatedAt: 1100,
      ...overrides,
    }],
    total: 1,
    omitted: 0,
  };
}

function controls(node) {
  return { steer: node.canSteer, interrupt: node.canInterrupt, resume: node.canResume };
}

test("nests direct children and grandchildren under their durable parents", () => {
  const root = session("root", "Main task");
  const child = session("child", "subagent-worker-317e1ca0-1", "root", { created: "2026-01-01T00:01:00.000Z" });
  const grand = session("grand", "subagent-reviewer-76fa6d64-6031-4824-8a88-1282c22d9afa-2", "child", { created: "2026-01-02T00:00:00.000Z" });
  const tree = buildSubagentTree({ rootId: "root", sessions: [root, child, grand], runs: null, rpcAvailable: false, polledAt: 2000 });

  assert.equal(tree.rootSessionId, "root");
  assert.equal(tree.rpcAvailable, false);
  assert.equal(tree.nodes.length, 1);
  assert.equal(tree.nodes[0].sessionId, "child");
  assert.equal(tree.nodes[0].parentSessionId, "root");
  assert.equal(tree.nodes[0].children.length, 1);
  assert.equal(tree.nodes[0].children[0].sessionId, "grand");
  assert.equal(tree.nodes[0].children[0].parentSessionId, "child");
});

test("durable-only nodes are inactive with no controls or timing", () => {
  const root = session("root", "Main task");
  const child = session("child", "subagent-worker-317e1ca0-1", "root");
  const tree = buildSubagentTree({ rootId: "root", sessions: [root, child], runs: null, rpcAvailable: false, polledAt: 2000 });

  const node = tree.nodes[0];
  assert.equal(node.state, "inactive");
  assert.equal(node.startedAt, undefined);
  assert.equal(node.elapsedMs, undefined);
  assert.deepEqual(controls(node), { steer: false, interrupt: false, resume: false });
  assert.equal(node.task, "first child");
});

test("durable task prefers the live label, then firstMessage, before the session name", () => {
  const root = session("root", "Main task");
  const child = session("child", "subagent-worker-317e1ca0-1", "root");
  const runs = live("317e1ca0", 0, { label: "Inspect RPC" });
  const tree = buildSubagentTree({ rootId: "root", sessions: [root, child], runs, rpcAvailable: true, polledAt: 2000 });
  assert.equal(tree.nodes[0].task, "Inspect RPC");

  const withoutLabel = buildSubagentTree({ rootId: "root", sessions: [root, child], runs: null, rpcAvailable: false, polledAt: 2000 });
  assert.equal(withoutLabel.nodes[0].task, "first child");
});

test("durable task skips a forked firstMessage cloned from the root or parent", () => {
  const prompt = "检查下，本机是否已经安装一个私募基金净值生成的skills";
  const root = session("root", "Main task", undefined, { firstMessage: prompt });
  const child = session("child", "subagent-worker-317e1ca0-1", "root", { firstMessage: prompt });
  const tree = buildSubagentTree({ rootId: "root", sessions: [root, child], runs: null, rpcAvailable: false, polledAt: 2000 });
  assert.equal(tree.nodes[0].task, "");

  const runs = live("317e1ca0", 0, { label: "PPTX to HTML" });
  const liveTree = buildSubagentTree({ rootId: "root", sessions: [root, child], runs, rpcAvailable: true, polledAt: 2000 });
  assert.equal(liveTree.nodes[0].task, "PPTX to HTML");
});

test("durable task collapses generated boilerplate after the first line", () => {
  const root = session("root", "Main task");
  const child = session("child", "subagent-worker-317e1ca0-1", "root", {
    firstMessage: "Task: run the probe\n\n---\n**Output:**\nwrite to /tmp/main.md\n\n## Acceptance Contract",
  });
  const tree = buildSubagentTree({ rootId: "root", sessions: [root, child], runs: null, rpcAvailable: false, polledAt: 2000 });
  assert.equal(tree.nodes[0].task, "Task: run the probe");
});

test("exact runId/index live state overrides lifecycle, activity, and timing only", () => {
  const root = session("root", "Main task");
  const child = session("child", "subagent-worker-317e1ca0-1", "root", { created: "2026-01-01T00:01:00.000Z" });
  const runs = live("317e1ca0", 0, { agent: "worker", state: "running", activityState: "active_long_running", currentTool: "bash", startedAt: 1000, updatedAt: 1100 });
  const tree = buildSubagentTree({ rootId: "root", sessions: [root, child], runs, rpcAvailable: true, polledAt: 1500 });

  const node = tree.nodes[0];
  assert.equal(node.sessionId, "child");
  assert.equal(node.task, "first child");
  assert.equal(node.state, "running");
  assert.equal(node.activity, "bash");
  assert.equal(node.startedAt, 1000);
  assert.equal(node.elapsedMs, 500);
  assert.deepEqual(controls(node), { steer: true, interrupt: true, resume: false });
});

test("unmatched live entries become disabled starting placeholders", () => {
  const root = session("root", "Main task");
  const runs = live("deadbeef", 0, { agent: "ghost", state: "running", startedAt: 1000, updatedAt: 1100 });
  const tree = buildSubagentTree({ rootId: "root", sessions: [root], runs, rpcAvailable: true, polledAt: 1500 });

  assert.equal(tree.nodes.length, 1);
  const node = tree.nodes[0];
  assert.equal(node.sessionId, null);
  assert.equal(node.state, "starting");
  assert.equal(node.task, "ghost");
  assert.deepEqual(controls(node), { steer: false, interrupt: false, resume: false });
});

test("nested live entries attach under the matching durable parent", () => {
  const root = session("root", "Main task");
  const parent = session("parent", "subagent-worker-317e1ca0-1", "root");
  const runs = {
    version: 1,
    entries: [
      { runId: "317e1ca0", index: 0, agent: "worker", state: "running", startedAt: 1000, updatedAt: 1100 },
      { runId: "12ab34cd", index: 0, parentRunId: "317e1ca0", parentIndex: 0, agent: "tester", state: "running", startedAt: 1050, updatedAt: 1080 },
    ],
    total: 2,
    omitted: 0,
  };
  const tree = buildSubagentTree({ rootId: "root", sessions: [root, parent], runs, rpcAvailable: true, polledAt: 1500 });

  const parentNode = tree.nodes[0];
  assert.equal(parentNode.children.length, 1);
  const nested = parentNode.children[0];
  assert.equal(nested.sessionId, null);
  assert.equal(nested.state, "starting");
  assert.equal(nested.runId, "12ab34cd");
  assert.equal(nested.parentSessionId, "parent");
});

test("excludes unrelated forks, other-root subagents, and orphans", () => {
  const root = session("root", "Main task");
  const otherRoot = session("other-root", "Other task");
  const fork = session("fork", "Alternative approach", "root");
  const foreign = session("foreign", "subagent-worker-33333333-0", "other-root");
  const orphan = session("orphan", "subagent-worker-44444444-1");
  const owned = session("owned", "subagent-worker-317e1ca0-1", "root");
  const tree = buildSubagentTree({ rootId: "root", sessions: [root, otherRoot, fork, foreign, orphan, owned], runs: null, rpcAvailable: false, polledAt: 0 });

  assert.deepEqual(tree.nodes.map((node) => node.sessionId), ["owned"]);
});

test("cycles and missing parents attach safely to the root", () => {
  const root = session("root", "Main task");
  const a = session("a", "subagent-worker-11111111-1", "b");
  const b = session("b", "subagent-worker-22222222-1", "a");
  const missing = session("missing", "subagent-worker-33333333-1", "gone");
  const tree = buildSubagentTree({ rootId: "root", sessions: [root, a, b, missing], runs: null, rpcAvailable: false, polledAt: 0 });

  assert.equal(tree.nodes.length, 3);
  for (const node of tree.nodes) {
    assert.equal(node.parentSessionId, "root");
    assert.deepEqual(node.children, []);
  }
});

test("capabilities derive from lifecycle state", () => {
  const root = session("root", "Main task");
  const queued = session("queued", "subagent-worker-11111111-1", "root");
  const running = session("running", "subagent-worker-22222222-1", "root");
  const paused = session("paused", "subagent-worker-33333333-1", "root");
  const done = session("done", "subagent-worker-44444444-1", "root");
  const runs = {
    version: 1,
    entries: [
      { runId: "11111111", index: 0, agent: "w", state: "queued", startedAt: 1000, updatedAt: 1000 },
      { runId: "22222222", index: 0, agent: "w", state: "running", startedAt: 1000, updatedAt: 1000 },
      { runId: "33333333", index: 0, agent: "w", state: "paused", startedAt: 1000, updatedAt: 1000 },
      { runId: "44444444", index: 0, agent: "w", state: "complete", startedAt: 1000, updatedAt: 1000 },
    ],
    total: 4,
    omitted: 0,
  };
  const tree = buildSubagentTree({ rootId: "root", sessions: [root, queued, running, paused, done], runs, rpcAvailable: true, polledAt: 2000 });

  const byId = new Map(tree.nodes.map((node) => [node.sessionId, node]));
  assert.deepEqual(controls(byId.get("queued")), { steer: true, interrupt: false, resume: false });
  assert.deepEqual(controls(byId.get("running")), { steer: true, interrupt: true, resume: false });
  assert.deepEqual(controls(byId.get("paused")), { steer: false, interrupt: false, resume: true });
  assert.deepEqual(controls(byId.get("done")), { steer: false, interrupt: false, resume: false });
});

test("needs_attention maps from the package activity state", () => {
  const root = session("root", "Main task");
  const child = session("child", "subagent-worker-317e1ca0-1", "root");
  const runs = live("317e1ca0", 0, { state: "running", activityState: "needs_attention", startedAt: 1000, updatedAt: 1100 });
  const tree = buildSubagentTree({ rootId: "root", sessions: [root, child], runs, rpcAvailable: true, polledAt: 1500 });

  const node = tree.nodes[0];
  assert.equal(node.state, "needs_attention");
  assert.equal(node.activity, "needs_attention");
  assert.deepEqual(controls(node), { steer: true, interrupt: true, resume: false });
});

test("elapsedMs only applies to live non-terminal entries", () => {
  const root = session("root", "Main task");
  const active = session("active", "subagent-worker-11111111-1", "root");
  const done = session("done", "subagent-worker-22222222-1", "root");
  const runs = {
    version: 1,
    entries: [
      { runId: "11111111", index: 0, agent: "w", state: "running", startedAt: 1000, updatedAt: 1100 },
      { runId: "22222222", index: 0, agent: "w", state: "complete", startedAt: 500, updatedAt: 900 },
    ],
    total: 2,
    omitted: 0,
  };
  const tree = buildSubagentTree({ rootId: "root", sessions: [root, active, done], runs, rpcAvailable: true, polledAt: 2000 });

  const byId = new Map(tree.nodes.map((node) => [node.sessionId, node]));
  assert.equal(byId.get("active").elapsedMs, 1000);
  assert.equal(byId.get("done").elapsedMs, undefined);
});

test("sibling order uses durable creation time, then live start, then address", () => {
  const root = session("root", "Main task");
  const first = session("first", "subagent-worker-11111111-1", "root", { created: "2026-01-01T00:01:00.000Z" });
  const second = session("second", "subagent-worker-22222222-1", "root", { created: "2026-01-01T00:02:00.000Z" });
  const third = session("third", "subagent-worker-33333333-1", "root", { created: "2026-01-01T00:03:00.000Z" });
  const runs = {
    version: 1,
    entries: [
      { runId: "33333333", index: 0, agent: "w", state: "running", startedAt: 500, updatedAt: 600 },
      { runId: "22222222", index: 0, agent: "w", state: "running", startedAt: 400, updatedAt: 600 },
      { runId: "44444444", index: 0, agent: "w", state: "running", startedAt: 100, updatedAt: 600 },
    ],
    total: 3,
    omitted: 0,
  };
  const tree = buildSubagentTree({ rootId: "root", sessions: [root, first, second, third], runs, rpcAvailable: true, polledAt: 2000 });

  // first (created earliest), then second (live start 400), then third (live start 500),
  // then the unmatched live placeholder (live start 100? no - placeholders sort by live start too)
  assert.deepEqual(tree.nodes.map((node) => node.sessionId), ["first", "second", "third", null]);
});

test("rebuilding without live data keeps the complete durable tree", () => {
  const root = session("root", "Main task");
  const child = session("child", "subagent-worker-317e1ca0-1", "root");
  const grand = session("grand", "subagent-reviewer-76fa6d64-6031-4824-8a88-1282c22d9afa-2", "child");
  const liveTree = buildSubagentTree({ rootId: "root", sessions: [root, child, grand], runs: live("317e1ca0", 0), rpcAvailable: true, polledAt: 2000 });
  const rebuilt = buildSubagentTree({ rootId: "root", sessions: [root, child, grand], runs: null, rpcAvailable: false, polledAt: 2500 });

  assert.equal(liveTree.nodes.length, 1);
  assert.equal(rebuilt.nodes.length, 1);
  assert.equal(rebuilt.nodes[0].children.length, 1);
  assert.equal(rebuilt.nodes[0].children[0].sessionId, "grand");
  assert.equal(rebuilt.nodes[0].children[0].state, "inactive");
});

test("findOwnedSubagent resolves only subagents owned by the root", () => {
  const root = session("root", "Main task");
  const otherRoot = session("other-root", "Other task");
  const owned = session("owned", "subagent-worker-317e1ca0-1", "root");
  const foreign = session("foreign", "subagent-worker-33333333-0", "other-root");
  const orphan = session("orphan", "subagent-worker-44444444-1");
  const sessions = [root, otherRoot, owned, foreign, orphan];

  assert.equal(findOwnedSubagent("root", "owned", sessions)?.id, "owned");
  assert.equal(findOwnedSubagent("root", "foreign", sessions), null);
  assert.equal(findOwnedSubagent("root", "orphan", sessions), null);
  assert.equal(findOwnedSubagent("root", "missing", sessions), null);
  assert.equal(findOwnedSubagent("root", "root", sessions), null);
});

test("collectLiveSubagentSessionIds returns only active durable children", () => {
  const root = session("root", "Main task");
  const running = session("running", "subagent-worker-c486ba7a-1", "root");
  const attention = session("attention", "subagent-reviewer-76fa6d64-1", "root");
  const done = session("done", "subagent-worker-aaaaaaaa-1", "root");
  const ids = collectLiveSubagentSessionIds(
    [root, running, attention, done],
    {
      version: 1,
      entries: [
        { runId: "c486ba7a", index: 0, agent: "worker", state: "running", updatedAt: 1 },
        { runId: "76fa6d64", index: 0, agent: "reviewer", state: "running", activityState: "needs_attention", updatedAt: 1 },
        { runId: "aaaaaaaa", index: 0, agent: "worker", state: "complete", updatedAt: 1 },
      ],
      total: 3,
      omitted: 0,
    },
  );
  assert.deepEqual([...ids].sort(), ["attention", "running"]);
});
