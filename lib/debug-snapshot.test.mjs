import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";

// Nothing here starts an SDK session; the agent dir is kept out of ~/.pi all the same.
const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const testAgentDir = await mkdtemp(join(tmpdir(), "pi-web-debug-snapshot-agent-"));
process.env.PI_CODING_AGENT_DIR = testAgentDir;
after(async () => {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  await rm(testAgentDir, { recursive: true, force: true });
});

const jiti = createJiti(import.meta.url, { interopDefault: true });
const { buildDebugSnapshot } = await jiti.import("./debug-snapshot.ts");
const { createAgentEventStream } = await jiti.import("./agent-event-stream.ts");
const { AgentSessionWrapper, SESSION_IDLE_TIMEOUT_MS } = await jiti.import("./rpc-manager.ts");
const { registerSessionLivenessProvider } = await jiti.import("./session-liveness.ts");
const { AGENT_EVENT_HEARTBEAT_MS } = await jiti.import("./agent-event-wire.ts");

const NOW = 10_000_000;
const SESSION_FILE = "/private/path/debug-a.jsonl";

function makeInner(sessionId, overrides = {}) {
  return {
    sessionId,
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

function swapGlobal(t, key, value) {
  const previous = globalThis[key];
  globalThis[key] = value;
  t.after(() => { globalThis[key] = previous; });
}

/** An event stream for `sessionId`, connected to a fake session unless `connect` is false. */
function openStream(t, sessionId, holder, { connect = true } = {}) {
  const abortController = new AbortController();
  const stream = createAgentEventStream(
    new Request("http://localhost/events", { signal: abortController.signal }),
    sessionId,
    connect
      ? Promise.resolve({ isStreaming: false, streamingMessage: undefined, onEvent: () => () => {} })
      : new Promise(() => {}),
    holder === undefined ? undefined : { holder },
  );
  const reader = stream.getReader();
  t.after(() => abortController.abort());
  return reader;
}

/**
 * Two live wrappers (one a subagent's), one from before a hot reload, extension providers, event
 * streams, a start under way, a subagent run, a terminal and two file watches.
 */
async function serverWithState(t) {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: NOW });
  const mcpState = { active: true, disposed: false, runActive: false, idleMs: 300_000, idleReleaseAt: null, servers: [], problems: 0 };
  const mcp = { state: mcpState };
  const wrapperA = new AgentSessionWrapper(makeInner("debug-a", { sessionFile: SESSION_FILE }), {
    mcpHost: { prepareForPrompt: async () => true, dispose() {}, debugSnapshot: () => mcp.state() },
  });
  mcp.state = () => mcpState;
  const wrapperSub = new AgentSessionWrapper(makeInner("debug-sub"), { suppressCompletionNotifications: true });
  t.after(() => { wrapperA.destroy(); wrapperSub.destroy(); });
  wrapperA.start();
  wrapperSub.start();
  swapGlobal(t, "__piSessions", new Map([
    ["debug-a", wrapperA],
    ["debug-sub", wrapperSub],
    ["debug-stale", { isAlive: () => false, isRunning: () => false }],
  ]));
  const pending = Promise.resolve();
  swapGlobal(t, "__piStartLocks", new Map([["__new__debug", pending], ["debug-a", pending]]));
  // `__new__debug` has registered no wrapper yet.
  swapGlobal(t, "__piStartRegisteredIds", undefined);
  swapGlobal(t, "__piSubagentRuns", new Map([["debug-child", {
    run: {
      sessionId: "debug-child",
      parentSessionId: "debug-a",
      status: "running",
      profile: "worker",
      runInBackground: true,
      task: "THE CHILD'S TASK",
    },
    completion: new Promise(() => {}),
    abortRequested: false,
    dispatchedAt: NOW - 1_000,
  }]]));
  swapGlobal(t, "__piSubagentParentNotifications", new Set());
  swapGlobal(t, "__piWebTerminals", new Map([["terminal-1", { listeners: new Set([() => {}]), exited: false, cleanupAt: null }]]));
  swapGlobal(t, Symbol.for("pi-web:file-watch-streams"), new Set([{}, {}]));

  const asked = [];
  const provider = (name, sessionId, isActive, sessionFile) => t.after(registerSessionLivenessProvider({
    name,
    sessionId,
    ...(sessionFile ? { sessionFile } : {}),
    isActive: () => {
      asked.push(name);
      return isActive();
    },
  }));
  provider("by-id", "debug-a", () => true);
  provider("by-file", "debug-a-alias", () => false, SESSION_FILE);
  provider("sub-throws", "debug-sub", () => { throw new Error("probe failed"); });

  const connectedReader = openStream(t, "debug-a", "page-1");
  await connectedReader.read();
  await connectedReader.read();
  openStream(t, "debug-stream-only", undefined, { connect: false });
  // A subagent's stream, its wrapper already closed.
  openStream(t, "debug-child", "page-3", { connect: false });
  return { asked, mcp };
}

test("the global layer and one summary per session with a wrapper or a stream", async (t) => {
  const { asked } = await serverWithState(t);
  const snapshot = buildDebugSnapshot(null, NOW);

  assert.equal(snapshot.now, NOW);
  assert.equal(snapshot.session, null);
  assert.ok(snapshot.server.startedAt <= NOW && snapshot.server.startedAt > NOW - (process.uptime() + 60) * 1000);
  assert.deepEqual({ ...snapshot.server, startedAt: 0 }, {
    startedAt: 0,
    idleTimeoutMs: SESSION_IDLE_TIMEOUT_MS,
    heartbeatMs: AGENT_EVENT_HEARTBEAT_MS,
    // debug-a's start lock is held while its wrapper is already alive: not starting.
    wrappers: { alive: 2, closing: 1, starting: 1 },
    eventStreams: { total: 3, byHolder: [{ holder: "page-1", count: 1 }, { holder: null, count: 1 }, { holder: "page-3", count: 1 }] },
    fileWatches: 2,
    terminals: { count: 1, listeners: 1, detached: 0, exited: 0, nextCleanupAt: null },
  });

  const summaries = new Map(snapshot.sessions.map((summary) => [summary.sessionId, summary]));
  assert.deepEqual([...summaries.keys()], ["debug-a", "debug-sub", "debug-stale", "debug-stream-only", "debug-child"]);
  assert.deepEqual(summaries.get("debug-a"), {
    sessionId: "debug-a",
    state: "alive",
    running: false,
    awaitingInput: false,
    subagent: false,
    eventStreams: 1,
    // One registered by id, one by the wrapper's session file.
    providers: 2,
    nextIdleCheckAt: NOW + SESSION_IDLE_TIMEOUT_MS,
    forcedByStop: false,
    starts: 0,
  });
  assert.equal(summaries.get("debug-sub").subagent, true);
  assert.equal(summaries.get("debug-sub").providers, 1);
  assert.equal(summaries.get("debug-stale").state, "closing");
  // No wrapper of its own: the run map says it is a subagent.
  assert.equal(summaries.get("debug-child").subagent, true);
  assert.equal(summaries.get("debug-stream-only").state, "none");
  assert.equal(summaries.get("debug-stream-only").eventStreams, 1);

  assert.deepEqual(asked, [], "a summary asks no extension provider");
  assert.doesNotMatch(JSON.stringify(snapshot), /private\/path|THE CHILD'S TASK/);
});

test("a fresh composer's start whose wrapper is registered under pi's id counts once, as alive", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: NOW });
  const wrapper = new AgentSessionWrapper(makeInner("debug-new-real"));
  t.after(() => wrapper.destroy());
  wrapper.start();
  swapGlobal(t, "__piSessions", new Map([["debug-new-real", wrapper]]));
  // The `__new__` lock is held while the start switches to an extension's model.
  swapGlobal(t, "__piStartLocks", new Map([["__new__debug", Promise.resolve()]]));
  swapGlobal(t, "__piStartRegisteredIds", new Map([["__new__debug", "debug-new-real"]]));

  const snapshot = buildDebugSnapshot("debug-new-real", NOW);
  assert.deepEqual(snapshot.server.wrappers, { alive: 1, closing: 0, starting: 0 });
  assert.equal(snapshot.session.starting, false);
  assert.equal(snapshot.session.wrapper.state, "alive");

  // Before the start registers its wrapper, the same lock is the one start under way.
  swapGlobal(t, "__piStartRegisteredIds", new Map());
  swapGlobal(t, "__piSessions", new Map());
  assert.deepEqual(buildDebugSnapshot(null, NOW).server.wrappers, { alive: 0, closing: 0, starting: 1 });
});

test("the selected session's detail: its wrapper, providers asked, streams, subagents and MCP", async (t) => {
  const { asked } = await serverWithState(t);
  const { session } = buildDebugSnapshot("debug-a", NOW);

  assert.equal(session.sessionId, "debug-a");
  assert.equal(session.wrapper.sessionId, "debug-a");
  assert.equal(session.wrapper.idle.nextCheckAt, NOW + SESSION_IDLE_TIMEOUT_MS);
  assert.equal(session.lifecycle, null, "never started through the registry");
  assert.equal(session.starting, false);
  assert.equal("leases" in session, false, "pi-web keeps no leases to list");
  assert.deepEqual(session.providers, [
    { name: "by-id", active: true, byFile: false },
    { name: "by-file", active: false, byFile: true },
  ]);
  assert.deepEqual(asked, ["by-id", "by-file"], "only this session's providers are asked");
  assert.deepEqual(session.eventStreams, [
    { holder: "page-1", openedAt: NOW, connectedAt: NOW, lastWriteAt: NOW, droppedEvents: 0, queuedBytes: 0 },
  ]);
  assert.deepEqual(session.subagents, {
    active: true,
    runs: [{
      sessionId: "debug-child",
      parentSessionId: "debug-a",
      status: "running",
      profile: "worker",
      background: true,
      resumed: false,
      dispatchedAt: NOW - 1_000,
      abortRequested: false,
      mcpWaiting: false,
    }],
    notifications: [],
  });
  assert.deepEqual(session.mcp, { active: true, disposed: false, runActive: false, idleMs: 300_000, idleReleaseAt: null, servers: [], problems: 0 });
});

test("a session the server holds nothing for gets an empty detail", async (t) => {
  await serverWithState(t);
  const snapshot = buildDebugSnapshot("debug-unknown", NOW);
  assert.deepEqual(snapshot.session, {
    sessionId: "debug-unknown",
    wrapper: null,
    lifecycle: null,
    starting: false,
    providers: [],
    eventStreams: [],
    subagents: { active: false, runs: [], notifications: [] },
    mcp: null,
  });
  assert.ok(!snapshot.sessions.some((summary) => summary.sessionId === "debug-unknown"));
});

test("a source that throws reads as empty and the rest still answers", async (t) => {
  const { mcp } = await serverWithState(t);
  mcp.state = () => { throw new Error("host broken"); };
  swapGlobal(t, "__piWebTerminals", new Map([["terminal-1", { get listeners() { throw new Error("record broken"); } }]]));
  swapGlobal(t, "__piSubagentRuns", new Map([["debug-broken", { run: null }]]));

  const snapshot = buildDebugSnapshot("debug-a", NOW);
  assert.deepEqual(snapshot.server.terminals, { count: 0, listeners: 0, detached: 0, exited: 0, nextCleanupAt: null });
  assert.equal(snapshot.session.mcp, null);
  assert.deepEqual(snapshot.session.subagents, { active: false, runs: [], notifications: [] });
  assert.equal(snapshot.session.wrapper.sessionId, "debug-a");
  assert.equal(snapshot.server.wrappers.alive, 2);
  assert.equal(snapshot.sessions.length, 5);
});
