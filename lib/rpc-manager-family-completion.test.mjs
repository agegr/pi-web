import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { AgentSessionWrapper, hasBusyRpcSessionForCwd } = await jiti.import("./rpc-manager.ts");
const { forgetSessionCompletion } = await jiti.import("./session-completion.ts");

function setup(t, id = "family-root", options = {}) {
  const previous = globalThis.__piSubagentRuns;
  globalThis.__piSubagentRuns = new Map();
  const pushed = [];
  const events = [];
  let listener;
  const inner = {
    sessionId: id,
    isStreaming: false,
    isBashRunning: false,
    isCompacting: false,
    extensionRunner: {},
    sessionManager: { getCwd: () => "/tmp", getSessionName: () => "Task", getEntries: () => [] },
    agent: { state: {} },
    getContextUsage: () => null,
    getSteeringMessages: () => [],
    getFollowUpMessages: () => [],
    subscribe: (next) => { listener = next; return () => {}; },
    abort: async () => {},
    dispose() {},
  };
  const wrapper = new AgentSessionWrapper(inner, {
    onAgentRunComplete: (sessionId) => pushed.push(sessionId),
    ...options,
  });
  wrapper.start();
  wrapper.onEvent((event) => events.push(event));
  t.after(() => {
    wrapper.destroy();
    forgetSessionCompletion(id);
    globalThis.__piSubagentRuns = previous;
  });
  return {
    inner, wrapper, pushed, events,
    start() { inner.isStreaming = true; listener({ type: "agent_start" }); },
    settle(aborted = false) { inner.isStreaming = false; listener({ type: "agent_settled", aborted }); },
    addChild(child = "child", parent = id) {
      globalThis.__piSubagentRuns.set(child, { run: { sessionId: child, parentSessionId: parent } });
    },
    removeChild(child = "child") { globalThis.__piSubagentRuns.delete(child); },
    completions() { return events.filter((event) => event.type === "session_complete"); },
  };
}

test("a main agent's interim replies are silent until every child and the final reply settle", async (t) => {
  const run = setup(t);
  run.start();
  run.addChild("first");
  run.addChild("last");
  run.settle();
  assert.equal(run.wrapper.isRunning(), false, "own idle state must not include descendants");
  assert.deepEqual(run.pushed, []);
  assert.deepEqual(run.completions(), []);

  run.removeChild("first");
  run.start();
  run.settle();
  assert.deepEqual(run.pushed, [], "an intermediate synthesis is not a completion");

  run.start();
  run.removeChild("last");
  run.wrapper.recheckCompletion();
  assert.deepEqual(run.pushed, [], "the final parent reply is still streaming");
  run.settle();
  assert.deepEqual(run.pushed, ["family-root"]);
  assert.equal(run.completions().length, 1);
  assert.equal(run.completions()[0].completionId, run.wrapper.completionId);
  const state = await run.wrapper.send({ type: "get_state" });
  assert.equal(state.completionId, run.wrapper.completionId);

  run.wrapper.recheckCompletion();
  run.settle();
  assert.equal(run.completions().length, 1, "rechecking cannot announce the same work twice");
});

test("a child release after the parent's settled event rechecks the still-owed completion", (t) => {
  const run = setup(t);
  run.start();
  run.addChild();
  run.settle();
  assert.deepEqual(run.pushed, []);
  // notifyParent holds its pending record throughout the parent turn it triggered.
  run.start();
  run.settle();
  assert.deepEqual(run.pushed, []);
  run.removeChild();
  run.wrapper.recheckCompletion();
  assert.equal(run.completions().length, 1);
  assert.deepEqual(run.pushed, ["family-root"]);
});

test("unrelated sessions do not delay an ordinary main-agent completion", (t) => {
  const run = setup(t);
  run.addChild("unrelated-child", "another-main");
  run.start();
  run.settle();
  assert.equal(run.completions().length, 1);
});

test("a suppressed child never publishes a completion event or snapshot id", (t) => {
  const run = setup(t, "suppressed-child", { suppressCompletionNotifications: true });
  run.start();
  run.settle();
  assert.deepEqual(run.completions(), []);
  assert.equal(run.wrapper.completionId, undefined);
  assert.deepEqual(run.pushed, []);
});

test("Stop of an idle main waiting for children survives later result-triggered runs", async (t) => {
  const run = setup(t);
  run.start();
  run.addChild();
  run.settle();
  await run.wrapper.send({ type: "abort" });
  run.start();
  run.settle();
  run.removeChild();
  run.wrapper.recheckCompletion();
  assert.deepEqual(run.completions(), []);
  assert.deepEqual(run.pushed, []);
  // A new independent run can announce normally; the stopped cycle is not a permanent mute.
  run.start();
  run.settle();
  assert.equal(run.completions().length, 1);
});

test("trust refresh cannot rebuild an idle root while its isolated descendants are unsettled", (t) => {
  const run = setup(t, "trust-family-root");
  const previousRegistry = globalThis.__piSessions;
  globalThis.__piSessions = new Map([[run.wrapper.sessionId, run.wrapper]]);
  t.after(() => { globalThis.__piSessions = previousRegistry; });
  run.start();
  run.addChild("isolated-worktree-child");
  run.settle();
  assert.equal(run.wrapper.isRunning(), false);
  assert.equal(hasBusyRpcSessionForCwd("/tmp"), true, "the production trust-refresh gate must wait for the whole family");
  assert.equal(hasBusyRpcSessionForCwd("/unrelated-project"), false);
  run.removeChild("isolated-worktree-child");
  run.wrapper.recheckCompletion();
  assert.equal(hasBusyRpcSessionForCwd("/tmp"), false);
  assert.equal(run.completions().length, 1);
});

test("aborted runs stay silent after a pending result releases", (t) => {
  const run = setup(t);
  run.start();
  run.addChild();
  run.settle(true);
  run.removeChild();
  run.wrapper.recheckCompletion();
  assert.deepEqual(run.completions(), []);
});

test("failed result delivery releases waiting without announcing an unfinished synthesis", (t) => {
  const run = setup(t);
  run.start();
  run.addChild();
  run.settle();
  run.removeChild();
  run.wrapper.recheckCompletion({ deliveryFailed: true });
  assert.deepEqual(run.completions(), []);
  run.wrapper.recheckCompletion();
  assert.deepEqual(run.pushed, []);
});

test("completion ids are committed before publication and increase across runs", (t) => {
  const run = setup(t);
  const observedIds = [];
  run.wrapper.onEvent((event) => {
    if (event.type === "session_complete") observedIds.push(run.wrapper.completionId);
  });
  run.start();
  run.settle();
  run.start();
  run.settle();
  assert.equal(observedIds.length, 2);
  assert.ok(Number(observedIds[1]) > Number(observedIds[0]));
  assert.deepEqual(observedIds, run.completions().map((event) => event.completionId));
});

test("pending and cancelled family state survive root wrapper replacement", async (t) => {
  const run = setup(t);
  run.start();
  run.addChild();
  run.settle();
  await run.wrapper.send({ type: "abort" });
  run.wrapper.destroy();

  const pushed = [];
  let listener;
  const inner = { ...run.inner, subscribe: (next) => { listener = next; return () => {}; } };
  const replacement = new AgentSessionWrapper(inner, { onAgentRunComplete: () => pushed.push(true) });
  replacement.start();
  t.after(() => replacement.destroy());
  inner.isStreaming = true;
  listener({ type: "agent_start" });
  inner.isStreaming = false;
  listener({ type: "agent_settled" });
  run.removeChild();
  replacement.recheckCompletion();
  assert.deepEqual(pushed, []);
});

test("an idle root awaiting descendants survives its idle timeout without changing running state", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const run = setup(t, "idle-family-root");
  run.start();
  run.addChild();
  run.settle();
  assert.equal(run.wrapper.isRunning(), false);
  t.mock.timers.tick(10 * 60 * 1000);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(run.wrapper.isAlive(), true, "pending family notification keeps only the root warm");
  assert.equal(run.wrapper.isRunning(), false);
  assert.deepEqual(run.pushed, []);
  run.removeChild();
  run.wrapper.recheckCompletion();
  assert.deepEqual(run.pushed, ["idle-family-root"]);
  t.mock.timers.tick(10 * 60 * 1000);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(run.wrapper.isAlive(), false, "ordinary idle cleanup resumes after completion");
});

test("a cancelled family notification does not keep an idle root alive indefinitely", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const run = setup(t, "cancelled-idle-family-root");
  run.start();
  run.addChild();
  run.settle();
  await run.wrapper.send({ type: "abort" });
  t.mock.timers.tick(10 * 60 * 1000);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(run.wrapper.isAlive(), false);
  assert.deepEqual(run.completions(), []);
});

test("a rejected new prompt cannot unmute a previously stopped family", async (t) => {
  const run = setup(t, "rejected-family-root");
  run.start();
  run.addChild();
  run.settle();
  await run.wrapper.send({ type: "abort" });
  run.inner.prompt = async () => { throw new Error("preflight rejected"); };
  await assert.rejects(run.wrapper.send({ type: "prompt", message: "invalid request" }), /preflight rejected/);
  run.start();
  run.settle();
  run.removeChild();
  run.wrapper.recheckCompletion();
  assert.deepEqual(run.completions(), []);
  assert.deepEqual(run.pushed, []);
});
