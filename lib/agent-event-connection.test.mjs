import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { AgentEventConnection } = await jiti.import("./agent-event-connection.ts");

const CONNECTING = 0;
const OPEN = 1;
const CLOSED = 2;

class FakeEventSource {
  readyState = CONNECTING;
  onmessage = null;
  onerror = null;
  closeCount = 0;

  open() { this.readyState = OPEN; }
  message(event) { this.onmessage?.({ data: JSON.stringify(event) }); }
  error() {
    this.readyState = CLOSED;
    this.onerror?.(new Event("error"));
  }
  close() {
    this.readyState = CLOSED;
    this.closeCount += 1;
  }
}

function createHarness({ readinessTimeoutMs = 100, reconnectDelayMs = 5, staleAfterMs } = {}) {
  const sources = [];
  const events = [];
  const unexpectedErrors = [];
  let activeSession = "session-a";
  let demand = false;
  const connection = new AgentEventConnection({
    createSource(sessionId) {
      const source = new FakeEventSource();
      source.sessionId = sessionId;
      sources.push(source);
      return source;
    },
    onEvent(event) { events.push(event); },
    shouldMaintain: (sessionId) => demand && sessionId === activeSession,
    readinessTimeoutMs,
    reconnectDelayMs,
    staleAfterMs,
    onUnexpectedError(error) { unexpectedErrors.push(error); },
  });
  return {
    connection,
    sources,
    events,
    unexpectedErrors,
    setActiveSession(sessionId) { activeSession = sessionId; },
    setDemand(value) { demand = value; },
  };
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

test("shares one source and waits past the former transport deadline", async () => {
  const { connection, sources, events } = createHarness();
  const first = connection.ensureConnected("session-a");
  const second = connection.ensureConnected("session-a");

  assert.equal(sources.length, 1);
  sources[0].open();
  await wait(20);
  sources[0].message({ type: "connected" });
  await Promise.all([first, second]);

  sources[0].message({ type: "agent_start" });
  assert.deepEqual(events.map((event) => event.type), ["connected", "agent_start"]);
});

test("times out all waiters and closes the stalled source", async () => {
  const { connection, sources } = createHarness({ readinessTimeoutMs: 10 });
  const first = connection.ensureConnected("session-a");
  const second = connection.ensureConnected("session-a");

  await assert.rejects(first, (error) => error.status === "ready_timeout");
  await assert.rejects(second, (error) => error.status === "ready_timeout");
  assert.equal(sources[0].closeCount, 1);
});

test("manual close rejects waiters and isolates late events", async () => {
  const { connection, sources, events } = createHarness();
  const abandoned = connection.ensureConnected("session-a");
  const oldSource = sources[0];
  connection.close();
  await assert.rejects(abandoned, (error) => error.status === "closed");

  const replacement = connection.ensureConnected("session-a");
  oldSource.open();
  oldSource.message({ type: "connected" });
  await nextTurn();
  assert.deepEqual(events, []);

  sources[1].open();
  sources[1].message({ type: "connected" });
  await replacement;
});

test("surfaces startup errors without retrying or dispatching them", async () => {
  const { connection, sources, events } = createHarness();
  const ready = connection.ensureConnected("session-a");
  sources[0].open();
  sources[0].message({ type: "startup_error", errorMessage: "broken config" });

  await assert.rejects(ready, (error) => (
    error.status === "startup_error" && error.message === "broken config"
  ));
  await wait(10);
  assert.equal(sources.length, 1);
  assert.deepEqual(events, []);
});

test("replaces a previously connected CONNECTING source only once", async () => {
  const { connection, sources } = createHarness();
  const initial = connection.ensureConnected("session-a");
  sources[0].open();
  sources[0].message({ type: "connected" });
  await initial;

  sources[0].readyState = CONNECTING;
  const first = connection.ensureConnected("session-a");
  const second = connection.ensureConnected("session-a");
  await nextTurn();
  assert.equal(sources.length, 2);

  sources[1].open();
  sources[1].message({ type: "connected" });
  await Promise.all([first, second]);
});

test("passive maintenance retries a transient failure once", async () => {
  const { connection, sources, setDemand } = createHarness();
  setDemand(true);
  connection.maintain("session-a");
  sources[0].error();
  await wait(10);
  assert.equal(sources.length, 2);

  sources[1].open();
  sources[1].message({ type: "connected" });
  await wait(10);
  assert.equal(sources.length, 2);
});

test("an explicit startup error cancels a pending passive retry", async () => {
  const { connection, sources, setDemand } = createHarness();
  setDemand(true);
  connection.maintain("session-a");
  sources[0].error();

  const explicit = connection.ensureConnected("session-a");
  sources[1].open();
  sources[1].message({ type: "startup_error", errorMessage: "terminal" });
  await assert.rejects(explicit, (error) => error.status === "startup_error");
  await wait(10);
  assert.equal(sources.length, 2);
});

test("dropped demand, session switches, and close cannot revive an old retry", async () => {
  const first = createHarness();
  first.setDemand(true);
  first.connection.maintain("session-a");
  first.sources[0].error();
  first.setDemand(false);
  await wait(10);
  assert.equal(first.sources.length, 1);

  const second = createHarness();
  second.setDemand(true);
  second.connection.maintain("session-a");
  second.sources[0].error();
  second.setActiveSession("session-b");
  const ready = second.connection.ensureConnected("session-b");
  second.sources[1].open();
  second.sources[1].message({ type: "connected" });
  await ready;
  await wait(10);
  assert.equal(second.sources.length, 2);

  const closed = createHarness();
  closed.setDemand(true);
  closed.connection.maintain("session-a");
  closed.sources[0].error();
  closed.connection.close();
  await wait(10);
  assert.equal(closed.sources.length, 1);
});

test("a ready stream silent past staleAfterMs reconnects; heartbeats keep it and never reach onEvent", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
  const { connection, sources, events, setDemand } = createHarness({ readinessTimeoutMs: 60_000, staleAfterMs: 75_000 });
  setDemand(true);
  connection.maintain("session-a");
  sources[0].open();
  sources[0].message({ type: "connected" });
  await nextTurn();

  for (let beat = 0; beat < 4; beat += 1) {
    t.mock.timers.tick(30_000);
    sources[0].message({ type: "heartbeat" });
  }
  assert.equal(sources[0].closeCount, 0, "heartbeats every 30 s keep the stream");
  assert.deepEqual(events.map((event) => event.type), ["connected"]);

  // A half-open connection: nothing more arrives.
  t.mock.timers.tick(75_000);
  assert.equal(sources[0].closeCount, 0, "not before staleAfterMs has passed in full");
  t.mock.timers.tick(25_000);
  assert.equal(sources[0].closeCount, 1);
  t.mock.timers.tick(5);
  assert.equal(sources.length, 2, "reconnected after reconnectDelayMs");
  connection.close();
});

test("no watchdog without staleAfterMs, and none before the stream is ready", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
  const quiet = createHarness({ readinessTimeoutMs: 1_000_000 });
  quiet.setDemand(true);
  quiet.connection.maintain("session-a");
  quiet.sources[0].open();
  quiet.sources[0].message({ type: "connected" });
  await nextTurn();
  t.mock.timers.tick(600_000);
  assert.equal(quiet.sources[0].closeCount, 0);
  quiet.connection.close();

  const pending = createHarness({ readinessTimeoutMs: 1_000_000, staleAfterMs: 75_000 });
  pending.setDemand(true);
  pending.connection.maintain("session-a");
  pending.sources[0].open();
  t.mock.timers.tick(600_000);
  assert.equal(pending.sources[0].closeCount, 0, "the readiness timeout, not the watchdog, covers a stream not yet ready");
  pending.connection.close();
});

// The debug panel reads snapshot() on its own clock; it must describe the
// connection without being one more caller that opens, closes or arms anything.
test("snapshot() follows a stream from open to drop, retry and close", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 1_000 });
  const { connection, sources, setDemand } = createHarness({ readinessTimeoutMs: 60_000, reconnectDelayMs: 1_000, staleAfterMs: 75_000 });
  assert.deepEqual(connection.snapshot(), {
    sessionId: null,
    state: "idle",
    readyState: null,
    openedAt: null,
    connectedAt: null,
    lastSeenAt: null,
    lastHeartbeatAt: null,
    events: 0,
    opens: 0,
    retries: 0,
    retryDueAt: null,
    watchdogArmed: false,
    staleAfterMs: 75_000,
    lastError: null,
    lastClose: null,
  });

  setDemand(true);
  connection.maintain("session-a");
  let snapshot = connection.snapshot();
  assert.equal(snapshot.state, "connecting");
  assert.equal(snapshot.sessionId, "session-a");
  assert.equal(snapshot.readyState, CONNECTING);
  assert.equal(snapshot.openedAt, 1_000);
  assert.equal(snapshot.opens, 1);
  assert.equal(snapshot.lastSeenAt, null, "the server's opening comment is no data");

  t.mock.timers.tick(500);
  sources[0].open();
  sources[0].message({ type: "connected" });
  await nextTurn();
  t.mock.timers.tick(250);
  sources[0].message({ type: "agent_start" });
  snapshot = connection.snapshot();
  assert.equal(snapshot.state, "connected");
  assert.equal(snapshot.readyState, OPEN);
  assert.equal(snapshot.connectedAt, 1_500);
  assert.equal(snapshot.lastSeenAt, 1_750);
  assert.equal(snapshot.events, 2, "connected and agent_start reached the page");
  assert.equal(snapshot.watchdogArmed, true);

  t.mock.timers.tick(30_000);
  sources[0].message({ type: "heartbeat" });
  snapshot = connection.snapshot();
  assert.equal(snapshot.lastHeartbeatAt, 31_750);
  assert.equal(snapshot.lastSeenAt, 31_750);
  assert.equal(snapshot.events, 2, "a heartbeat is no event");

  sources[0].error();
  snapshot = connection.snapshot();
  assert.equal(snapshot.state, "retrying");
  assert.equal(snapshot.sessionId, "session-a");
  assert.equal(snapshot.readyState, null);
  assert.equal(snapshot.events, 0, "counts belong to the stream that dropped");
  assert.deepEqual(snapshot.lastError, { reason: "error", message: null, at: 31_750 });
  assert.equal(snapshot.retryDueAt, 32_750);
  assert.equal(snapshot.retries, 0);

  t.mock.timers.tick(1_000);
  snapshot = connection.snapshot();
  assert.equal(snapshot.retries, 1);
  assert.equal(snapshot.opens, 2);
  assert.equal(snapshot.state, "connecting");
  assert.equal(snapshot.openedAt, 32_750);
  assert.equal(snapshot.retryDueAt, null);

  t.mock.timers.tick(10);
  connection.close("released");
  snapshot = connection.snapshot();
  assert.equal(snapshot.state, "idle");
  assert.deepEqual(snapshot.lastClose, { reason: "released", at: 32_760 });
  assert.deepEqual(snapshot.lastError, { reason: "error", message: null, at: 31_750 }, "a close is no error");

  t.mock.timers.tick(10);
  connection.close("again");
  assert.deepEqual(connection.snapshot().lastClose, { reason: "released", at: 32_760 }, "closing nothing records nothing");
});

test("snapshot() tells the failure reasons apart", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 0 });

  const timeout = createHarness({ readinessTimeoutMs: 100 });
  const ready = timeout.connection.ensureConnected("session-a");
  t.mock.timers.tick(100);
  await assert.rejects(ready);
  assert.deepEqual(timeout.connection.snapshot().lastError, { reason: "ready_timeout", message: null, at: 100 });

  const startup = createHarness();
  const starting = startup.connection.ensureConnected("session-a");
  startup.sources[0].open();
  startup.sources[0].message({ type: "startup_error", errorMessage: "broken config" });
  await assert.rejects(starting);
  const failed = startup.connection.snapshot();
  assert.deepEqual(failed.lastError, { reason: "startup_error", message: "broken config", at: 100 });
  assert.equal(failed.state, "idle", "a startup error is not retried");
  assert.equal(failed.events, 0);

  const stale = createHarness({ readinessTimeoutMs: 60_000, staleAfterMs: 75_000 });
  stale.setDemand(true);
  stale.connection.maintain("session-a");
  stale.sources[0].open();
  stale.sources[0].message({ type: "connected" });
  await nextTurn();
  t.mock.timers.tick(100_000);
  assert.equal(stale.connection.snapshot().lastError?.reason, "stale");
  stale.connection.close();

  const stuck = createHarness();
  const initial = stuck.connection.ensureConnected("session-a");
  stuck.sources[0].open();
  stuck.sources[0].message({ type: "connected" });
  await initial;
  stuck.sources[0].readyState = CONNECTING;
  const reopened = stuck.connection.ensureConnected("session-a");
  await nextTurn();
  assert.deepEqual(stuck.connection.snapshot().lastClose, { reason: "stuck", at: 100_100 });
  stuck.sources[1].open();
  stuck.sources[1].message({ type: "connected" });
  await reopened;
  stuck.connection.close();

  const replaced = createHarness();
  void replaced.connection.ensureConnected("session-a").catch(() => {});
  void replaced.connection.ensureConnected("session-b").catch(() => {});
  assert.deepEqual(replaced.connection.snapshot().lastClose, { reason: "replaced", at: 100_100 });
  assert.equal(replaced.connection.snapshot().sessionId, "session-b");
  replaced.connection.close();
});

test("a late error from a source already let go leaves the snapshot alone", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 0 });
  const { connection, sources, setDemand } = createHarness();
  setDemand(true);
  connection.maintain("session-a");
  const old = sources[0];
  connection.close("deselected");
  old.onerror?.(new Event("error"));
  const snapshot = connection.snapshot();
  assert.equal(snapshot.lastError, null);
  assert.equal(snapshot.state, "idle");
  assert.equal(sources.length, 1, "and nothing reconnects");
});

test("a close ends the outage an idle connection's error left; closing again records nothing", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 0 });
  const { connection, sources } = createHarness();
  const starting = connection.ensureConnected("session-a");
  sources[0].open();
  sources[0].message({ type: "startup_error", errorMessage: "broken config" });
  await assert.rejects(starting);
  assert.equal(connection.snapshot().state, "idle");
  assert.equal(connection.snapshot().lastClose, null, "a failure is no close");

  t.mock.timers.tick(50);
  connection.close("deselected");
  const snapshot = connection.snapshot();
  assert.deepEqual(snapshot.lastClose, { reason: "deselected", at: 50 });
  assert.deepEqual(snapshot.lastError, { reason: "startup_error", message: "broken config", at: 0 }, "the error stays, as history");
  assert.equal(snapshot.state, "idle");
  assert.equal(sources.length, 1, "and nothing reconnects");

  t.mock.timers.tick(50);
  connection.close("released");
  assert.deepEqual(connection.snapshot().lastClose, { reason: "deselected", at: 50 }, "an outage already ended records nothing");
});

test("snapshot() changes nothing: no source, no timer, and a copy each time", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 0 });
  const { connection, sources, events, setDemand } = createHarness({ readinessTimeoutMs: 60_000, reconnectDelayMs: 1_000, staleAfterMs: 75_000 });

  for (let index = 0; index < 5; index += 1) connection.snapshot();
  assert.equal(sources.length, 0, "reading an idle connection opens nothing");

  setDemand(true);
  connection.maintain("session-a");
  sources[0].open();
  sources[0].message({ type: "connected" });
  await nextTurn();
  sources[0].error();

  const first = connection.snapshot();
  first.lastError.reason = "edited";
  first.retries = 99;
  for (let index = 0; index < 20; index += 1) connection.snapshot();
  const second = connection.snapshot();
  assert.equal(second.lastError.reason, "error", "the caller's copy is its own");
  assert.equal(second.retries, 0);
  assert.equal(sources.length, 1);
  assert.equal(sources[0].closeCount, 1);

  t.mock.timers.tick(999);
  assert.equal(sources.length, 1, "the retry keeps its own time");
  t.mock.timers.tick(1);
  assert.equal(sources.length, 2);
  assert.equal(connection.snapshot().retries, 1);
  sources[1].open();
  sources[1].message({ type: "connected" });
  await nextTurn();
  assert.deepEqual(events.map((event) => event.type), ["connected", "connected"]);
  connection.close();
});
