import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const state = await jiti.import("./debug-panel-state.ts");
const { enLocale } = await jiti.import("@/lib/i18n/messages/en.ts");
const { interpolateMessage } = await jiti.import("@/lib/i18n/format.ts");

const messages = enLocale.messages;
/** English, and a missing key fails the test instead of printing itself. */
const t = (key, params) => {
  assert.equal(typeof messages[key], "string", `missing translation ${key}`);
  return interpolateMessage(messages[key], params);
};

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const flush = () => new Promise((resolve) => setImmediate(resolve));

function summary(sessionId, extra = {}) {
  return {
    sessionId,
    state: "alive",
    running: false,
    awaitingInput: false,
    subagent: false,
    eventStreams: 0,
    providers: 0,
    nextIdleCheckAt: null,
    forcedByStop: false,
    starts: 1,
    ...extra,
  };
}

function snapshot(extra = {}) {
  return {
    now: 1_000_000,
    server: {
      startedAt: 1_000_000 - HOUR,
      idleTimeoutMs: 10 * MINUTE,
      heartbeatMs: 15 * SECOND,
      wrappers: { alive: 1, closing: 0, starting: 0 },
      eventStreams: { total: 1, byHolder: [{ holder: "page-1", count: 1 }] },
      fileWatches: 0,
      terminals: { count: 0, listeners: 0, detached: 0, exited: 0, nextCleanupAt: null },
    },
    sessions: [summary("s1", { eventStreams: 1, nextIdleCheckAt: 1_000_000 + 8 * MINUTE + 30 * SECOND })],
    session: null,
    ...extra,
  };
}

test("durations read in the panel's units and in a row's single unit", () => {
  assert.equal(state.formatDebugDuration(350.7, t), "350 ms");
  assert.equal(state.formatDebugDuration(42_900, t), "42s");
  assert.equal(state.formatDebugDuration(8 * MINUTE + 5 * SECOND, t), "8m 05s");
  assert.equal(state.formatDebugDuration(2 * HOUR + 3 * MINUTE, t), "2h 03m");
  assert.equal(state.formatDebugDuration(3 * 24 * HOUR + 4 * HOUR, t), "3d 4h");
  assert.equal(state.formatDebugDuration(-5, t), "0 ms", "never negative");
  assert.equal(state.formatDebugDuration(Number.NaN, t), "0 ms");

  assert.equal(state.formatShortDebugDuration(42_900, t), "42s");
  assert.equal(state.formatShortDebugDuration(8 * MINUTE + 59 * SECOND, t), "8m");
  assert.equal(state.formatShortDebugDuration(5 * HOUR, t), "5h");
  assert.equal(state.formatShortDebugDuration(50 * HOUR, t), "2d");

  assert.equal(state.formatAgo(12 * SECOND, t), "12s ago");
  assert.equal(state.formatCountdown(3 * SECOND, t), "in 3s");
  assert.equal(state.formatCountdown(0, t), "due");
  assert.equal(state.formatCountdown(-4 * SECOND, t), "due");
  assert.equal(state.formatBytes(512), "512 B");
  assert.equal(state.formatBytes(1536), "1.5 KB");
  assert.equal(state.shortDebugId("0123456789abcdef"), "01234567");
});

test("server times are read on the server's clock plus the time since the answer, never the browser's clock", () => {
  // The browser's clock is an hour off; only the time it counted since the answer matters.
  const clock = state.debugServerClock(1_000_000, 5_000, 5_000 + 20 * SECOND);
  assert.equal(clock.remaining(1_000_000 + MINUTE), 40 * SECOND);
  assert.equal(clock.age(1_000_000 - MINUTE), 80 * SECOND);
  // A browser clock that stepped back does not make the answer younger than it arrived.
  const back = state.debugServerClock(1_000_000, 5_000, 1_000);
  assert.equal(back.remaining(1_000_000 + MINUTE), MINUTE);
});

test("the next lease renewal is a whole number of intervals after the timer started", () => {
  assert.equal(state.nextLeaseRenewalAt(null, 15_000, 100), null);
  assert.equal(state.nextLeaseRenewalAt(1_000, 0, 2_000), null);
  assert.equal(state.nextLeaseRenewalAt(1_000, 15_000, 1_000), 16_000);
  assert.equal(state.nextLeaseRenewalAt(1_000, 15_000, 16_000), 31_000);
  assert.equal(state.nextLeaseRenewalAt(1_000, 15_000, 40_000), 46_000);
});

test("only an answer of the snapshot's shape is rendered", () => {
  assert.equal(state.isDebugSnapshotResponse(snapshot()), true);
  const detail = {
    sessionId: "s1",
    wrapper: null,
    lifecycle: null,
    starting: false,
    providers: null,
    eventStreams: [],
    subagents: { active: false, runs: [], notifications: [] },
    mcp: null,
  };
  assert.equal(state.isDebugSnapshotResponse(snapshot({ session: detail })), true);
  for (const broken of [
    null,
    [],
    { error: "boom" },
    snapshot({ now: "1" }),
    snapshot({ sessions: [{ sessionId: 1 }] }),
    snapshot({ session: undefined }),
    snapshot({ session: { ...detail, eventStreams: null } }),
    snapshot({ session: { ...detail, wrapper: { state: "alive" } } }),
    snapshot({ session: { ...detail, mcp: { servers: "x" } } }),
    snapshot({ server: { ...snapshot().server, eventStreams: { total: 1 } } }),
  ]) {
    assert.equal(state.isDebugSnapshotResponse(broken), false, JSON.stringify(broken));
  }
});

test("reading the page survives a chat reader that throws", () => {
  const thrown = state.readDebugPage(() => { throw new Error("old chat"); }, null, 42);
  assert.equal(thrown.client, null);
  assert.equal(thrown.clientFailed, true);
  assert.equal(thrown.at, 42);
  assert.ok(Array.isArray(thrown.sources));

  const none = state.readDebugPage(null, 7, 42);
  assert.equal(none.clientFailed, false);
  assert.equal(none.pollInFlightSince, 7);

  const client = { sessionId: "fresh" };
  assert.equal(state.readDebugPage(() => client, null).client, client);
  assert.equal(state.debugTargetSessionId(client, "selected"), "fresh", "a fresh composer's own id first");
  assert.equal(state.debugTargetSessionId({ sessionId: null }, "selected"), "selected");
  assert.equal(state.debugTargetSessionId(null, null), null);
});

// ── Issues ──

// The browser's clock and the server's are far apart: the page's times are on the first.
const LOCAL = 50_000_000;
const SERVER = 9_000_000;
const MINE = "page-mine-123";
const OTHER = "page-other-456";

function client(extra = {}) {
  return {
    pageId: MINE,
    sessionId: "s1",
    selectedSessionId: "s1",
    mounted: true,
    wantsStream: true,
    connection: {
      sessionId: "s1",
      state: "connected",
      readyState: 1,
      openedAt: LOCAL - 5 * MINUTE,
      connectedAt: LOCAL - 5 * MINUTE + 200,
      lastSeenAt: LOCAL - 3 * SECOND,
      lastHeartbeatAt: LOCAL - 3 * SECOND,
      events: 12,
      opens: 1,
      retries: 0,
      retryDueAt: null,
      watchdogArmed: true,
      staleAfterMs: 75 * SECOND,
      lastError: null,
      lastClose: null,
    },
    released: { active: false, count: 0, lastAt: null },
    reattached: { count: 0, lastAt: null, lastReason: null },
    hiddenReleaseDueAt: null,
    hiddenGraceMs: 60 * SECOND,
    graceDueAt: null,
    run: { agentRunning: false, bashRunning: false, compacting: false, dialogs: 0 },
    lease: {
      renewIntervalMs: 30 * SECOND,
      renewStartedAt: LOCAL - 20 * SECOND,
      inFlightSince: null,
      requests: 2,
      unanswered: 0,
      errors: 0,
      last: { at: LOCAL - 5 * SECOND, durationMs: 18, outcome: "reply", httpStatus: 200, reply: { running: false, awaitingInput: false, subagentsActive: false } },
    },
    ...extra,
  };
}

function source(id, kind, label, extra = {}) {
  return { id, kind, label, state: "open", createdAt: LOCAL - (10 - id) * MINUTE, opens: 1, errors: 0, lastOpenAt: null, lastErrorAt: null, ...extra };
}

function page(extra = {}) {
  return {
    at: LOCAL,
    client: client(),
    clientFailed: false,
    sources: [source(1, "agent", "s1")],
    visibility: { state: "visible", trackingSince: LOCAL - HOUR, lastHiddenAt: null, lastVisibleAt: null, hiddenCount: 0 },
    protocol: "http/1.1",
    runningPoll: { count: 10, failures: 0, last: { at: LOCAL - SECOND, durationMs: 12, outcome: "ok", httpStatus: 200 } },
    pollInFlightSince: null,
    ...extra,
  };
}

function wrapper(extra = {}) {
  return {
    sessionId: "s1", state: "alive", stale: false, subagent: false, chatOnly: false,
    createdAt: SERVER - 6 * MINUTE, startedAt: SERVER - 6 * MINUTE, closingAt: null, extensions: "bound",
    run: { running: false, streaming: false, promptRunning: false, pendingPrompts: 0, bashRunning: false, compacting: false, retrying: false, queuedMessages: 0, waitingForMcp: false, runningTools: 0, mutatingCommands: 0, replacement: null },
    idle: { timeoutMs: 10 * MINUTE, nextCheckAt: SERVER + 8 * MINUTE, lastResetAt: null, forcedByStop: false },
    awaitingInput: false, pendingUiRequests: 0, customUis: 0, eventListeners: 1, lastEvent: null, lastCommand: null,
    ...extra,
  };
}

function detail(extra = {}) {
  return {
    sessionId: "s1",
    wrapper: wrapper(),
    lifecycle: { starts: 1, firstStartedAt: SERVER - 6 * MINUTE, lastStartedAt: SERVER - 6 * MINUTE, lastClosedAt: null },
    starting: false,
    providers: [],
    eventStreams: [{ holder: MINE, openedAt: SERVER - 5 * MINUTE, connectedAt: SERVER - 5 * MINUTE, lastWriteAt: null, droppedEvents: 0, queuedBytes: 0 }],
    subagents: { active: false, runs: [], notifications: [] },
    mcp: null,
    ...extra,
  };
}

function server(extra = {}) {
  // The answer's request left at LOCAL - 1040 and its answer came back at LOCAL - 1000.
  return { ...state.EMPTY_DEBUG_SERVER_READING, sessionId: "s1", reply: snapshot(), receivedAt: LOCAL - SECOND, roundTripMs: 40, requests: 3, ...extra };
}

function issuesOf({ page: pageExtra, client: clientExtra, connection, lease, detail: detailExtra, server: serverExtra } = {}) {
  const base = client(clientExtra);
  if (connection) base.connection = { ...base.connection, ...connection };
  if (lease) base.lease = { ...base.lease, ...lease };
  return state.debugIssues({
    page: page({ client: base, ...pageExtra }),
    server: server(serverExtra),
    detail: detail(detailExtra),
    t,
  });
}

test("a quiet page and server raise no issue", () => {
  assert.deepEqual(issuesOf(), []);
});

const ISSUE_CASES = [
  ["the poll timed out", { server: { failure: { kind: "timeout", status: null, at: LOCAL - SECOND } } },
    { id: "poll", tone: "warning", text: `${t("debug.poll.timeout")} · 1s ago` }],
  ["the poll failed", { server: { failure: { kind: "http", status: 502, at: LOCAL - SECOND } } },
    { id: "poll", tone: "error", text: "The server answered HTTP 502 · 1s ago" }],
  ["the poll is slow", { page: { pollInFlightSince: LOCAL - 2500 } },
    { id: "poll", tone: "warning", text: "No answer yet after 2s" }],
  ["the chat's reader threw", { page: { client: null, clientFailed: true } },
    { id: "reader", tone: "error", text: t("debug.stream.readerFailed") }],
  ["the running poll failed", { page: { runningPoll: { count: 4, failures: 1, last: { at: LOCAL - 2 * SECOND, durationMs: 30, outcome: "error", httpStatus: 503 } } } },
    { id: "runningPoll", tone: "warning", text: "Sidebar poll · failed · HTTP 503 · 2s ago" }],
  ["five of six connections", { page: { sources: [1, 2, 3, 4, 5].map((id) => source(id, id === 1 ? "agent" : "terminal", id === 1 ? "s1" : "/w")) } },
    { id: "pool", tone: "warning", text: "This page holds 5 of the six connections HTTP/1.1 allows per origin, for all tabs" }],
  ["six of six connections", { page: { sources: [1, 2, 3, 4, 5, 6].map((id) => source(id, id === 1 ? "agent" : "terminal", id === 1 ? "s1" : "/w")) } },
    { id: "pool", tone: "error", text: "This page holds 6 of the six connections HTTP/1.1 allows per origin, for all tabs" }],
  ["a source keeps failing to connect", { page: { sources: [source(1, "agent", "s1"), source(2, "file-watch", "/work/app/a.ts", { state: "connecting", errors: 2 })] } },
    { id: "source", tone: "warning", text: "File watch · a.ts · connecting · opened 1× · 2 errors" }],
  ["the stream's last error while it is down", { connection: { state: "retrying", lastError: { reason: "stale", message: null, at: LOCAL - 4 * SECOND }, retryDueAt: LOCAL + 3 * SECOND } },
    { id: "stream", tone: "error", text: "stale (watchdog) · 4s ago · retry in 3s" }],
  ["the stream retries", { connection: { state: "retrying", retryDueAt: LOCAL + 3 * SECOND } },
    { id: "stream", tone: "warning", text: "retrying · retry in 3s" }],
  ["the stream is silent for half the watchdog", { connection: { lastSeenAt: LOCAL - 40 * SECOND } },
    { id: "streamSilent", tone: "warning", text: "Last data 40s ago" }],
  ["the stream is silent past the watchdog", { connection: { lastSeenAt: LOCAL - 80 * SECOND } },
    { id: "streamSilent", tone: "error", text: "Last data 1m 20s ago" }],
  ["the server has no stream from this page", { detail: { eventStreams: [] } },
    { id: "noServerStream", tone: "warning", text: t("debug.issue.noServerStream") }],
  ["a stream dropped events", { detail: { eventStreams: [...detail().eventStreams, { holder: OTHER, openedAt: SERVER, connectedAt: SERVER, lastWriteAt: null, droppedEvents: 3, queuedBytes: 0 }] } },
    { id: "dropped", tone: "warning", text: "other page page-oth · 3 dropped" }],
  ["the lease waits for an answer", { lease: { inFlightSince: LOCAL - 2 * SECOND } },
    { id: "lease", tone: "warning", text: "Lease · waiting 2s for an answer" }],
  ["the lease failed", { lease: { last: { at: LOCAL - 3 * SECOND, durationMs: 9, outcome: "error", httpStatus: 500, reply: null } } },
    { id: "lease", tone: "error", text: "Lease · failed · HTTP 500 · 3s ago" }],
  ["the lease went unanswered", { lease: { last: { at: LOCAL - 12 * SECOND, durationMs: 5000, outcome: "unanswered", httpStatus: null, reply: null } } },
    { id: "lease", tone: "warning", text: "Lease · unanswered · 12s ago" }],
  ["extensions failed to bind", { detail: { wrapper: wrapper({ extensions: "failed" }) } },
    { id: "extensions", tone: "error", text: "Extensions · failed" }],
  ["a liveness provider threw", { detail: { providers: [{ name: "keepalive", active: "error", byFile: false }, { name: "fine", active: true, byFile: false }] } },
    { id: "provider", tone: "error", text: "keepalive · error" }],
  ["an MCP server did not connect", {
    detail: {
      mcp: {
        active: true, disposed: false, runActive: false, idleMs: 0, idleReleaseAt: null, problems: 0,
        servers: [{ name: "github", scope: "global", state: "failed", hasError: false, released: false }, { name: "ok", scope: "global", state: "connected", hasError: false, released: false }],
      },
    },
  }, { id: "mcp", tone: "error", text: "MCP github · Did not connect" }],
];

for (const [name, input, expected] of ISSUE_CASES) {
  test(`issue: ${name}`, () => {
    assert.deepEqual(issuesOf(input), [expected]);
  });
}

test("issues near their thresholds stay quiet", () => {
  // Retrying sources (the server down) hold no connection between attempts: no pool warning.
  const retrying = [1, 2, 3, 4, 5].map((id) => source(id, "terminal", "/w", id === 1 ? {} : { state: "connecting" }));
  assert.deepEqual(issuesOf({ page: { sources: retrying } }), [], "five sources, one open");
  assert.deepEqual(issuesOf({ page: { pollInFlightSince: LOCAL - 1500 } }), [], "a poll under 2 s");
  assert.deepEqual(issuesOf({ lease: { inFlightSince: LOCAL - 1500 } }), [], "a lease request under 2 s");
  assert.deepEqual(issuesOf({ connection: { lastSeenAt: LOCAL - 37 * SECOND } }), [], "under half the watchdog");
  const four = [1, 2, 3, 4].map((id) => source(id, id === 1 ? "agent" : "file-watch", id === 1 ? "s1" : "/w/a"));
  assert.deepEqual(issuesOf({ page: { sources: four } }), [], "four of six");
  const six = [1, 2, 3, 4, 5, 6].map((id) => source(id, id === 1 ? "agent" : "file-watch", id === 1 ? "s1" : "/w/a"));
  assert.deepEqual(issuesOf({ page: { sources: six, protocol: "h2" } }), [], "h2 has no six-connection limit");
  // The chat's own stream reconnecting is the stream's lines, not a source's.
  assert.deepEqual(issuesOf({ page: { sources: [source(1, "agent", "s1", { state: "connecting", errors: 3 })] } }), []);
  // An error the stream recovered from is history (the state's tooltip), not an issue.
  assert.deepEqual(issuesOf({ connection: { lastError: { reason: "error", message: "boom", at: LOCAL - MINUTE } } }), []);
});

test("an error a deliberate close came after belongs to an outage that ended", () => {
  // Recovered long ago, then released while hidden: reattaching is no connection error.
  const old = { reason: "error", message: null, at: LOCAL - 20 * MINUTE };
  const released = { reason: "released", at: LOCAL - 3 * MINUTE };
  assert.deepEqual(issuesOf({ connection: { state: "connecting", connectedAt: null, lastError: old, lastClose: released } }), []);
  assert.deepEqual(issuesOf({ connection: { state: "idle", connectedAt: null, lastError: old, lastClose: released } }), []);
  // A close before the error does not end it: the stream is down since.
  const retrying = issuesOf({
    connection: { state: "retrying", connectedAt: null, lastError: { reason: "stale", message: null, at: LOCAL - 4 * SECOND }, lastClose: released, retryDueAt: LOCAL + SECOND },
  });
  assert.deepEqual(retrying.map((issue) => `${issue.tone}:${issue.id}`), ["error:stream"]);
  // The retry path never stamps a close, so a reconnect under way still shows the error.
  assert.deepEqual(
    issuesOf({ connection: { state: "connecting", connectedAt: null, lastError: { reason: "error", message: null, at: LOCAL - 2 * SECOND } } }).map((issue) => issue.id),
    ["stream"],
  );
});

test("notable states are shown in place, never as issues", () => {
  assert.deepEqual(issuesOf({
    client: { released: { active: true, count: 1, lastAt: LOCAL - MINUTE }, graceDueAt: LOCAL + 20 * SECOND },
    detail: {
      wrapper: wrapper({
        state: "closing",
        closingAt: SERVER - 3 * SECOND,
        awaitingInput: true,
        pendingUiRequests: 2,
        extensions: "binding",
        run: { ...wrapper().run, running: true, retrying: true, waitingForMcp: true, pendingPrompts: 1 },
        idle: { timeoutMs: 10 * MINUTE, nextCheckAt: SERVER + 30 * SECOND, lastResetAt: null, forcedByStop: true },
        eventListeners: 4,
      }),
      eventStreams: [
        ...detail().eventStreams,
        { holder: OTHER, openedAt: SERVER, connectedAt: null, lastWriteAt: null, droppedEvents: 0, queuedBytes: 0 },
      ],
      providers: [{ name: "idle-ext", active: false, byFile: true }],
      subagents: {
        active: true,
        runs: [{ sessionId: "sub", parentSessionId: "s1", status: "aborted", profile: null, background: true, resumed: false, dispatchedAt: null, abortRequested: true, mcpWaiting: true }],
        notifications: [{ sessionId: "sub", parentSessionId: "s1", since: SERVER - SECOND }],
      },
      mcp: { active: false, disposed: true, runActive: false, idleMs: 0, idleReleaseAt: null, problems: 2, servers: [{ name: "x", scope: "global", state: "needs-auth", hasError: false, released: true }] },
    },
  }), []);
  // A wrapper from before a hot reload knows nothing of its extensions.
  assert.deepEqual(issuesOf({ detail: { wrapper: wrapper({ stale: true, extensions: "failed" }) } }), []);
});

test("the cross-checks only judge what the page had before the answer's request left", () => {
  // Connected 500 ms before the answer came back: after its request left, so not yet on the server.
  assert.deepEqual(issuesOf({ connection: { connectedAt: LOCAL - 500 }, detail: { eventStreams: [] } }), []);
  assert.equal(issuesOf({ connection: { connectedAt: LOCAL - 2 * SECOND }, detail: { eventStreams: [] } })[0].id, "noServerStream");
  // A stream for another session, or one still connecting, is not this session's.
  assert.deepEqual(issuesOf({ connection: { sessionId: "s2" }, detail: { eventStreams: [] } }), []);
  assert.deepEqual(issuesOf({ connection: { state: "connecting" }, detail: { eventStreams: [] } }), []);

  // No page id yet, or no answer about this session: nothing to compare.
  assert.deepEqual(issuesOf({ client: { pageId: null }, detail: { eventStreams: [] } }), []);
  assert.deepEqual(state.debugIssues({ page: page(), server: server(), detail: null, t }), []);
});

test("errors come first, then warnings, each in the catalog's order", () => {
  const issues = issuesOf({
    server: { failure: { kind: "timeout", status: null, at: LOCAL - SECOND } },
    lease: { last: { at: LOCAL - 3 * SECOND, durationMs: 9, outcome: "error", httpStatus: null, reply: null } },
    connection: { lastSeenAt: LOCAL - 40 * SECOND },
    detail: { providers: [{ name: "p", active: "error", byFile: false }] },
  });
  assert.deepEqual(issues.map((issue) => `${issue.tone}:${issue.id}`), ["error:lease", "error:provider", "warning:poll", "warning:streamSilent"]);
  assert.equal(issues[0].text, "Lease · failed · 3s ago", "no HTTP status, none said");
});

test("the verdict: reading, paused, issues, waiting or OK", () => {
  const empty = state.EMPTY_DEBUG_SERVER_READING;
  const warning = { id: "poll", tone: "warning", text: "" };
  const error = { id: "reader", tone: "error", text: "" };
  assert.deepEqual(state.debugVerdict(null, server(), []), { kind: "reading", tone: "dim", count: 0 });
  assert.equal(state.debugVerdict(page({ visibility: { ...page().visibility, state: "hidden" } }), server(), [warning]).kind, "hidden");
  assert.deepEqual(state.debugVerdict(page(), empty, [warning, error]), { kind: "issues", tone: "error", count: 2 });
  assert.deepEqual(state.debugVerdict(page(), server(), [warning]), { kind: "issues", tone: "warning", count: 1 });
  assert.equal(state.debugVerdict(page(), empty, []).kind, "waiting");
  assert.deepEqual(state.debugVerdict(page(), server(), []), { kind: "ok", tone: "ok", count: 0 });
});

// ── This page's sources ──

test("the meter: this page's sources against HTTP/1.1's six, the chat's stream apart from a grace one", () => {
  const sources = [
    source(4, "terminal", "/work/app"),
    source(1, "agent", "s1"),
    source(2, "agent", "s-old"),
    source(3, "file-watch", "/work/app/a.ts", { state: "connecting", errors: 1 }),
  ];
  const pool = state.poolSlots(sources, "http/1.1", "s1");
  assert.equal(pool.cap, 6);
  assert.deepEqual(pool.slots.map((slot) => [slot.id, slot.kind, slot.chat, slot.connecting]), [
    [1, "agent", true, false],
    [2, "agent", false, false],
    [3, "file-watch", false, true],
    [4, "terminal", false, false],
  ], "oldest first");
  assert.deepEqual([pool.mine, pool.overflow, pool.tone], [4, 0, "dim"]);
  assert.deepEqual(pool.kinds, { agent: 2, "file-watch": 1, terminal: 1 });
  assert.deepEqual(state.debugPoolKindCounts(pool, t), ["Agent 2", "File watch 1", "Terminal 1"]);

  const many = (count) => Array.from({ length: count }, (_, index) => source(index + 1, "file-watch", "/w/f"));
  assert.equal(state.poolSlots(many(5), "http/1.1", null).tone, "warning");
  const retrying = many(5).map((item, index) => (index === 0 ? item : { ...item, state: "connecting" }));
  assert.deepEqual([state.poolSlots(retrying, "http/1.1", null).mine, state.poolSlots(retrying, "http/1.1", null).tone], [5, "dim"],
    "drawn, but a source still connecting takes no connection");
  const full = state.poolSlots(many(8), "http/1.1", null);
  assert.deepEqual([full.slots.length, full.mine, full.overflow, full.tone], [6, 8, 2, "error"]);
  assert.deepEqual(full.kinds, { agent: 0, "file-watch": 8, terminal: 0 }, "those past the six counted too");
  assert.deepEqual(state.debugPoolKindCounts(full, t), ["File watch 8"], "a kind it holds none of is left out");

  const h2 = state.poolSlots(many(8), "h2", null);
  assert.deepEqual([h2.cap, h2.slots.length, h2.overflow, h2.tone, h2.protocol], [null, 8, 0, "dim", "h2"]);
  const unknown = state.poolSlots(many(2), null, null);
  assert.deepEqual([unknown.cap, unknown.protocol, unknown.slots.length], [null, null, 2]);
  assert.equal(state.poolSlots([source(1, "agent", "s1")], "http/1.1", null).slots[0].chat, false, "no chat, no chat stream");
});

test("a source's name and tooltip", () => {
  const titleOf = (id) => (id === "s1" ? "Fix login" : null);
  assert.equal(state.sourceDisplayLabel({ kind: "agent", label: "s1" }, titleOf), "Fix login");
  assert.equal(state.sourceDisplayLabel({ kind: "agent", label: "0123456789abcdef" }, titleOf), "01234567");
  assert.equal(state.sourceDisplayLabel({ kind: "file-watch", label: "C:\\work\\app\\page.tsx" }), "page.tsx");
  assert.equal(state.sourceDisplayLabel({ kind: "terminal", label: "/work/app/" }), "app");
  assert.equal(state.sourceDisplayLabel({ kind: "terminal", label: null }), "—");
  const [slot] = state.poolSlots([source(1, "file-watch", "/work/app/app.tsx", { createdAt: LOCAL - 4 * MINUTE - 12 * SECOND })], "http/1.1", null).slots;
  assert.equal(state.debugSlotTitle(slot, LOCAL, t), "File watch · app.tsx · open · opened 1× · 0 errors · 4m 12s ago");
  assert.equal(state.pageAgentStreamCount([source(1, "agent", "s1"), source(2, "agent", "s1"), source(3, "agent", "s2"), source(4, "file-watch", "s1")], "s1"), 2);
});

// ── Samples and scales ──

test("poll samples: round trips, failures at full height, at most thirty kept", () => {
  assert.deepEqual(state.debugPollSample(server({ roundTripMs: 38 })), { ms: 38, tone: "dim", failed: false });
  assert.deepEqual(state.debugPollSample(server({ roundTripMs: 2500 })), { ms: 2500, tone: "warning", failed: false });
  assert.deepEqual(state.debugPollSample(server({ failure: { kind: "timeout", status: null, at: 1 } })), { ms: 5000, tone: "warning", failed: true });
  assert.equal(state.debugPollSample(server({ failure: { kind: "network", status: null, at: 1 } })).tone, "error");
  assert.equal(state.debugPollSample(state.EMPTY_DEBUG_SERVER_READING), null);

  assert.equal(state.runningPollSample(null), null);
  assert.equal(state.runningPollSample({ at: 1, durationMs: 4, outcome: "aborted", httpStatus: null }), null, "an aborted poll is no sample");
  assert.deepEqual(state.runningPollSample({ at: 1, durationMs: 30, outcome: "error", httpStatus: 500 }), { ms: 30, tone: "error", failed: true });
  assert.deepEqual(state.runningPollSample({ at: 1, durationMs: 21, outcome: "ok", httpStatus: 200 }), { ms: 21, tone: "dim", failed: false });

  let list = [];
  for (let index = 0; index < 35; index++) list = state.pushDebugSample(list, { ms: index, tone: "dim", failed: false });
  assert.equal(list.length, state.DEBUG_SAMPLE_COUNT);
  assert.deepEqual([list[0].ms, list[29].ms], [5, 34], "the newest kept");

  assert.deepEqual(state.sparkStats([
    { ms: 10, tone: "dim", failed: false },
    { ms: 5000, tone: "warning", failed: true },
    { ms: 40, tone: "dim", failed: false },
    { ms: 30, tone: "dim", failed: false },
    { ms: 1000, tone: "dim", failed: false },
  ]), { count: 4, median: 35, max: 1000 }, "answered samples only");
  assert.deepEqual(state.sparkStats([]), { count: 0, median: 0, max: 0 });
});

test("the sparkline's scale: the 5 s timeout is full height, on a square root", () => {
  assert.equal(state.sparkHeight(5000), 1);
  assert.equal(state.sparkHeight(60_000), 1);
  assert.equal(state.sparkHeight(0), 0.08);
  const px = (ms) => Math.max(1, Math.round(state.sparkHeight(ms) * 14));
  assert.deepEqual([px(20), px(200), px(2000)], [1, 3, 9]);
});

test("bars and freshness by their thresholds", () => {
  assert.equal(state.barFraction(5, 0), null);
  assert.equal(state.barFraction(-1, 10), 0);
  assert.equal(state.barFraction(20, 10), 1);
  assert.equal(state.barFraction(5, 20), 0.25);

  assert.equal(state.freshnessTone(37_499, 75_000), "dim");
  assert.equal(state.freshnessTone(37_500, 75_000), "warning");
  assert.equal(state.freshnessTone(75_000, 75_000), "error");
  assert.equal(state.streamFreshness(client().connection, LOCAL).ageMs, 3 * SECOND);
  assert.equal(state.streamFreshness({ ...client().connection, watchdogArmed: false }, LOCAL), null, "no watchdog, no bar");
  assert.equal(state.streamFreshness({ ...client().connection, state: "retrying" }, LOCAL), null);
  assert.equal(state.streamFreshness({ ...client().connection, staleAfterMs: 0 }, LOCAL), null);
});

test("MCP servers, holders and status slots", () => {
  const mcp = (extra) => state.mcpServerTone({ name: "x", scope: "global", state: "connected", hasError: false, released: false, ...extra });
  assert.deepEqual(mcp({}), { tone: "ok", filled: true });
  assert.deepEqual(mcp({ state: "connecting" }), { tone: "warning", filled: false });
  assert.deepEqual(mcp({ state: "needs-auth" }), { tone: "warning", filled: true });
  assert.deepEqual(mcp({ state: "conflict" }), { tone: "error", filled: true });
  assert.deepEqual(mcp({ hasError: true }), { tone: "error", filled: true });
  assert.deepEqual(mcp({ released: true }), { tone: "dim", filled: false });

  assert.equal(state.debugHolderTone(MINE, MINE), "accent");
  assert.equal(state.debugHolderTone(OTHER, MINE), "muted");
  assert.equal(state.debugHolderTone(null, MINE), "dim");
  assert.equal(state.debugHolderLabel(MINE, MINE, t), "this page page-min");
  assert.equal(state.debugHolderLabel(null, MINE, t), "no page id");
  assert.deepEqual(state.thisPageFirst([{ holder: OTHER }, { holder: null }, { holder: MINE }], MINE).map((item) => item.holder), [MINE, OTHER, null]);
  assert.equal(state.holderGroupLabel("SSE", [OTHER, MINE, null], MINE, t), "SSE: 3 (this page 1, other page 2)");

  assert.equal(state.debugStatusState({ awaitingInput: true, running: true, state: "alive" }), "awaiting", "as in the sidebar");
  assert.equal(state.debugStatusState({ awaitingInput: false, running: true, state: "closing" }), "running");
  assert.equal(state.debugStatusState({ awaitingInput: false, running: false, state: "closing" }), "closing");
  for (const key of Object.values(state.DEBUG_STATUS_KEYS)) assert.equal(typeof messages[key], "string", key);
});

test("a session row's tooltip names everything the server holds for it", () => {
  assert.equal(
    state.debugSessionTitle(summary("root", { eventStreams: 1, running: true }), 8 * MINUTE + 30 * SECOND, t),
    "root · alive · running · 1 event streams · reap countdown 8m",
  );
  assert.equal(state.debugSessionTitle(summary("forced", { forcedByStop: true, starts: 3 }), 30 * SECOND, t), "forced · alive · closes in 30s (after Stop) · started 3×");
  assert.equal(state.debugSessionTitle(summary("sub-1", { subagent: true, eventStreams: 2, providers: 1 }), null, t), "sub-1 (subagent) · alive · 2 event streams · 1 liveness providers");
});

// ── Sessions on the server ──

function info(id, extra = {}) {
  return { id, name: id, path: "", cwd: "/work/p1", projectRoot: "/work/p1", projectKey: "/work/p1", created: "", modified: "2026-10-01T00:00:00Z", messageCount: 1, firstMessage: "", ...extra };
}
const sub = (parentSessionId) => ({ relation: { kind: "subagent", parentSessionId, profile: "general", description: "", status: "running" } });

function grouped(catalog, ids, currentId) {
  const byId = new Map(catalog.map((session) => [session.id, session]));
  return state.groupDebugSessions(ids.map((id) => summary(id)), byId, currentId).map((group) => ({
    name: group.name,
    rows: group.rows.map((row) => `${row.depth ? "  " : ""}${row.id}${row.current ? " *" : ""}${row.placeholder ? " (placeholder)" : ""}`),
  }));
}

test("sessions are grouped like the sidebar: the chat's project and family first, subagents under their root", () => {
  const catalog = [
    info("a", { modified: "2026-10-05T00:00:00Z" }),
    info("a1", { ...sub("a"), modified: "2026-10-05T01:00:00Z" }),
    info("a2", { ...sub("a"), modified: "2026-10-05T02:00:00Z" }),
    info("a2x", { ...sub("a2"), modified: "2026-10-05T03:00:00Z" }),
    info("b", { modified: "2026-10-01T00:00:00Z" }),
    info("c", { cwd: "/work/p2/sub", projectRoot: "/work/p2", projectKey: "/work/p2", modified: "2026-10-09T00:00:00Z" }),
    info("d", { cwd: "/work/p3", projectRoot: "/work/p3", projectKey: "/work/p3", modified: "2026-10-03T00:00:00Z" }),
    info("d1", { cwd: "/work/p3", projectRoot: "/work/p3", projectKey: "/work/p3", ...sub("d") }),
    info("e", { cwd: "/work/p4", projectRoot: undefined, projectKey: undefined, modified: "not a date" }),
  ];
  const ids = ["x-unlisted", "a1", "c", "a", "d1", "b", "a2", "a2x", "e"];
  assert.deepEqual(grouped(catalog, ids, "b"), [
    { name: "p1", rows: ["b *", "a", "  a2x", "  a2", "  a1"] },
    { name: "p2", rows: ["c"] },
    { name: "p3", rows: ["d (placeholder)", "  d1"] },
    { name: "p4", rows: ["e"] },
    { name: null, rows: ["x-unlisted"] },
  ]);
  // The chat a subagent: its family leads, the subagent marked.
  assert.deepEqual(grouped(catalog, ["c", "a1", "b"], "a1"), [
    { name: "p1", rows: ["a (placeholder)", "  a1 *", "b"] },
    { name: "p2", rows: ["c"] },
  ]);
  // The chat unlisted (a fresh composer's session): that group first.
  assert.deepEqual(grouped(catalog, ["c", "x-other", "x-new"], "x-new"), [
    { name: null, rows: ["x-new *", "x-other"] },
    { name: "p2", rows: ["c"] },
  ]);
  // Unlisted rows by short id, then the full id, whatever order the server's registry gives.
  for (const ids of [["x-zz", "x-aa"], ["x-aa", "x-zz"]]) {
    assert.deepEqual(grouped(catalog, ["c", ...ids], "b"), [{ name: "p2", rows: ["c"] }, { name: null, rows: ["x-aa", "x-zz"] }], ids.join(", "));
  }
  for (const ids of [["0123456789-b", "0123456789-a", "x-new"], ["x-new", "0123456789-a", "0123456789-b"]]) {
    assert.deepEqual(grouped(catalog, ids, "x-new"), [{ name: null, rows: ["x-new *", "0123456789-a", "0123456789-b"] }], "the current one first; one short id, the full one decides");
  }
  // Nothing held for the chat's family: no row for it.
  assert.deepEqual(grouped(catalog, ["c"], "b"), [{ name: "p2", rows: ["c"] }]);
  assert.deepEqual(grouped(catalog, [], "b"), []);
});

test("parents that point at each other end the walk, and each session keeps one row", () => {
  const catalog = [
    info("f", sub("g")),
    info("g", sub("f")),
    info("h", sub("h")),
    info("k", { ...sub("f"), modified: "2026-10-02T00:00:00Z" }),
  ];
  const groups = grouped(catalog, ["f", "g", "h", "k"], null);
  assert.equal(groups.length, 1);
  const rows = groups[0].rows.map((row) => row.trim());
  assert.equal(new Set(rows).size, rows.length, rows.join(", "));
  assert.deepEqual([...rows].sort(), ["f", "g", "h", "k"]);
  assert.ok(groups[0].rows.every((row) => !row.startsWith(" ")), "a loop makes no family");
});

// ── The poll ──

function fakeFetch() {
  const calls = [];
  const fetch = (url, init) => new Promise((resolve, reject) => {
    const call = {
      url,
      init,
      aborted: false,
      respond(body, { ok = true, status = 200 } = {}) {
        resolve({ ok, status, json: async () => body });
      },
    };
    init.signal.addEventListener("abort", () => {
      call.aborted = true;
      reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    });
    calls.push(call);
  });
  return { fetch, calls };
}

function fakeTimers() {
  const pending = new Set();
  return {
    pending,
    setTimeout(callback, ms) {
      const handle = { callback, ms };
      pending.add(handle);
      return handle;
    },
    clearTimeout(handle) {
      pending.delete(handle);
    },
    fire() {
      for (const handle of [...pending]) {
        pending.delete(handle);
        handle.callback();
      }
    },
  };
}

function setup({ sessionId = "s1", visible = true } = {}) {
  const net = fakeFetch();
  const timers = fakeTimers();
  const readings = [];
  const target = { sessionId, visible };
  let clock = 100;
  const poller = state.createDebugPoller({
    fetch: net.fetch,
    sessionId: () => target.sessionId,
    isVisible: () => target.visible,
    onReading: (reading) => readings.push(reading),
    now: () => clock,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  });
  return { poller, net, timers, readings, target, advance: (ms) => { clock += ms; } };
}

test("the poll asks once at a time, only while visible, and reports the round trip", async () => {
  const { poller, net, timers, readings, target, advance } = setup();
  target.visible = false;
  poller.poll();
  assert.equal(net.calls.length, 0, "a hidden page asks nothing");

  target.visible = true;
  poller.poll();
  poller.poll();
  assert.equal(net.calls.length, 1, "one request in flight");
  assert.equal(net.calls[0].url, "/api/agent/debug?session=s1");
  assert.equal(net.calls[0].init.cache, "no-store");
  assert.equal(poller.inFlightSince(), 100);
  assert.equal(timers.pending.size, 1);

  advance(35);
  net.calls[0].respond(snapshot());
  await flush();
  assert.equal(readings.length, 1);
  assert.equal(readings[0].sessionId, "s1");
  assert.equal(readings[0].roundTripMs, 35);
  assert.equal(readings[0].receivedAt, 135);
  assert.equal(readings[0].failure, null);
  assert.equal(poller.inFlightSince(), null);
  assert.equal(timers.pending.size, 0, "the timeout is cleared");
  assert.deepEqual(state.debugPollSample(readings[0]), { ms: 35, tone: "dim", failed: false });
  poller.dispose();
});

test("no answer in 5 s is reported as a timeout and keeps the last good answer", async () => {
  const { poller, net, timers, readings } = setup();
  poller.poll();
  net.calls[0].respond(snapshot());
  await flush();
  poller.poll();
  assert.equal([...timers.pending][0].ms, state.DEBUG_POLL_TIMEOUT_MS);
  timers.fire();
  await flush();
  assert.equal(net.calls[1].aborted, true);
  assert.equal(readings.length, 2);
  assert.equal(readings[1].failure.kind, "timeout");
  assert.equal(readings[1].reply, readings[0].reply, "the last answer stays on screen");
  assert.equal(readings[1].failures, 1);
  assert.equal(readings[0].consecutiveFailures, 0);
  assert.equal(readings[1].consecutiveFailures, 1);
  assert.equal(state.debugPollSample(readings[1]).failed, true, "a full-height bar in the sparkline");

  poller.poll();
  net.calls[2].respond({ error: "nope" }, { ok: false, status: 500 });
  await flush();
  assert.deepEqual([readings[2].failure.kind, readings[2].failure.status], ["http", 500]);
  poller.poll();
  net.calls[3].respond({ unexpected: true });
  await flush();
  assert.equal(readings[3].failure.kind, "invalid");
  assert.equal(readings[3].consecutiveFailures, 3);
  poller.poll();
  net.calls[4].respond(snapshot());
  await flush();
  assert.deepEqual([readings[4].failure, readings[4].consecutiveFailures, readings[4].failures], [null, 0, 3]);
  poller.dispose();
});

test("a session change aborts the request under way and drops answers about the old session", async () => {
  const { poller, net, readings, target } = setup();
  poller.poll();
  target.sessionId = "s2";
  poller.sync();
  assert.equal(net.calls.length, 2);
  assert.equal(net.calls[0].aborted, true);
  assert.equal(net.calls[1].url, "/api/agent/debug?session=s2");
  poller.sync();
  assert.equal(net.calls.length, 2, "the new session is already asked about");

  // An answer that arrives after the chat moved on (no poll in between) is dropped too.
  target.sessionId = "s3";
  net.calls[1].respond(snapshot());
  await flush();
  assert.equal(readings.length, 0);
  poller.sync();
  assert.equal(net.calls[2].url, "/api/agent/debug?session=s3");
  net.calls[2].respond(snapshot());
  await flush();
  assert.equal(readings.length, 1);
  assert.equal(readings[0].sessionId, "s3");

  target.sessionId = null;
  poller.sync();
  assert.equal(net.calls[3].url, "/api/agent/debug", "no session: the global part only");
  poller.dispose();
});

test("an answer that lands after the panel closed reaches nothing", async () => {
  let release;
  const body = new Promise((resolve) => { release = resolve; });
  const readings = [];
  const poller = state.createDebugPoller({
    fetch: async () => ({ ok: true, status: 200, json: () => body }),
    sessionId: () => "s1",
    isVisible: () => true,
    onReading: (reading) => readings.push(reading),
    setTimeout: () => null,
    clearTimeout: () => {},
  });
  poller.poll();
  await flush();
  poller.dispose();
  release(snapshot());
  await flush();
  assert.equal(readings.length, 0);
  poller.poll();
  assert.equal(readings.length, 0, "a disposed poller asks nothing more");
});

// ── Keyboard ──

test("Escape closes the panel only when nothing nearer took it and no dialog is open", () => {
  const key = (extra = {}) => ({ key: "Escape", defaultPrevented: false, isComposing: false, keyCode: 27, ...extra });
  assert.equal(state.shouldCloseDebugPanelOnEscape(key(), false), true);
  assert.equal(state.shouldCloseDebugPanelOnEscape(key({ defaultPrevented: true }), false), false, "a menu or ChatInput's Stop took it");
  // React's handlers run from `document`, before the panel's listener: one that only stopped it
  // (the sidebar's session search clearing itself) still took it.
  assert.equal(state.shouldCloseDebugPanelOnEscape(key({ cancelBubble: true }), false), false, "a nearer handler stopped it");
  assert.equal(state.shouldCloseDebugPanelOnEscape(key({ isComposing: true }), false), false);
  assert.equal(state.shouldCloseDebugPanelOnEscape(key({ keyCode: 229 }), false), false, "Safari's IME Escape");
  assert.equal(state.shouldCloseDebugPanelOnEscape(key(), true), false, "Settings or a dialog is above");
  assert.equal(state.shouldCloseDebugPanelOnEscape(key({ key: "Enter" }), false), false);
});

test("the Escape that closes the panel says whether focus was inside it", () => {
  const element = (name) => ({ name });
  const copyButton = element("copy");
  const composer = element("composer");
  const section = { contains: (other) => other === copyButton };
  const doc = { activeElement: copyButton, dialog: null, querySelector: (selector) => (selector === '[aria-modal="true"]' ? doc.dialog : null) };
  const closes = [];
  const listener = state.createDebugPanelEscapeListener(doc, () => section, (restoreFocus) => closes.push(restoreFocus));
  const escape = (extra = {}) => {
    const event = { key: "Escape", defaultPrevented: false, cancelBubble: false, isComposing: false, keyCode: 27, ...extra };
    event.preventDefault = () => { event.defaultPrevented = true; };
    listener(event);
    return event;
  };

  assert.equal(escape().defaultPrevented, true, "taken, so the window's Stop skips it");
  doc.activeElement = composer;
  escape();
  doc.activeElement = null;
  escape();
  assert.deepEqual(closes, [true, false, false], "only focus inside the panel goes back to the Debug button");

  doc.dialog = element("settings");
  assert.equal(escape().defaultPrevented, false, "a dialog above keeps it");
  doc.dialog = null;
  escape({ cancelBubble: true });
  escape({ key: "Enter" });
  assert.equal(closes.length, 3);

  // Before the panel's element is there, nothing is inside it.
  const early = [];
  doc.activeElement = copyButton;
  state.createDebugPanelEscapeListener(doc, () => null, (restoreFocus) => early.push(restoreFocus))({ key: "Escape", defaultPrevented: false, preventDefault() {} });
  assert.deepEqual(early, [false]);
});

test("codes the server sends read as words where the panel knows them, else as they came", () => {
  assert.equal(state.translateDebugCode("queued", state.DEBUG_RUN_STATUS_KEYS, t), "Queued");
  assert.equal(state.translateDebugCode("running", state.DEBUG_RUN_STATUS_KEYS, t), "Running");
  assert.equal(state.translateDebugCode("unknown", state.DEBUG_RUN_STATUS_KEYS, t), "unknown");
  assert.equal(state.translateDebugCode("set_tools", state.DEBUG_CLOSE_REASON_KEYS, t), "tools changed");
  assert.equal(state.translateDebugCode("paused", state.DEBUG_RUN_STATUS_KEYS, t), "paused", "a status newer than the map");
  assert.equal(state.translateDebugCode("toString", state.DEBUG_RUN_STATUS_KEYS, t), "toString", "only the map's own keys");
});

test("every key chosen at run time is translated", () => {
  for (const map of [
    state.DEBUG_STREAM_STATE_KEYS,
    state.DEBUG_STREAM_ERROR_KEYS,
    state.DEBUG_REATTACH_REASON_KEYS,
    state.DEBUG_SOURCE_KIND_KEYS,
    state.DEBUG_SOURCE_STATE_KEYS,
    state.DEBUG_LEASE_OUTCOME_KEYS,
    state.DEBUG_SESSION_STATE_KEYS,
    state.DEBUG_EXTENSIONS_KEYS,
    state.DEBUG_POLL_FAILURE_KEYS,
    state.DEBUG_RUN_STATUS_KEYS,
    state.DEBUG_CLOSE_REASON_KEYS,
    state.DEBUG_STATUS_KEYS,
  ]) {
    for (const key of Object.values(map)) assert.equal(typeof messages[key], "string", key);
  }
  assert.match(messages["debug.poll.http"], /\{status\}/);
});
