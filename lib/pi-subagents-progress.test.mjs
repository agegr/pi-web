import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { buildRunProgress, formatElapsed, formatRunProgress } = await jiti.import("./pi-subagents-progress.ts");

const t = (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key);

function row(id, relation) {
  return {
    path: `/sessions/proj/parent/${id}/run-0/session.jsonl`,
    id,
    cwd: "/proj",
    created: "2026-01-01T00:00:00.000Z",
    modified: "2026-01-01T00:00:00.000Z",
    messageCount: 1,
    firstMessage: id,
    relation: { kind: "subagent", parentSessionId: "main", profile: "scout", description: id, status: "running", ...relation },
  };
}

function node(id, overrides = {}) {
  return { id, kind: "subagent", label: id, state: "running", ...overrides };
}

test("joins a single run to its own row and leaves the relations of others untouched", () => {
  const rows = [row("child", { runId: "run-1", stepRunId: "step:0" })];
  const progress = buildRunProgress(rows, [node("run-1", {
    state: "complete",
    startedAt: 1000,
    endedAt: 3000,
    activity: { currentTool: "read", turnCount: 4, toolCount: 9 },
  })]);
  assert.deepEqual([...progress.keys()], ["child"]);
  assert.equal(progress.get("child").status, "completed");
  assert.equal(progress.get("child").activity.toolCount, 9);
});

test("gives each step child of a multi-step chain its own progress instead of last-wins", () => {
  const rows = [
    row("first", { runId: "wf", stepRunId: "git" }),
    row("second", { runId: "wf", stepRunId: "verify" }),
  ];
  const progress = buildRunProgress(rows, [
    node("wf", {
      kind: "workflow",
      state: "running",
      children: [
        { id: "git", kind: "step", label: "git", state: "complete" },
        { id: "verify", kind: "step", label: "verify", state: "running", activity: { currentTool: "bash" } },
      ],
    }),
  ]);
  assert.equal(progress.get("first").status, "completed");
  assert.equal(progress.get("second").status, "running");
  assert.equal(progress.get("second").label, "verify");
});

test("a chain step's nested run id joins by stepRunId before the outer run id", () => {
  const rows = [row("child", { runId: "outer", stepRunId: "inner-run" })];
  const progress = buildRunProgress(rows, [
    node("outer", { kind: "workflow", state: "running" }),
    node("inner-run", { state: "complete" }),
  ]);
  assert.equal(progress.get("child").status, "completed");
});

test("never overwrites a claimed step row with the workflow aggregate", () => {
  const rows = [row("only", { runId: "wf", stepRunId: "lane" })];
  const progress = buildRunProgress(rows, [
    node("wf", {
      kind: "workflow",
      state: "running",
      children: [{ id: "lane", kind: "step", label: "lane", state: "complete" }],
    }),
  ]);
  assert.equal(progress.get("only").status, "completed", "the step's own state survives");
});

test("falls back to a run id and then to a path/name substring for keyless relations", () => {
  const byRunId = buildRunProgress([row("child", { runId: "run-9" })], [node("run-9", { state: "complete" })]);
  assert.equal(byRunId.get("child").status, "completed");

  const keyless = buildRunProgress([{
    path: "/sessions/proj/parent/async-run-9/session.jsonl",
    id: "child",
    cwd: "/proj",
    created: "2026-01-01T00:00:00.000Z",
    modified: "2026-01-01T00:00:00.000Z",
    messageCount: 1,
    firstMessage: "child",
    relation: { kind: "subagent", parentSessionId: "main", profile: "scout", description: "child", status: "running" },
  }], [node("run-9", { state: "failed" })]);
  assert.equal(keyless.get("child").status, "failed", "the run id appears in the child's directory path");
});

// Issue #5: every async run starts its first step at `step:0`, so a step join
// that ignores the owning run claims the first finished row in family order and
// badges it Running with another run's live activity. The running agent's own
// row must keep the live node, and the finished rows must stay untouched.
test("a live run claims only its own row when finished rows share the step:0 id", () => {
  const rows = [
    row("reviewer", { runId: "finished-run-1", stepRunId: "step:0", status: "completed" }),
    row("worker", { runId: "finished-run-2", stepRunId: "step:0", status: "completed" }),
    row("delegate", { runId: "live-run", stepRunId: "step:0" }),
  ];
  const progress = buildRunProgress(rows, [
    node("live-run", {
      state: "running",
      startedAt: 1000,
      activity: { currentTool: "bash", turnCount: 1, toolCount: 1 },
      children: [{ id: "step:0", kind: "step", label: "delegate", state: "running", activity: { currentTool: "bash" } }],
    }),
  ]);
  assert.deepEqual([...progress.keys()], ["delegate"], "only the live run's row is claimed");
  assert.equal(progress.get("delegate").status, "running");
  assert.equal(progress.get("reviewer"), undefined, "a finished row never holds another run's progress");
  assert.equal(progress.get("worker"), undefined);
});

test("a live step node cannot claim a finished row from a different run", () => {
  const rows = [
    row("finished", { runId: "other-run", stepRunId: "step:0", status: "completed" }),
    row("live", { runId: "live-run", stepRunId: "step:0" }),
  ];
  const progress = buildRunProgress(rows, [
    node("live-run", { state: "running", children: [{ id: "step:0", kind: "step", label: "live", state: "running" }] }),
  ]);
  assert.deepEqual([...progress.keys()], ["live"]);
});

// A nested run the package lifts back to the top level (`liveRoots`) is its own
// run node, and the row records its id as `stepRunId` beside the outer `runId`.
test("a lifted nested run node joins its row by its own node id as stepRunId", () => {
  const rows = [
    row("child", { runId: "outer", stepRunId: "inner-run" }),
    row("finished", { runId: "other", stepRunId: "step:0", status: "completed" }),
  ];
  const progress = buildRunProgress(rows, [
    node("outer", { kind: "workflow", state: "running" }),
    node("inner-run", { state: "complete" }),
  ]);
  assert.equal(progress.get("child").status, "completed");
  assert.equal(progress.get("finished"), undefined, "the step:0 placeholder stays unclaimed");
});

// A `host-step` child carries an author-supplied monitor id, so it can collide
// with another run's lane key. It is a placeholder, not a run, and must never
// take the bare-`stepRunId` join.
test("a host-step child cannot claim another run's row by a colliding id", () => {
  const rows = [row("monitored", { runId: "other-run", stepRunId: "build", status: "completed" })];
  const progress = buildRunProgress(rows, [
    node("run-1", {
      state: "running",
      children: [{ id: "build", kind: "host-step", label: "build", state: "running" }],
    }),
  ]);
  assert.equal(progress.get("monitored"), undefined, "the colliding placeholder claims nothing");
});

// The claimedNodes guard does work the kind allowlist cannot: a *run* node is
// exactly what the allowlist admits, and a lifted run may be walked twice — once
// as another run's child and, flattened, as its own root entry. Here `inner` is
// claimed by childA through the qualified step join; without the guard its
// repeat visits reach `grand` by run id, so one node would badge two rows. The
// allowlist and the claimedNodes guard jointly keep doubly-visited placeholders
// from claiming; the step variant above pins the conjunction, this one pins
// claimedNodes alone.
test("a doubly-visited run node cannot claim a second row", () => {
  const rows = [
    row("childA", { runId: "outer", stepRunId: "inner" }),
    row("grand", { runId: "inner", stepRunId: "step:0" }),
  ];
  const inner = node("inner", { state: "running" });
  const outer = node("outer", { state: "running", children: [inner] });
  const progress = buildRunProgress(rows, [outer, inner, inner]);
  assert.deepEqual([...progress.keys()], ["childA"], "one node claims one row");
  assert.equal(progress.get("grand"), undefined, "the run-node repeat visit claims nothing more");
});

// The step half of the doubly-visited case: the same step node handed in twice
// — as its run's child and, once flattened, as its own root entry. It fails only
// when the kind allowlist and claimedNodes are both removed, so it pins the
// conjunction those two share; the run-node variant above pins claimedNodes
// alone.
test("a doubly-visited step node leaves unrelated finished rows unclaimed", () => {
  const rows = [
    row("finished", { runId: "other-run", stepRunId: "step:0", status: "completed" }),
    row("live", { runId: "live-run", stepRunId: "step:0" }),
  ];
  const step = { id: "step:0", kind: "step", label: "live", state: "running" };
  const live = node("live-run", { state: "running", children: [step] });
  // The flattened list the widget lift produces: the run followed by its step
  // as a separate top-level entry.
  const progress = buildRunProgress(rows, [live, step]);
  assert.deepEqual([...progress.keys()], ["live"], "only the live run's own row is claimed");
  assert.equal(progress.get("finished"), undefined, "the finished row is left alone");
});

test("formats elapsed time and the compact progress line", () => {
  assert.equal(formatElapsed(0, 5000), "");
  assert.equal(formatElapsed(1000, 45000), "44s");
  assert.equal(formatElapsed(1000, 1000 + 125_000), "2m 5s");

  const live = formatRunProgress({
    label: "scout",
    status: "running",
    startedAt: 1000,
    endedAt: 6000,
    activity: { currentTool: "grep", turnCount: 2, toolCount: 5 },
  }, t);
  assert.match(live, /agentSwitcher\.run\.tool/);
  assert.match(live, /agentSwitcher\.run\.turns/);
  assert.match(live, /agentSwitcher\.run\.tools/);

  const done = formatRunProgress({
    label: "scout",
    status: "completed",
    startedAt: 1000,
    endedAt: 6000,
    activity: { currentTool: "grep" },
  }, t);
  assert.doesNotMatch(done, /agentSwitcher\.run\.tool/, "a finished run's last tool is not 'current'");
});
