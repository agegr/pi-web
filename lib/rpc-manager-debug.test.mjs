import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

// startRpcSession() builds real SDK sessions here; keep them out of ~/.pi.
const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const testAgentDir = await mkdtemp(join(tmpdir(), "pi-web-debug-agent-"));
process.env.PI_CODING_AGENT_DIR = testAgentDir;

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const {
  AgentSessionWrapper,
  SESSION_IDLE_TIMEOUT_MS,
  getRpcSessionDebugSnapshots,
  getRpcSessionLifecycle,
  getRpcStartingSessionIds,
  startRpcSession,
} = await jiti.import("./rpc-manager.ts");
const { registerSessionLivenessProvider } = await jiti.import("./session-liveness.ts");

after(async () => {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  await rm(testAgentDir, { recursive: true, force: true });
});

const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

function makeIdleInner(overrides = {}) {
  return {
    sessionId: "session-1",
    isBashRunning: false,
    isStreaming: false,
    isCompacting: false,
    extensionRunner: {},
    agent: { state: {} },
    subscribe: () => () => {},
    dispose() {},
    ...overrides,
  };
}

test("a started wrapper's snapshot: its times, flags and the idle timer it armed", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
  const wrapper = new AgentSessionWrapper(makeIdleInner());
  t.after(() => wrapper.destroy());
  assert.equal(wrapper.getDebugSnapshot().idle.nextCheckAt, null, "nothing is armed before start()");
  t.mock.timers.tick(5);
  wrapper.start();

  assert.deepEqual(wrapper.getDebugSnapshot(), {
    sessionId: "session-1",
    state: "alive",
    stale: false,
    subagent: false,
    chatOnly: false,
    createdAt: 1_000_000,
    startedAt: 1_000_005,
    closingAt: null,
    extensions: "none",
    run: {
      running: false,
      streaming: false,
      promptRunning: false,
      pendingPrompts: 0,
      bashRunning: false,
      compacting: false,
      retrying: false,
      queuedMessages: 0,
      waitingForMcp: false,
      runningTools: 0,
      mutatingCommands: 0,
      replacement: null,
    },
    idle: {
      timeoutMs: SESSION_IDLE_TIMEOUT_MS,
      nextCheckAt: 1_000_005 + SESSION_IDLE_TIMEOUT_MS,
      lastResetAt: 1_000_005,
      forcedByStop: false,
    },
    awaitingInput: false,
    pendingUiRequests: 0,
    customUis: 0,
    eventListeners: 0,
    lastEvent: null,
    lastCommand: null,
  });
});

test("a run's own prompt reads as promptRunning, and only a prompt call beyond it as pending", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_500_000 });
  const calls = [];
  const inner = makeIdleInner({
    sessionManager: { getCwd: () => process.cwd(), getSessionName: () => undefined, getEntries: () => [] },
    prompt: (_message, options) => new Promise((resolve) => {
      if (calls.length === 0) {
        // The first prompt starts a run that streams until it is finished.
        inner.isStreaming = true;
        options.preflightResult("started");
        calls.push(() => {
          inner.isStreaming = false;
          resolve();
        });
      } else {
        // A second one held before pi decides (an input handler, say), then queued.
        calls.push(() => {
          options.preflightResult("queued");
          resolve();
        });
      }
    }),
  });
  const wrapper = new AgentSessionWrapper(inner);
  t.after(() => wrapper.destroy());
  wrapper.start();
  const run = () => {
    const { running, streaming, promptRunning, pendingPrompts } = wrapper.getDebugSnapshot().run;
    return { running, streaming, promptRunning, pendingPrompts };
  };

  await wrapper.send({ type: "prompt", message: "hello" });
  assert.deepEqual(run(), { running: true, streaming: true, promptRunning: true, pendingPrompts: 0 });

  const second = wrapper.send({ type: "prompt", message: "next", streamingBehavior: "followUp" });
  await nextTurn();
  assert.equal(calls.length, 2);
  assert.deepEqual(run(), { running: true, streaming: true, promptRunning: true, pendingPrompts: 1 });

  calls[1]();
  await second;
  await nextTurn();
  assert.deepEqual(run(), { running: true, streaming: true, promptRunning: true, pendingPrompts: 0 });

  calls[0]();
  await nextTurn();
  assert.deepEqual(run(), { running: false, streaming: false, promptRunning: false, pendingPrompts: 0 });
});

test("reading the snapshot never moves the idle deadline: the wrapper closes when the first timer said", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 2_000_000 });
  const wrapper = new AgentSessionWrapper(makeIdleInner());
  t.after(() => wrapper.destroy());
  wrapper.start();
  const armed = wrapper.getDebugSnapshot().idle;

  t.mock.timers.tick(SESSION_IDLE_TIMEOUT_MS - 1);
  for (let read = 0; read < 5; read += 1) wrapper.getDebugSnapshot();
  assert.deepEqual(wrapper.getDebugSnapshot().idle, armed);
  await nextTurn();
  assert.equal(wrapper.isAlive(), true);

  t.mock.timers.tick(1);
  await nextTurn();
  assert.equal(wrapper.isAlive(), false);
  const closed = wrapper.getDebugSnapshot();
  assert.equal(closed.state, "closing");
  assert.equal(closed.closingAt, 2_000_000 + SESSION_IDLE_TIMEOUT_MS);
  assert.equal(closed.idle.nextCheckAt, null, "a timer that fired is not armed");
});

test("the deadline follows the idle check a liveness provider re-arms", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 3_000_000 });
  let active = true;
  t.after(registerSessionLivenessProvider({ name: "debug-test", sessionId: "debug-idle", isActive: () => active }));
  const wrapper = new AgentSessionWrapper(makeIdleInner({ sessionId: "debug-idle" }));
  t.after(() => wrapper.destroy());
  wrapper.start();

  t.mock.timers.tick(SESSION_IDLE_TIMEOUT_MS);
  await nextTurn();
  assert.deepEqual(wrapper.getDebugSnapshot().idle, {
    timeoutMs: SESSION_IDLE_TIMEOUT_MS,
    nextCheckAt: 3_000_000 + 2 * SESSION_IDLE_TIMEOUT_MS,
    lastResetAt: 3_000_000 + SESSION_IDLE_TIMEOUT_MS,
    forcedByStop: false,
  });

  active = false;
  t.mock.timers.tick(SESSION_IDLE_TIMEOUT_MS);
  await nextTurn();
  assert.equal(wrapper.isAlive(), false);
  assert.equal(wrapper.getDebugSnapshot().idle.nextCheckAt, null);
});

test("Stop's forced deadline reads forced, and neither a snapshot nor Stop again moves it", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 4_000_000 });
  // A handler that ignores the abort signal keeps the SDK run pending forever.
  const wrapper = new AgentSessionWrapper(makeIdleInner({ isStreaming: true, abort: () => new Promise(() => {}) }));
  t.after(() => wrapper.destroy());
  wrapper.start();

  void wrapper.send({ type: "abort" });
  await nextTurn();
  const forced = wrapper.getDebugSnapshot().idle;
  assert.deepEqual(forced, {
    timeoutMs: SESSION_IDLE_TIMEOUT_MS,
    nextCheckAt: 4_000_000 + SESSION_IDLE_TIMEOUT_MS,
    lastResetAt: 4_000_000,
    forcedByStop: true,
  });

  t.mock.timers.tick(SESSION_IDLE_TIMEOUT_MS - 60_000);
  wrapper.getDebugSnapshot();
  void wrapper.send({ type: "abort" });
  await nextTurn();
  const again = wrapper.getDebugSnapshot();
  assert.deepEqual(again.idle, forced, "the forced early return stamps nothing");
  assert.deepEqual(again.lastCommand, { type: "abort", at: 4_000_000 + SESSION_IDLE_TIMEOUT_MS - 60_000 });

  t.mock.timers.tick(60_000);
  await nextTurn();
  assert.equal(wrapper.isAlive(), false);
  assert.equal(wrapper.getDebugSnapshot().idle.nextCheckAt, null);
});

test("PI_WEB_IDLE_TIMEOUT_MS=0: no deadline, and the reset that found it disabled is stamped", async (t) => {
  const previousValue = process.env.PI_WEB_IDLE_TIMEOUT_MS;
  process.env.PI_WEB_IDLE_TIMEOUT_MS = "0";
  t.after(() => {
    if (previousValue === undefined) delete process.env.PI_WEB_IDLE_TIMEOUT_MS;
    else process.env.PI_WEB_IDLE_TIMEOUT_MS = previousValue;
  });
  const fresh = await createJiti(import.meta.url, { interopDefault: true, moduleCache: false }).import("./rpc-manager.ts");
  assert.equal(fresh.SESSION_IDLE_TIMEOUT_MS, 0);
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 5_000_000 });
  const wrapper = new fresh.AgentSessionWrapper(makeIdleInner());
  t.after(() => wrapper.destroy());
  wrapper.start();
  assert.deepEqual(wrapper.getDebugSnapshot().idle, { timeoutMs: 0, nextCheckAt: null, lastResetAt: 5_000_000, forcedByStop: false });
});

test("destroy() clears the deadline and records when closing started", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 6_000_000 });
  const wrapper = new AgentSessionWrapper(makeIdleInner());
  wrapper.start();
  t.mock.timers.tick(1_000);
  wrapper.destroy();
  const snapshot = wrapper.getDebugSnapshot();
  assert.equal(snapshot.state, "closing");
  assert.equal(snapshot.closingAt, 6_001_000);
  assert.equal(snapshot.idle.nextCheckAt, null);
});

test("the last event and command are their types only", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 7_000_000 });
  let emitEvent = () => {};
  const wrapper = new AgentSessionWrapper(makeIdleInner({
    subscribe: (listener) => {
      emitEvent = listener;
      return () => {};
    },
    getLastAssistantText: () => "secret reply",
  }));
  t.after(() => wrapper.destroy());
  wrapper.start();
  t.mock.timers.tick(10);
  emitEvent({ type: "message_update", message: { role: "assistant", content: [{ type: "text", text: "secret reply" }] } });
  t.mock.timers.tick(10);
  assert.deepEqual(await wrapper.send({ type: "get_last_assistant_text" }), { text: "secret reply" });
  t.mock.timers.tick(10);
  // A status read is not a command that did something. (The fake has no state to read; only
  // what send() records before reading matters here.)
  await wrapper.send({ type: "get_state" }).catch(() => {});

  const snapshot = wrapper.getDebugSnapshot();
  assert.deepEqual(snapshot.lastEvent, { type: "message_update", at: 7_000_010 });
  assert.deepEqual(snapshot.lastCommand, { type: "get_last_assistant_text", at: 7_000_020 });
  assert.doesNotMatch(JSON.stringify(snapshot), /secret/);
});

test("the MCP snapshot comes from the host, when it has one that can say", (t) => {
  const host = { prepareForPrompt: async () => true, dispose() {} };
  const state = { active: true, disposed: false, runActive: false, idleMs: 0, idleReleaseAt: null, servers: [], problems: 0 };
  const withSnapshot = new AgentSessionWrapper(makeIdleInner(), { mcpHost: { ...host, debugSnapshot: () => state } });
  const preReload = new AgentSessionWrapper(makeIdleInner(), { mcpHost: host });
  const none = new AgentSessionWrapper(makeIdleInner());
  t.after(() => [withSnapshot, preReload, none].forEach((wrapper) => wrapper.destroy()));
  assert.equal(withSnapshot.getMcpDebugSnapshot(), state);
  assert.equal(preReload.getMcpDebugSnapshot(), null);
  assert.equal(none.getMcpDebugSnapshot(), null);
});

function swapGlobal(t, name, value) {
  const previous = globalThis[name];
  globalThis[name] = value;
  t.after(() => { globalThis[name] = previous; });
}

test("lists every registered wrapper, a pre-reload or failing one as stale with every field filled", (t) => {
  const live = new AgentSessionWrapper(makeIdleInner({ sessionId: "debug-live", sessionFile: "/tmp/debug-live.jsonl" }));
  t.after(() => live.destroy());
  swapGlobal(t, "__piSessions", new Map([
    ["debug-live", live],
    ["debug-stale", { isAlive: () => true, isRunning: () => true }],
    ["debug-throws", { getDebugSnapshot() { throw new Error("broken"); }, isAlive: () => false }],
  ]));

  const [liveEntry, staleEntry, throwsEntry] = getRpcSessionDebugSnapshots();
  assert.equal(liveEntry.snapshot.sessionId, "debug-live");
  assert.equal(liveEntry.snapshot.stale, false);
  assert.equal(liveEntry.sessionFile, "/tmp/debug-live.jsonl");

  assert.equal(staleEntry.snapshot.sessionId, "debug-stale");
  assert.equal(staleEntry.snapshot.stale, true);
  assert.equal(staleEntry.snapshot.state, "alive");
  assert.equal(staleEntry.snapshot.run.running, true);
  assert.equal(staleEntry.sessionFile, null);
  assert.equal(staleEntry.readMcp(), null);
  // Same shape as a current wrapper's, so the panel needs no special case.
  const keys = (snapshot) => [Object.keys(snapshot), Object.keys(snapshot.run), Object.keys(snapshot.idle)];
  assert.deepEqual(keys(staleEntry.snapshot), keys(liveEntry.snapshot));

  assert.equal(throwsEntry.snapshot.sessionId, "debug-throws");
  assert.equal(throwsEntry.snapshot.stale, true);
  assert.equal(throwsEntry.snapshot.state, "closing");

  swapGlobal(t, "__piSessions", undefined);
  assert.deepEqual(getRpcSessionDebugSnapshots(), []);
});

test("a start counts as starting until its wrapper is alive; a temporary key, until pi's id has one", (t) => {
  const pending = Promise.resolve();
  swapGlobal(t, "__piSessions", new Map([
    ["debug-registered", { isAlive: () => true }],
    ["debug-closing", { isAlive: () => false }],
    ["debug-new-real", { isAlive: () => true }],
  ]));
  swapGlobal(t, "__piStartLocks", new Map([
    ["__new__abc", pending],
    ["__new__switching", pending],
    ["__recreate__closing", pending],
    ["debug-registered", pending],
    ["debug-closing", pending],
    ["debug-cold", pending],
  ]));
  // Registered under pi's id while a deferred model is switched to: alive, not starting.
  swapGlobal(t, "__piStartRegisteredIds", new Map([
    ["__new__switching", "debug-new-real"],
    ["__recreate__closing", "debug-closing"],
  ]));
  assert.deepEqual(getRpcStartingSessionIds(), ["__new__abc", "__recreate__closing", "debug-closing", "debug-cold"]);
  swapGlobal(t, "__piStartRegisteredIds", undefined);
  assert.deepEqual(
    getRpcStartingSessionIds(),
    ["__new__abc", "__new__switching", "__recreate__closing", "debug-closing", "debug-cold"],
    "without the map (a server from before a hot reload), every temporary key is starting",
  );
  swapGlobal(t, "__piStartLocks", undefined);
  assert.deepEqual(getRpcStartingSessionIds(), []);
});

test("startRpcSession maps a temporary key to pi's id once registered, and forgets it with the lock", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-debug-cwd-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const writes = [];
  class RecordingMap extends Map {
    set(key, value) {
      writes.push(["set", key, value, globalThis.__piSessions?.get(value)?.isAlive() === true]);
      return super.set(key, value);
    }
    delete(key) {
      writes.push(["delete", key]);
      return super.delete(key);
    }
  }
  const registered = new RecordingMap();
  swapGlobal(t, "__piStartRegisteredIds", registered);
  const key = "__new__debug-map";
  const starting = startRpcSession(key, "", cwd, { toolNames: [] });
  assert.ok(getRpcStartingSessionIds().includes(key), "starting before the wrapper exists");
  const { session, realSessionId } = await starting;
  t.after(() => session.destroy());
  assert.notEqual(realSessionId, key);
  assert.deepEqual(writes, [["set", key, realSessionId, true], ["delete", key]]);
  assert.equal(registered.size, 0);
  assert.ok(!getRpcStartingSessionIds().includes(key));
});

test("a start whose id map throws still starts", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-debug-cwd-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  class BrokenMap extends Map {
    set() { throw new Error("map broken"); }
    delete() { throw new Error("map broken"); }
  }
  swapGlobal(t, "__piStartRegisteredIds", new BrokenMap());
  const key = "__new__debug-broken";
  const { session, realSessionId } = await startRpcSession(key, "", cwd, { toolNames: [] });
  t.after(() => session.destroy());
  assert.equal(session.isAlive(), true);
  assert.equal(globalThis.__piSessions.get(realSessionId), session);
  assert.equal(globalThis.__piStartLocks.has(key), false, "the lock is released all the same");
});

/** Starts a real, registered Chat-only wrapper for a persisted session file. */
async function startPersistedSession(t) {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-debug-cwd-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const manager = SessionManager.create(cwd);
  manager.appendMessage({ role: "user", content: "persisted before the wrapper starts", timestamp: Date.now() });
  const sessionId = manager.getSessionId();
  const sessionFile = manager.getSessionFile();
  assert.ok(sessionFile && existsSync(sessionFile));
  const { session } = await startRpcSession(sessionId, sessionFile, undefined, { toolNames: [] });
  t.after(() => session.destroy());
  return { sessionId, sessionFile, session };
}

test("the lifecycle counts a rebuild after a close and keeps the first start and the close", async (t) => {
  const { sessionId, sessionFile, session } = await startPersistedSession(t);
  const first = getRpcSessionLifecycle(sessionId);
  assert.equal(first.starts, 1);
  assert.equal(first.firstStartedAt, first.lastStartedAt);
  assert.equal(first.lastClosedAt, null);

  await session.shutdown();
  const closed = getRpcSessionLifecycle(sessionId);
  assert.equal(typeof closed.lastClosedAt, "number");

  const { session: rebuilt } = await startRpcSession(sessionId, sessionFile, undefined);
  t.after(() => rebuilt.destroy());
  const second = getRpcSessionLifecycle(sessionId);
  assert.equal(second.starts, 2);
  assert.equal(second.firstStartedAt, first.firstStartedAt);
  assert.ok(second.lastStartedAt >= closed.lastClosedAt);
  assert.equal(second.lastClosedAt, closed.lastClosedAt);
  assert.equal(getRpcSessionLifecycle("debug-never-started"), null);
});

test("a wrapper replaced while it closes is listed as closing, then records its close", async (t) => {
  t.mock.method(console, "warn", () => {});
  const { sessionId, sessionFile, session: closing } = await startPersistedSession(t);
  // Hold session_shutdown open, and let the replacement start before the closing wrapper is disposed.
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  let signalStarted;
  const started = new Promise((resolve) => { signalStarted = resolve; });
  closing.inner.extensionRunner.emit = async () => {
    signalStarted();
    await held;
  };
  closing.waitUntilDisposed = async () => false;
  t.after(() => release());

  const shuttingDown = closing.shutdown();
  await started;
  const listed = getRpcSessionDebugSnapshots().find((entry) => entry.snapshot.sessionId === sessionId);
  assert.equal(listed?.snapshot.state, "closing");
  assert.equal(typeof listed?.snapshot.closingAt, "number");

  // The replacement swaps the closing wrapper's onDestroy for a no-op.
  const { session: replacement } = await startRpcSession(sessionId, sessionFile, undefined);
  t.after(() => replacement.destroy());
  assert.equal(getRpcSessionLifecycle(sessionId).starts, 2);
  assert.equal(getRpcSessionLifecycle(sessionId).lastClosedAt, null);

  release();
  await shuttingDown;
  assert.equal(typeof getRpcSessionLifecycle(sessionId).lastClosedAt, "number");
});

test("the lifecycle history keeps 1000 ids, dropping the oldest without a wrapper", async (t) => {
  const key = Symbol.for("pi-web:session-lifecycle");
  const previous = globalThis[key];
  t.after(() => { globalThis[key] = previous; });
  const history = new Map();
  for (let index = 0; index < 1000; index += 1) {
    history.set(`debug-old-${index}`, { starts: 1, firstStartedAt: 1, lastStartedAt: 1, lastClosedAt: 2 });
  }
  globalThis[key] = history;
  // The oldest id still has a wrapper (a long-lived session), so the next one goes instead.
  const registry = globalThis.__piSessions ?? new Map();
  globalThis.__piSessions = registry;
  registry.set("debug-old-0", { isAlive: () => true, isRunning: () => false, destroy() {}, shutdown: async () => {} });
  t.after(() => registry.delete("debug-old-0"));

  const { sessionId } = await startPersistedSession(t);
  assert.equal(history.size, 1000);
  assert.ok(history.has("debug-old-0"));
  assert.ok(!history.has("debug-old-1"));
  assert.ok(history.has("debug-old-2"));
  assert.equal(history.get(sessionId)?.starts, 1);
  assert.equal([...history.keys()].at(-1), sessionId, "a start moves its id to the newest end");
});
