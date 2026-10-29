import assert from "node:assert/strict";
import test from "node:test";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { createJiti } from "jiti";

// What the debug panel reads about the page itself. Tracking, the visibility
// history and the poll record are page-wide, so each test loads its own copy.
const jiti = createJiti(import.meta.url, { moduleCache: false });
const load = () => jiti.import("./page-debug.ts");

const CONNECTING = 0;
const OPEN = 1;
const CLOSED = 2;

class FakeEventSource extends EventTarget {
  readyState = CONNECTING;
  onopen = null;
  onerror = null;

  open() {
    this.readyState = OPEN;
    const event = new Event("open");
    this.onopen?.(event);
    this.dispatchEvent(event);
  }
  // The browser reconnects by itself (CONNECTING) unless the response ended it (CLOSED).
  error({ closed = false } = {}) {
    this.readyState = closed ? CLOSED : CONNECTING;
    const event = new Event("error");
    this.onerror?.(event);
    this.dispatchEvent(event);
  }
  close() { this.readyState = CLOSED; }
}

test("a tracked source is returned unchanged and counted through listeners of its own", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_000 });
  const { listTrackedEventSources, trackEventSource } = await load();
  const source = new FakeEventSource();
  let ownOpens = 0;
  let ownErrors = 0;
  const onopen = () => { ownOpens += 1; };
  source.onopen = onopen;
  source.onerror = () => { ownErrors += 1; };

  assert.equal(trackEventSource("agent", source, "s1"), source);
  assert.equal(source.onopen, onopen, "its own handlers stay");
  assert.deepEqual(listTrackedEventSources(), [{
    id: 1,
    kind: "agent",
    label: "s1",
    state: "connecting",
    createdAt: 1_000,
    opens: 0,
    errors: 0,
    lastOpenAt: null,
    lastErrorAt: null,
  }]);

  t.mock.timers.tick(50);
  source.open();
  t.mock.timers.tick(50);
  source.error();
  let [entry] = listTrackedEventSources();
  assert.equal(entry.state, "connecting", "reconnecting after an error");
  assert.equal(entry.opens, 1);
  assert.equal(entry.lastOpenAt, 1_050);
  assert.equal(entry.errors, 1);
  assert.equal(entry.lastErrorAt, 1_100);

  t.mock.timers.tick(50);
  source.open();
  [entry] = listTrackedEventSources();
  assert.equal(entry.state, "open");
  assert.equal(entry.opens, 2);
  assert.equal(entry.lastOpenAt, 1_150);
  assert.equal(ownOpens, 2);
  assert.equal(ownErrors, 1);
  source.close();
});

test("closed sources drop out, oldest first otherwise; a label defaults to null", async () => {
  const { listTrackedEventSources, trackEventSource } = await load();
  const watch = trackEventSource("file-watch", new FakeEventSource());
  const terminal = trackEventSource("terminal", new FakeEventSource(), "/project");
  const agent = trackEventSource("agent", new FakeEventSource(), "s1");
  assert.deepEqual(listTrackedEventSources().map(({ kind, label }) => [kind, label]), [
    ["file-watch", null],
    ["terminal", "/project"],
    ["agent", "s1"],
  ]);

  watch.close();
  assert.deepEqual(listTrackedEventSources().map(({ kind }) => kind), ["terminal", "agent"], "closed by the page");
  terminal.error({ closed: true });
  assert.deepEqual(listTrackedEventSources().map(({ kind }) => kind), ["agent"], "ended by the server");

  agent.close();
  const next = trackEventSource("agent", new FakeEventSource(), "s2");
  assert.deepEqual(listTrackedEventSources().map(({ id, label }) => [id, label]), [[4, "s2"]]);
  next.close();
  assert.deepEqual(listTrackedEventSources(), []);
});

// A full collection without starting node with --expose-gc; undefined where the
// flag cannot be set at run time.
function exposedGc() {
  if (typeof globalThis.gc === "function") return globalThis.gc;
  try {
    setFlagsFromString("--expose-gc");
    const gc = runInNewContext("gc");
    return typeof gc === "function" ? gc : undefined;
  } catch {
    return undefined;
  }
}

test("a source the page closed and dropped is collectable before the next track or list call", async (t) => {
  const gc = exposedGc();
  if (!gc) return t.skip("needs gc()");
  const { listTrackedEventSources, trackEventSource } = await load();
  const kept = trackEventSource("agent", new FakeEventSource(), "s1");
  // A closed terminal: its handler holds the scrollback, and nothing here sees close().
  const dropped = (() => {
    const scrollback = new Array(100_000).fill("line");
    const source = trackEventSource("terminal", new FakeEventSource(), "/project");
    source.onmessage = () => scrollback.length;
    source.open();
    source.close();
    return new WeakRef(source);
  })();

  // A WeakRef keeps its target until the current job ends, so each round yields first.
  for (let round = 0; round < 5 && dropped.deref() !== undefined; round += 1) {
    await new Promise((resolve) => setImmediate(resolve));
    gc();
  }
  assert.equal(dropped.deref(), undefined, "the tracking holds it only weakly");
  assert.deepEqual(listTrackedEventSources().map(({ kind, opens }) => [kind, opens]), [["agent", 0]], "a source the page holds stays listed");
  kept.close();
});

test("a source without addEventListener is still listed, uncounted", async () => {
  const { listTrackedEventSources, trackEventSource } = await load();
  const source = { readyState: OPEN };
  assert.equal(trackEventSource("terminal", source, "t1"), source);
  const [entry] = listTrackedEventSources();
  assert.equal(entry.state, "open");
  assert.equal(entry.opens, 0);
  source.readyState = CLOSED;
  assert.deepEqual(listTrackedEventSources(), []);
});

test("listing reads only: copies each time, and a source keeps its counts", async () => {
  const { listTrackedEventSources, trackEventSource } = await load();
  const source = trackEventSource("agent", new FakeEventSource(), "s1");
  source.open();
  const [first] = listTrackedEventSources();
  first.opens = 99;
  first.state = "edited";
  for (let index = 0; index < 10; index += 1) listTrackedEventSources();
  const [second] = listTrackedEventSources();
  assert.equal(second.opens, 1);
  assert.equal(second.state, "open");
  assert.equal(source.readyState, OPEN);
  source.close();
});

test("visibility: nothing without a document, one passive listener with one", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 5_000 });
  const visibility = await load();
  const before = globalThis.document;
  t.after(() => {
    if (before === undefined) delete globalThis.document;
    else globalThis.document = before;
  });

  delete globalThis.document;
  visibility.startPageVisibilityTracking();
  assert.deepEqual(visibility.readPageVisibility(), {
    state: "visible",
    trackingSince: null,
    lastHiddenAt: null,
    lastVisibleAt: null,
    hiddenCount: 0,
  });

  const page = Object.assign(new EventTarget(), { visibilityState: "visible" });
  globalThis.document = page;
  const setVisibility = (state) => {
    page.visibilityState = state;
    page.dispatchEvent(new Event("visibilitychange"));
  };
  setVisibility("hidden");
  assert.equal(visibility.readPageVisibility().hiddenCount, 0, "nothing listens before tracking starts");
  setVisibility("visible");

  visibility.startPageVisibilityTracking();
  visibility.startPageVisibilityTracking();
  assert.equal(visibility.readPageVisibility().trackingSince, 5_000);

  t.mock.timers.tick(100);
  setVisibility("hidden");
  let read = visibility.readPageVisibility();
  assert.equal(read.state, "hidden");
  assert.equal(read.hiddenCount, 1, "started twice, listened once");
  assert.equal(read.lastHiddenAt, 5_100);

  t.mock.timers.tick(100);
  setVisibility("visible");
  t.mock.timers.tick(100);
  setVisibility("hidden");
  read = visibility.readPageVisibility();
  assert.equal(read.lastVisibleAt, 5_200);
  assert.equal(read.lastHiddenAt, 5_300);
  assert.equal(read.hiddenCount, 2);
  assert.equal(read.trackingSince, 5_000, "a later start keeps the first");
});

test("noteRunningPoll() records each finished poll; only errors count as failures", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 10_000 });
  const { noteRunningPoll, readRunningPoll } = await load();
  assert.deepEqual(readRunningPoll(), { count: 0, failures: 0, last: null });

  t.mock.timers.tick(40);
  noteRunningPoll(10_000, "ok", 200);
  assert.deepEqual(readRunningPoll(), {
    count: 1,
    failures: 0,
    last: { at: 10_040, durationMs: 40, outcome: "ok", httpStatus: 200 },
  });

  noteRunningPoll(10_000, "error", 503);
  noteRunningPoll(10_000, "error", null);
  noteRunningPoll(10_000, "aborted", null);
  const read = readRunningPoll();
  assert.equal(read.count, 4);
  assert.equal(read.failures, 2, "a poll the page hid or replaced is no failure");
  assert.deepEqual(read.last, { at: 10_040, durationMs: 40, outcome: "aborted", httpStatus: null });

  read.last.outcome = "edited";
  read.count = 0;
  assert.equal(readRunningPoll().last.outcome, "aborted", "the caller's copy is its own");
  assert.equal(readRunningPoll().count, 4);

  noteRunningPoll(20_000, "ok", 200);
  assert.equal(readRunningPoll().last.durationMs, 0, "a start on another clock never reads negative");

  // Answered at 10_060, then a session-list reload until 10_400: the round trip is the request's.
  t.mock.timers.tick(360);
  noteRunningPoll(10_040, "ok", 200, 10_060);
  assert.deepEqual(readRunningPoll().last, { at: 10_400, durationMs: 20, outcome: "ok", httpStatus: 200 });
  noteRunningPoll(10_040, "error", 500, null);
  assert.equal(readRunningPoll().last.durationMs, 360, "no answer read: up to the finally");
  noteRunningPoll(10_040, "ok", 200, 9_000);
  assert.equal(readRunningPoll().last.durationMs, 0);
});

test("readHttpProtocol() reads the navigation entry, then the page's scheme", async (t) => {
  const { readHttpProtocol } = await load();
  const before = globalThis.location;
  t.after(() => {
    if (before === undefined) delete globalThis.location;
    else globalThis.location = before;
  });
  let entries = [];
  const getEntries = t.mock.method(performance, "getEntriesByType", () => entries);

  delete globalThis.location;
  assert.equal(readHttpProtocol(), null, "unknown");
  entries = [{ nextHopProtocol: "h2" }];
  assert.equal(readHttpProtocol(), "h2");
  entries = [{ nextHopProtocol: "" }];
  globalThis.location = { protocol: "http:" };
  assert.equal(readHttpProtocol(), "http/1.1", "plain HTTP is never h2");
  globalThis.location = { protocol: "https:" };
  assert.equal(readHttpProtocol(), null);
  assert.ok(getEntries.mock.calls.every((call) => call.arguments[0] === "navigation"), "only the navigation entry is read");
});
