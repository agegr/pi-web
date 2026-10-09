import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

// startRpcSession() builds real SDK sessions here; keep them out of ~/.pi.
const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const testAgentDir = await mkdtemp(join(tmpdir(), "pi-web-lifecycle-agent-"));
process.env.PI_CODING_AGENT_DIR = testAgentDir;

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const {
  AgentSessionWrapper,
  getRpcSession,
  resolveSessionShutdownDeadlineMs,
  setRpcSessionTools,
  startRpcSession,
} = await jiti.import("./rpc-manager.ts");

after(async () => {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  await rm(testAgentDir, { recursive: true, force: true });
});

const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

/** An SDK session whose session_shutdown handlers wait until the test releases them, or forever with `hang`. */
function makeClosingInner(calls, { hang = false } = {}) {
  let release = () => {};
  const held = hang
    ? new Promise(() => {})
    : new Promise((resolve) => { release = resolve; });
  return {
    inner: {
      sessionId: "closing-session",
      isBashRunning: false,
      isStreaming: false,
      isCompacting: false,
      extensionRunner: {
        emit(event) {
          calls.push(["emit", event.type]);
          return held;
        },
      },
      dispose() {
        calls.push(["dispose"]);
      },
    },
    release: () => release(),
  };
}

test("defaults the shutdown deadline to 5 seconds when the env var is unset or blank", () => {
  assert.equal(resolveSessionShutdownDeadlineMs(), 5_000);
  assert.equal(resolveSessionShutdownDeadlineMs(""), 5_000);
  assert.equal(resolveSessionShutdownDeadlineMs("   "), 5_000);
});

test("uses a positive shutdown deadline in milliseconds", () => {
  assert.equal(resolveSessionShutdownDeadlineMs("250"), 250);
  assert.equal(resolveSessionShutdownDeadlineMs("2147483647"), 2_147_483_647);
});

test("falls back to the 5-second deadline and warns for zero, invalid or out-of-range values", (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  // Zero would mean "dispose without telling extensions"; shutdown always has a deadline.
  assert.equal(resolveSessionShutdownDeadlineMs("0"), 5_000);
  assert.equal(resolveSessionShutdownDeadlineMs("abc"), 5_000);
  assert.equal(resolveSessionShutdownDeadlineMs("-5"), 5_000);
  assert.equal(resolveSessionShutdownDeadlineMs("NaN"), 5_000);
  assert.equal(resolveSessionShutdownDeadlineMs("Infinity"), 5_000);
  assert.equal(resolveSessionShutdownDeadlineMs("2147483648"), 5_000);
  assert.equal(warn.mock.callCount(), 6);
});

test("a wrapper reports itself dead as soon as shutdown starts", async () => {
  const calls = [];
  const { inner, release } = makeClosingInner(calls);
  const wrapper = new AgentSessionWrapper(inner);
  wrapper.onDestroy(() => calls.push(["unregister"]));

  const shutting = wrapper.shutdown();
  assert.equal(wrapper.isAlive(), false);
  // A second caller (project trust, a deleted session) joins the same shutdown.
  const joined = wrapper.shutdown();

  await nextTurn();
  // Extensions are still handling session_shutdown; nothing is disposed yet.
  assert.deepEqual(calls, [["emit", "session_shutdown"]]);
  assert.equal(wrapper.isAlive(), false);
  assert.equal(wrapper.evictIfDiskAhead(), false);

  release();
  await Promise.all([shutting, joined]);
  assert.deepEqual(calls, [["emit", "session_shutdown"], ["dispose"], ["unregister"]]);
  assert.equal(wrapper.isAlive(), false);
});

test("shutdown disposes the session once the deadline passes even if session_shutdown never settles", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const warn = t.mock.method(console, "warn", () => {});
  const calls = [];
  const { inner } = makeClosingInner(calls, { hang: true });
  const wrapper = new AgentSessionWrapper(inner);
  wrapper.onDestroy(() => calls.push(["unregister"]));

  let settled = false;
  const shutting = wrapper.shutdown().then(() => { settled = true; });
  await nextTurn();
  t.mock.timers.tick(4_999);
  await nextTurn();
  assert.equal(settled, false);
  assert.deepEqual(calls, [["emit", "session_shutdown"]]);

  t.mock.timers.tick(1);
  await shutting;
  assert.deepEqual(calls, [["emit", "session_shutdown"], ["dispose"], ["unregister"]]);
  assert.equal(warn.mock.callCount(), 1);
  assert.match(
    warn.mock.calls[0].arguments[0],
    /did not finish session_shutdown for session closing-session within 5000 ms/,
  );
});

test("direct destruction also disposes the session at the deadline", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const warn = t.mock.method(console, "warn", () => {});
  const calls = [];
  const { inner } = makeClosingInner(calls, { hang: true });
  const wrapper = new AgentSessionWrapper(inner);
  wrapper.onDestroy(() => calls.push(["unregister"]));

  wrapper.destroy();
  assert.equal(wrapper.isAlive(), false);
  await nextTurn();
  assert.deepEqual(calls, [["emit", "session_shutdown"]]);

  t.mock.timers.tick(5_000);
  await nextTurn();
  assert.deepEqual(calls, [["emit", "session_shutdown"], ["dispose"], ["unregister"]]);
  assert.equal(warn.mock.callCount(), 1);
});

test("a session_shutdown failure after the deadline is not an unhandled rejection", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(console, "warn", () => {});
  let failLate;
  const calls = [];
  const wrapper = new AgentSessionWrapper({
    sessionId: "late-failure",
    isBashRunning: false,
    extensionRunner: {
      emit: () => new Promise((_resolve, reject) => { failLate = reject; }),
    },
    dispose() {
      calls.push("dispose");
    },
  });
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  t.after(() => process.off("unhandledRejection", onUnhandled));

  const shutting = wrapper.shutdown();
  await nextTurn();
  t.mock.timers.tick(5_000);
  await shutting;
  assert.deepEqual(calls, ["dispose"]);

  failLate(new Error("closed after the deadline"));
  await nextTurn();
  assert.deepEqual(unhandled, []);
});

test("the shutdown deadline timer does not keep the process alive", async (t) => {
  const realSetTimeout = globalThis.setTimeout;
  const deadlineTimers = [];
  t.mock.method(globalThis, "setTimeout", (callback, delay, ...args) => {
    const timer = realSetTimeout(callback, delay, ...args);
    if (delay === 5_000) deadlineTimers.push(timer);
    return timer;
  });
  const calls = [];
  const { inner, release } = makeClosingInner(calls);
  const wrapper = new AgentSessionWrapper(inner);

  const shutting = wrapper.shutdown();
  await nextTurn();
  assert.equal(deadlineTimers.length, 1);
  assert.equal(deadlineTimers[0].hasRef(), false);

  release();
  await shutting;
  assert.deepEqual(calls, [["emit", "session_shutdown"], ["dispose"]]);
});

test("PI_WEB_SHUTDOWN_DEADLINE_MS sets the deadline", async (t) => {
  const previousValue = process.env.PI_WEB_SHUTDOWN_DEADLINE_MS;
  process.env.PI_WEB_SHUTDOWN_DEADLINE_MS = "250";
  try {
    const freshJiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
    const { AgentSessionWrapper: FreshWrapper } = await freshJiti.import("./rpc-manager.ts");

    t.mock.timers.enable({ apis: ["setTimeout"] });
    t.mock.method(console, "warn", () => {});
    const calls = [];
    const { inner } = makeClosingInner(calls, { hang: true });
    const wrapper = new FreshWrapper(inner);

    const shutting = wrapper.shutdown();
    await nextTurn();
    t.mock.timers.tick(249);
    await nextTurn();
    assert.deepEqual(calls, [["emit", "session_shutdown"]]);

    t.mock.timers.tick(1);
    await shutting;
    assert.deepEqual(calls, [["emit", "session_shutdown"], ["dispose"]]);
  } finally {
    if (previousValue === undefined) delete process.env.PI_WEB_SHUTDOWN_DEADLINE_MS;
    else process.env.PI_WEB_SHUTDOWN_DEADLINE_MS = previousValue;
  }
});

// A real SDK session is too large for assert's diff: compare wrappers by identity.
function assertRegistered(sessionId, expected, message) {
  assert.ok(getRpcSession(sessionId) === expected, message);
}

/** Starts a real, registered wrapper for a persisted session file. */
async function startPersistedSession(t) {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-lifecycle-cwd-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const manager = SessionManager.create(cwd);
  manager.appendMessage({ role: "user", content: "persisted before the wrapper starts", timestamp: Date.now() });
  const sessionId = manager.getSessionId();
  const sessionFile = manager.getSessionFile();
  assert.ok(sessionFile && existsSync(sessionFile));

  // Chat only keeps the real SDK session free of extensions and skills.
  const { session } = await startRpcSession(sessionId, sessionFile, undefined, { toolNames: [] });
  t.after(() => session.destroy());
  assertRegistered(sessionId, session, "the started wrapper is registered");
  return { sessionId, sessionFile, session };
}

/**
 * Lets a replacement start while `wrapper` is still closing, as it does once the bounded
 * wait for a shutdown stuck in extension binding runs out.
 */
function skipClosingWait(wrapper) {
  wrapper.waitUntilDisposed = async () => false;
}

/** Holds session_shutdown open, as an MCP server that never finishes closing does. */
function holdSessionShutdown(wrapper) {
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  let signalStarted;
  const started = new Promise((resolve) => { signalStarted = resolve; });
  wrapper.inner.extensionRunner.emit = async () => {
    signalStarted();
    await held;
  };
  return { started, release };
}

async function startReplacement(t, sessionId, sessionFile, closing) {
  const { session: replacement, realSessionId } = await startRpcSession(sessionId, sessionFile, undefined);
  t.after(() => replacement.destroy());
  assert.ok(replacement !== closing, "startRpcSession must not return the closing wrapper");
  assert.equal(realSessionId, sessionId);
  assert.equal(replacement.isAlive(), true);
  assert.equal(replacement.isChatOnly(), true);
  assertRegistered(sessionId, replacement, "the replacement takes over the registry entry");
  // The fast path now returns the replacement rather than starting a third wrapper.
  const again = await startRpcSession(sessionId, sessionFile, undefined);
  assert.ok(again.session === replacement, "the fast path returns the replacement");
  return replacement;
}

test("startRpcSession waits for a closing wrapper to dispose before it opens the session again", async (t) => {
  const { sessionId, sessionFile, session: closing } = await startPersistedSession(t);
  const shutdownHook = holdSessionShutdown(closing);
  const order = [];
  const dispose = closing.inner.dispose.bind(closing.inner);
  closing.inner.dispose = () => {
    order.push("closing disposed");
    dispose();
  };

  const shuttingDown = closing.shutdown();
  await shutdownHook.started;
  const replacing = startRpcSession(sessionId, sessionFile, undefined).then((started) => {
    order.push("replacement started");
    return started;
  });
  // Concurrent starts share the wait instead of each starting a wrapper.
  const concurrent = startRpcSession(sessionId, sessionFile, undefined);
  // A failed assertion below must not leave the shutdown held or the replacement running.
  t.after(async () => {
    shutdownHook.release();
    for (const start of [replacing, concurrent]) (await start.catch(() => null))?.session.destroy();
  });
  // An unblocked start of this Chat-only session finishes well within this window.
  await Promise.race([replacing, new Promise((resolve) => setTimeout(resolve, 500))]);
  assert.deepEqual(order, [], "nothing opens the session while its closing wrapper still owns it");
  assertRegistered(sessionId, closing, "the closing wrapper stays registered while it closes");
  assert.ok(globalThis.__piStartLocks.has(sessionId), "callers that check the start lock see the wait");

  shutdownHook.release();
  await shuttingDown;
  const { session: replacement } = await replacing;
  assert.ok((await concurrent).session === replacement, "the concurrent start gets the same replacement");
  assert.deepEqual(order, ["closing disposed", "replacement started"]);
  assert.ok(replacement !== closing);
  assertRegistered(sessionId, replacement, "the replacement takes over the registry entry");
});

test("a tool change made while the session closes applies to the wrapper a concurrent start brings up", async (t) => {
  const { sessionId, sessionFile, session: closing } = await startPersistedSession(t);
  assert.equal(closing.isChatOnly(), true);
  const shutdownHook = holdSessionShutdown(closing);
  const shuttingDown = closing.shutdown();
  await shutdownHook.started;

  // An SSE reconnect starts the session again, then the user picks Read-only.
  const reconnecting = startRpcSession(sessionId, sessionFile, undefined);
  const changingTools = setRpcSessionTools(sessionId, sessionFile, ["read"]);
  t.after(async () => {
    shutdownHook.release();
    for (const start of [reconnecting, changingTools]) (await start.catch(() => null))?.session.destroy();
  });

  shutdownHook.release();
  await shuttingDown;
  const changed = await changingTools;
  await reconnecting;
  assert.equal(changed.session.isAlive(), true);
  assert.equal(changed.session.isChatOnly(), false, "the selection left Chat only");
  assertRegistered(sessionId, changed.session, "the wrapper with the selection is the registered one");
  const tools = await changed.session.send({ type: "get_tools" });
  assert.ok(tools.some((tool) => tool.name === "read" && tool.active), "read is active");
});

test("startRpcSession replaces a shutting-down wrapper, which then cannot unregister its replacement", async (t) => {
  const { sessionId, sessionFile, session: closing } = await startPersistedSession(t);
  const shutdownHook = holdSessionShutdown(closing);
  skipClosingWait(closing);

  const shuttingDown = closing.shutdown();
  assert.equal(closing.isAlive(), false);
  await shutdownHook.started;
  // Still registered until it is disposed, but no lookup may route work to it.
  assertRegistered(sessionId, closing, "the closing wrapper stays registered until it is disposed");

  const replacement = await startReplacement(t, sessionId, sessionFile, closing);

  shutdownHook.release();
  await shuttingDown;
  assertRegistered(sessionId, replacement, "the closed wrapper left its replacement registered");
  assert.equal(replacement.isAlive(), true);

  await replacement.shutdown();
  assertRegistered(sessionId, undefined, "a wrapper still unregisters itself");
});

test("a wrapper evicted for a newer file on disk cannot unregister the wrapper that reloaded it", async (t) => {
  const { sessionId, sessionFile, session: stale } = await startPersistedSession(t);
  const shutdownHook = holdSessionShutdown(stale);
  skipClosingWait(stale);
  // Another pi process appends to the same session file.
  SessionManager.open(sessionFile).appendMessage({
    role: "user",
    content: "written by the other process",
    timestamp: Date.now(),
  });

  assert.equal(stale.evictIfDiskAhead(), true);
  assert.equal(stale.isAlive(), false);
  await shutdownHook.started;

  const replacement = await startReplacement(t, sessionId, sessionFile, stale);

  shutdownHook.release();
  await nextTurn();
  assertRegistered(sessionId, replacement, "the evicted wrapper left its replacement registered");
  assert.equal(replacement.isAlive(), true);
});

test("a wrapper registered before a hot reload cannot unregister its replacement either", async (t) => {
  const { sessionId, sessionFile, session: closing } = await startPersistedSession(t);
  // registerRpcWrapper() before this change removed the entry by id alone.
  closing.onDestroy(() => globalThis.__piSessions.delete(sessionId));
  const shutdownHook = holdSessionShutdown(closing);
  skipClosingWait(closing);

  const shuttingDown = closing.shutdown();
  await shutdownHook.started;
  const replacement = await startReplacement(t, sessionId, sessionFile, closing);

  shutdownHook.release();
  await shuttingDown;
  assertRegistered(sessionId, replacement, "the old cleanup left its replacement registered");
});

test("a session whose folder was deleted stays open but refuses prompts (#1061)", async (t) => {
  const { sessionFile, session } = await startPersistedSession(t);
  const before = readFileSync(sessionFile, "utf8");
  await rm(session.cwd, { recursive: true, force: true });

  await assert.rejects(
    session.send({ type: "prompt", message: "hello" }),
    { message: `Directory does not exist: ${session.cwd}` },
  );
  assert.equal(session.isAlive(), true);
  assert.equal(existsSync(session.cwd), false);
  assert.equal(readFileSync(sessionFile, "utf8"), before);
});
