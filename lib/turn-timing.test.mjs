import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";
import { SessionManager } from "@earendil-works/pi-coding-agent";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");
const { buildSessionContext } = await jiti.import("./session-reader.ts");
const { readTurnTimings, TURN_TIMING_CUSTOM_TYPE } = await jiti.import("./turn-timing.ts");
const nextTurn = () => new Promise((resolve) => setImmediate(resolve));
const message = (role, text) => ({ role, content: [{ type: "text", text }], timestamp: Date.now() });

function fixture(t, manager = SessionManager.inMemory()) {
  let listener;
  let resolvePrompt;
  let rejectPrompt;
  const events = [];
  const inner = {
    sessionId: manager.getSessionId(), sessionManager: manager,
    isStreaming: false, isCompacting: false, isBashRunning: false,
    agent: { state: {} }, extensionRunner: {},
    getContextUsage: () => null, getSteeringMessages: () => [], getFollowUpMessages: () => [],
    subscribe(callback) { listener = callback; return () => {}; },
    prompt(text, options) {
      if (inner.isStreaming) { options.preflightResult(true); return Promise.resolve(); }
      options.preflightResult(true);
      inner.isStreaming = true;
      listener({ type: "agent_start" });
      manager.appendMessage(message("user", text));
      return new Promise((resolve, reject) => { resolvePrompt = resolve; rejectPrompt = reject; });
    },
    async abort() {
      manager.appendMessage({ ...message("assistant", "stopped"), stopReason: "aborted" });
      inner.isStreaming = false;
      listener({ type: "agent_settled" });
      resolvePrompt();
    },
    dispose() {},
  };
  const wrapper = new AgentSessionWrapper(inner);
  wrapper.start();
  wrapper.onEvent((event) => events.push(event));
  t.after(() => wrapper.destroy());
  return {
    wrapper, inner, manager, events,
    emit: (event) => listener(event),
    finish: () => resolvePrompt(),
    fail: () => rejectPrompt(new Error("provider failed")),
  };
}

test("one timing spans retries, compaction and queued prompts and survives disk reload", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "pi-web-turn-timing-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const run = fixture(t, SessionManager.create(directory, directory));
  await run.wrapper.send({ type: "prompt", message: "first" });
  const started = run.wrapper.turnTiming;
  assert.equal(typeof started.startedAt, "number");
  assert.equal(started.endedAt, undefined);
  const firstUserId = started.anchorEntryId;
  assert.ok(firstUserId);
  assert.deepEqual((await run.wrapper.send({ type: "get_state" })).turnTiming, started);

  run.manager.appendMessage(message("assistant", "retry error"));
  run.emit({ type: "agent_end" });
  run.emit({ type: "auto_retry_start" });
  run.emit({ type: "agent_start" });
  assert.equal(run.wrapper.turnTiming.id, started.id);
  assert.equal(run.wrapper.turnTiming.endedAt, undefined);
  run.inner.isCompacting = true;
  run.emit({ type: "compaction_start" });
  run.manager.appendCompaction("summary", firstUserId, 1000);
  run.inner.isCompacting = false;
  run.emit({ type: "compaction_end" });
  await run.wrapper.send({ type: "prompt", message: "queued", streamingBehavior: "followUp" });
  run.manager.appendMessage(message("user", "queued"));
  run.manager.appendMessage(message("assistant", "final"));
  const finalEntryId = run.manager.getLeafId();
  run.inner.isStreaming = false;
  run.emit({ type: "agent_settled" });
  assert.equal(run.wrapper.turnTiming.endedAt, undefined, "pending prompt still owns completion");
  run.finish();
  await nextTurn();
  const completed = run.wrapper.turnTiming;
  assert.equal(completed.id, started.id);
  assert.equal(completed.startedAt, started.startedAt);
  assert.ok(completed.endedAt >= started.startedAt);
  assert.equal(completed.anchorEntryId, finalEntryId);
  run.emit({ type: "agent_settled" });
  assert.equal(run.manager.getEntries().filter((entry) => entry.customType === TURN_TIMING_CUSTOM_TYPE).length, 1);
  assert.equal(run.events.filter((event) => event.type === "turn_timing").length, 2);

  const restored = SessionManager.open(run.manager.getSessionFile());
  assert.deepEqual(buildSessionContext(restored.getEntries()).turnTimings, [completed]);
  assert.deepEqual(buildSessionContext(restored.getEntries(), finalEntryId, { tail: 1 }).turnTimings, [completed]);
  assert.deepEqual(buildSessionContext(restored.getEntries(), firstUserId).turnTimings, []);
});

test("accepted failures and Stop freeze timing and persist their visible anchor", async (t) => {
  for (const action of ["fail", "abort"]) {
    const run = fixture(t);
    await run.wrapper.send({ type: "prompt", message: action });
    if (action === "abort") await run.wrapper.send({ type: "abort" });
    else { run.inner.isStreaming = false; run.fail(); }
    await nextTurn();
    assert.equal(typeof run.wrapper.turnTiming.endedAt, "number");
    assert.deepEqual(buildSessionContext(run.manager.getEntries()).turnTimings, [run.wrapper.turnTiming]);
  }
});

test("rejected preflight never starts live or historical timing", async (t) => {
  const run = fixture(t);
  run.inner.prompt = async (_text, options) => { options.preflightResult(false); throw new Error("no key"); };
  await assert.rejects(run.wrapper.send({ type: "prompt", message: "rejected" }), /no key/);
  assert.equal(run.wrapper.turnTiming, null);
  assert.deepEqual(run.manager.getEntries(), []);
  assert.equal(run.events.some((event) => event.type === "turn_timing"), false);
});

test("timing starts at accepted preflight rather than submission", async (t) => {
  const run = fixture(t);
  const realNow = Date.now;
  let now = 1_000;
  Date.now = () => now;
  t.after(() => { Date.now = realNow; });
  run.inner.prompt = (text, options) => {
    now = 5_000;
    options.preflightResult(true);
    run.inner.isStreaming = true;
    run.emit({ type: "agent_start" });
    run.manager.appendMessage(message("user", text));
    return new Promise(() => {});
  };

  await run.wrapper.send({ type: "prompt", message: "accepted" });
  assert.equal(run.wrapper.turnTiming.startedAt, 5_000);
});

test("extension runs get their own timing and finish only once idle", (t) => {
  const run = fixture(t);
  run.inner.isStreaming = true;
  run.emit({ type: "agent_start" });
  run.manager.appendMessage(message("assistant", "extension result"));
  run.emit({ type: "agent_end" });
  assert.equal(run.wrapper.turnTiming.endedAt, undefined);
  run.inner.isStreaming = false;
  run.emit({ type: "agent_settled" });
  assert.equal(typeof run.wrapper.turnTiming.endedAt, "number");
});

test("a rejected submission during a non-streaming gap preserves the active prompt timing", async (t) => {
  const run = fixture(t);
  await run.wrapper.send({ type: "prompt", message: "accepted" });
  const originalTiming = run.wrapper.turnTiming;
  run.inner.isStreaming = false;
  run.inner.isCompacting = true;
  run.inner.prompt = async (_text, options) => {
    options.preflightResult(false);
    throw new Error("compaction in progress");
  };

  await assert.rejects(run.wrapper.send({ type: "prompt", message: "rejected" }), /compaction in progress/);
  assert.deepEqual(run.wrapper.turnTiming, originalTiming);
  assert.equal(run.wrapper.isRunning(), true);
  assert.equal(run.events.filter((event) => event.type === "turn_timing").length, 1);

  run.inner.isCompacting = false;
  run.manager.appendMessage(message("assistant", "accepted run completed"));
  run.finish();
  await nextTurn();
  assert.equal(run.wrapper.turnTiming.id, originalTiming.id);
  assert.equal(run.wrapper.turnTiming.startedAt, originalTiming.startedAt);
  assert.equal(typeof run.wrapper.turnTiming.endedAt, "number");
  assert.deepEqual(buildSessionContext(run.manager.getEntries()).turnTimings, [run.wrapper.turnTiming]);
});

test("timing metadata follows only the selected branch and visible history page", () => {
  const manager = SessionManager.inMemory();
  manager.appendMessage(message("user", "root"));
  const rootId = manager.getLeafId();
  manager.appendMessage(message("assistant", "a"));
  const aId = manager.getLeafId();
  const a = { version: 1, id: "run-a", startedAt: 1000, endedAt: 2000, anchorEntryId: aId };
  manager.appendCustomEntry(TURN_TIMING_CUSTOM_TYPE, a);
  manager.branch(rootId);
  manager.appendMessage(message("assistant", "b"));
  const bId = manager.getLeafId();
  const b = { version: 1, id: "run-b", startedAt: 3000, endedAt: 5000, anchorEntryId: bId };
  manager.appendCustomEntry(TURN_TIMING_CUSTOM_TYPE, b);
  assert.deepEqual(buildSessionContext(manager.getEntries(), aId).turnTimings.map((timing) => timing.id), ["run-a"]);
  assert.deepEqual(buildSessionContext(manager.getEntries(), bId).turnTimings.map((timing) => timing.id), ["run-b"]);
  assert.deepEqual(buildSessionContext(manager.getEntries(), bId, { tail: 1, excludeLeaf: true }).turnTimings, []);
});

test("legacy and malformed timing metadata produce no invented duration", () => {
  const manager = SessionManager.inMemory();
  manager.appendMessage(message("assistant", "legacy"));
  const anchorEntryId = manager.getLeafId();
  for (const data of [null, {}, { version: 1, id: "bad", startedAt: 2, endedAt: 1, anchorEntryId }]) {
    manager.appendCustomEntry(TURN_TIMING_CUSTOM_TYPE, data);
  }
  assert.deepEqual(readTurnTimings(manager.getEntries(), [anchorEntryId]), []);
});
