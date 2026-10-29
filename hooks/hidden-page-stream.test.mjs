import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createJiti } from "jiti";

// A page hidden for HIDDEN_PAGE_GRACE_MS lets go of the selected session's idle
// event stream (#1283): over HTTP/1.1 every open stream holds one of the
// browser's six connections per origin, shared by all tabs. The page's lease
// request, renewed every 30 s either way, resets the session's idle countdown and
// says what is under way in it:
// a run, an extension dialog or a subagent left to finish keeps the stream, and
// opens a released one again while the page is still hidden. The page's return
// reopens it and shows what the server has under way.
const shimPath = fileURLToPath(new URL("./__fixtures__/react-hook-shim.mjs", import.meta.url));
const jiti = createJiti(import.meta.url, { tsconfigPaths: true, alias: { react: shimPath } });
const { renderHook } = await import(pathToFileURL(shimPath).href);
const { peekPageId, useAgentSession } = await jiti.import("./useAgentSession.ts");
const { HIDDEN_PAGE_GRACE_MS } = await jiti.import("./usePageHidden.ts");
// useAgentSession's SESSION_LEASE_RENEW_INTERVAL_MS.
const SESSION_LEASE_RENEW_MS = 30_000;
const {
  canReleaseHiddenEventStream,
  SESSION_LEASE_TIMEOUT_MS,
  sessionLeaseShowsActivity,
} = await jiti.import("../lib/agent-event-connection.ts");

const page = Object.assign(new EventTarget(), { visibilityState: "visible" });
globalThis.document = page;
globalThis.window ??= new EventTarget();

const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
const settle = async () => { for (let index = 0; index < 10; index++) await new Promise((resolve) => setImmediate(resolve)); };
const setVisibility = (state) => {
  page.visibilityState = state;
  page.dispatchEvent(new Event("visibilitychange"));
};

async function setup() {
  mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const sources = [];
  const requests = [];
  // What the lease reply (busy, awaitingInput, subagentsActive) and the session's
  // state read (state) report; tests change it. `answer` turns the lease request
  // into one that never answers (it only ends when aborted), a network failure,
  // an HTTP error or an ok reply whose body is null.
  const server = {
    busy: false,
    awaitingInput: false,
    subagentsActive: false,
    state: { isStreaming: false, isPromptRunning: false },
    answer: "json",
  };
  globalThis.EventSource = class {
    readyState = 0;
    onmessage = null;
    onerror = null;
    constructor(url) { this.url = url; sources.push(this); }
    close() { this.readyState = 2; }
    emit(event) {
      this.readyState = 1;
      this.onmessage?.({ data: JSON.stringify(event) });
    }
  };
  globalThis.fetch = async (requestUrl, init = {}) => {
    // Status reads (agentStatusUrl()) leave out the system prompt; same route.
    const url = requestUrl === "/api/agent/s1?systemPrompt=0" ? "/api/agent/s1" : requestUrl;
    requests.push(url);
    if (url.startsWith("/api/models")) return json({ models: {}, modelList: [] });
    if (url.startsWith("/api/sessions/s1?")) {
      return json({ filePath: "/s1.jsonl", leafId: null, tree: [], treeFormat: "summary", context: { messages: [], entryIds: [], oldestEntryId: null, hasMore: false } });
    }
    if (url === "/api/sessions/s1/state") return json({ running: true, state: server.state });
    if (url === "/api/agent/s1/lease") {
      if (server.answer === "never") {
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
        });
      }
      if (server.answer === "offline") throw new TypeError("Failed to fetch");
      if (server.answer === "error") return new Response("boom", { status: 500 });
      if (server.answer === "null") return json(null);
      return json({ success: true, running: server.busy, awaitingInput: server.awaitingInput, subagentsActive: server.subagentsActive });
    }
    if (url === "/api/agent/s1" && init.body) return json({ success: true, data: null });
    if (url === "/api/agent/s1") return json({ running: true, state: server.state });
    return json({});
  };
  const ends = [];
  // The debug panel's reader, as the hook registers it.
  let reader = null;
  const hook = renderHook(useAgentSession, {
    session: { id: "s1", cwd: "/project", path: "/s1.jsonl", name: "s1" },
    onAgentEnd: (end) => ends.push(end),
    onDebugSnapshotReaderChange: (next) => { reader = next; },
  });
  await settle();
  hook.flush();
  const open = () => sources.filter((source) => source.readyState !== 2);
  // Lease requests since hiding: the renewal tick and the release check share one.
  let mark = 0;
  const hide = () => { mark = requests.length; setVisibility("hidden"); };
  const checks = () => requests.slice(mark).filter((url) => url === "/api/agent/s1/lease").length;
  const reads = () => requests.filter((url) => url.startsWith("/api/sessions/s1?")).length;
  const tick = async (ms) => { mock.timers.tick(ms); await settle(); hook.flush(); };
  const read = () => reader?.() ?? null;
  return { hook, sources, requests, server, open, checks, reads, ends, tick, hide, read };
}

async function teardown(state) {
  setVisibility("visible");
  state.hook.unmount();
  for (const source of state.sources) source.close();
  mock.timers.reset();
  await settle();
}

async function connectIdle(state, extra = {}) {
  state.open()[0].emit({ type: "connected", sessionId: "s1", isStreaming: false, ...extra });
  await settle();
  state.hook.flush();
}

test("a page hidden past the grace closes the idle stream and its return reopens it", async () => {
  const state = await setup();
  try {
    await connectIdle(state);
    state.hide();
    await state.tick(HIDDEN_PAGE_GRACE_MS - 1);
    assert.equal(state.open().length, 1, "the grace keeps it");
    await state.tick(1);
    assert.equal(state.open().length, 0, "the hidden page holds no agent stream");
    await state.tick(HIDDEN_PAGE_GRACE_MS * 3);
    assert.equal(state.open().length, 0, "nothing reopens it while hidden");

    const reads = state.reads();
    setVisibility("visible");
    assert.equal(state.open().length, 1, "the page's return opens the stream again");
    await settle();
    assert.equal(state.reads(), reads + 1, "and reads the session it may have missed");
    assert.equal(state.sources.length, 2);
  } finally {
    await teardown(state);
  }
});

test("the page renews the session the whole time, with or without its stream", async () => {
  const state = await setup();
  try {
    const holds = () => state.requests.filter((url) => url === "/api/agent/s1/lease").length;
    assert.equal(holds(), 1, "sent as soon as the session is selected");
    await connectIdle(state);
    await state.tick(SESSION_LEASE_RENEW_MS);
    assert.equal(holds(), 2);

    state.hide();
    await state.tick(HIDDEN_PAGE_GRACE_MS);
    assert.equal(state.open().length, 0);
    const atRelease = holds();
    for (let index = 0; index < 4; index++) await state.tick(SESSION_LEASE_RENEW_MS);
    assert.equal(holds(), atRelease + 4, "renewed while the page stays away, so the idle wrapper is not reaped");

    setVisibility("visible");
    await settle();
    assert.equal(holds(), atRelease + 5, "coming back renews at once");
    assert.equal(state.open().length, 1);
  } finally {
    await teardown(state);
  }
});

test("a quick tab switch keeps the stream and reads nothing", async () => {
  const state = await setup();
  try {
    await connectIdle(state);
    const reads = state.reads();
    state.hide();
    await state.tick(HIDDEN_PAGE_GRACE_MS / 2);
    setVisibility("visible");
    await state.tick(HIDDEN_PAGE_GRACE_MS * 2);
    assert.equal(state.sources.length, 1);
    assert.equal(state.open().length, 1);
    assert.equal(state.reads(), reads);
  } finally {
    await teardown(state);
  }
});

test("a subagent left to finish keeps the stream, checked again each grace", async () => {
  const state = await setup();
  try {
    await connectIdle(state);
    state.server.subagentsActive = true;
    state.hide();
    await state.tick(HIDDEN_PAGE_GRACE_MS);
    assert.equal(state.checks(), 1);
    assert.equal(state.open().length, 1, "its end starts a turn here");
    await state.tick(HIDDEN_PAGE_GRACE_MS);
    assert.equal(state.checks(), 2);
    assert.equal(state.open().length, 1);
    state.server.subagentsActive = false;
    await state.tick(HIDDEN_PAGE_GRACE_MS);
    assert.equal(state.open().length, 0);
  } finally {
    await teardown(state);
  }
});

test("a check that never answers (queued behind a full pool) releases once it times out", async () => {
  const state = await setup();
  try {
    await connectIdle(state);
    state.server.answer = "never";
    state.hide();
    await state.tick(HIDDEN_PAGE_GRACE_MS);
    assert.equal(state.checks(), 1);
    assert.equal(state.open().length, 1, "still waiting for the answer");
    await state.tick(SESSION_LEASE_TIMEOUT_MS);
    assert.equal(state.open().length, 0, "no answer in time reads as a starved pool");
    assert.equal(state.checks(), 1);
  } finally {
    await teardown(state);
  }
});

test("no network releases; an error reply keeps the stream and checks again", async () => {
  const offline = await setup();
  try {
    await connectIdle(offline);
    offline.server.answer = "offline";
    offline.hide();
    await offline.tick(HIDDEN_PAGE_GRACE_MS);
    assert.equal(offline.open().length, 0);
  } finally {
    await teardown(offline);
  }
  const failing = await setup();
  try {
    await connectIdle(failing);
    failing.server.answer = "error";
    failing.hide();
    await failing.tick(HIDDEN_PAGE_GRACE_MS);
    assert.equal(failing.open().length, 1);
    failing.server.answer = "json";
    await failing.tick(HIDDEN_PAGE_GRACE_MS);
    assert.equal(failing.checks(), 2);
    assert.equal(failing.open().length, 0);
  } finally {
    await teardown(failing);
  }
});

test("a running session keeps its stream while hidden and lets go a grace after it settles", async () => {
  const state = await setup();
  try {
    const source = state.open()[0];
    source.emit({ type: "connected", sessionId: "s1", isStreaming: true });
    await settle();
    state.hook.flush();
    assert.equal(state.hook.result.agentRunning, true);

    state.hide();
    await state.tick(HIDDEN_PAGE_GRACE_MS * 2);
    assert.deepEqual(state.open(), [source], "the run's events still arrive");

    source.emit({ type: "agent_settled" });
    assert.equal(state.ends.length, 1, "the completion reaches the page through the stream");
    await settle();
    state.hook.flush();
    assert.equal(state.hook.result.agentRunning, false);
    assert.deepEqual(state.open(), [source], "a follow-up right after it still arrives");
    await state.tick(HIDDEN_PAGE_GRACE_MS);
    assert.equal(state.open().length, 0, "the settled session's stream is let go");
  } finally {
    await teardown(state);
  }
});

test("the server's own run at the end of the grace keeps the stream", async () => {
  const state = await setup();
  try {
    await connectIdle(state);
    // A session opened in a background tab whose run the page has not seen yet.
    state.server.busy = true;
    state.hide();
    await state.tick(HIDDEN_PAGE_GRACE_MS);
    assert.equal(state.checks(), 1);
    assert.equal(state.open().length, 1);
  } finally {
    await teardown(state);
  }
});

test("the return shows a command, a ! command and a compaction the server has under way", async () => {
  const state = await setup();
  try {
    await connectIdle(state);
    state.hide();
    await state.tick(HIDDEN_PAGE_GRACE_MS);
    assert.equal(state.open().length, 0);

    state.server.state = { isStreaming: false, isPromptRunning: true, isBashRunning: true, isCompacting: true };
    setVisibility("visible");
    await settle();
    state.hook.flush();
    assert.equal(state.hook.result.agentRunning, true);
    assert.equal(state.hook.result.agentPhase?.kind, "running_command");
    assert.equal(state.hook.result.bashRunning, true);
    assert.equal(state.hook.result.isCompacting, true);
  } finally {
    await teardown(state);
  }
});

test("a pending extension dialog keeps the stream of a hidden page", async () => {
  const state = await setup();
  try {
    await connectIdle(state, { pendingExtensionUiIds: [] });
    const source = state.open()[0];
    source.emit({ type: "extension_ui_request", id: "ui-1", method: "confirm", title: "Proceed?", message: "" });
    await settle();
    state.hook.flush();
    assert.equal(state.hook.result.extensionDialog?.id, "ui-1");

    state.hide();
    await state.tick(HIDDEN_PAGE_GRACE_MS * 2);
    assert.deepEqual(state.open(), [source], "the page keeps it without asking");
  } finally {
    await teardown(state);
  }
});

test("a released page opens the stream again while hidden once a run starts there, and lets go after it", async () => {
  const state = await setup();
  try {
    await connectIdle(state);
    state.hide();
    await state.tick(HIDDEN_PAGE_GRACE_MS);
    assert.equal(state.open().length, 0);
    await state.tick(SESSION_LEASE_RENEW_MS);
    assert.equal(state.open().length, 0, "an idle reply keeps it closed");

    // An extension timer, another tab or device starts a run in the session.
    state.server.busy = true;
    state.server.state = { isStreaming: true, isPromptRunning: true };
    const reads = state.reads();
    await state.tick(SESSION_LEASE_RENEW_MS);
    assert.equal(state.open().length, 1, "the next renewal sees the run and opens the stream");
    assert.equal(state.reads(), reads + 1, "and reads what the page missed");
    assert.equal(state.hook.result.agentRunning, true);

    const source = state.open()[0];
    source.emit({ type: "connected", sessionId: "s1", isStreaming: true });
    await settle();
    // A prompt run ends as the wrapper reports it to every stream: the agent
    // settles, then the prompt resolves.
    source.emit({ type: "agent_settled" });
    source.emit({ type: "prompt_done" });
    await settle();
    state.hook.flush();
    assert.equal(state.ends.length, 1, "the completion reaches the hidden page, chime and notification included");

    state.server.busy = false;
    state.server.state = { isStreaming: false, isPromptRunning: false };
    await state.tick(HIDDEN_PAGE_GRACE_MS);
    assert.equal(state.open().length, 0, "let go a grace after the run settles");
  } finally {
    await teardown(state);
  }
});

test("a released page opens the stream again for an extension dialog, and lets go once nothing is under way", async () => {
  const state = await setup();
  try {
    await connectIdle(state);
    state.hide();
    await state.tick(HIDDEN_PAGE_GRACE_MS);
    assert.equal(state.open().length, 0);

    state.server.awaitingInput = true;
    await state.tick(SESSION_LEASE_RENEW_MS);
    assert.equal(state.open().length, 1, "the dialog is replayed through the stream");

    // Answered on another device before this page saw it: nothing keeps the stream.
    state.server.awaitingInput = false;
    state.open()[0].emit({ type: "connected", sessionId: "s1", isStreaming: false });
    await settle();
    state.hook.flush();
    await state.tick(HIDDEN_PAGE_GRACE_MS);
    assert.equal(state.open().length, 0, "the reopen arms the grace again");
  } finally {
    await teardown(state);
  }
});

// The debug panel reads the page's side on its own clock. The reader must
// describe the stream and the lease, never be one more request, source or timer.
test("the debug reader asks nothing and opens nothing, however often it reads", async () => {
  const state = await setup();
  try {
    let snapshot = state.read();
    assert.equal(snapshot.connection.state, "connecting");
    await connectIdle(state);
    const requests = state.requests.length;
    for (let index = 0; index < 50; index++) snapshot = state.read();
    assert.equal(state.requests.length, requests, "no request");
    assert.equal(state.sources.length, 1, "no source");
    assert.equal(snapshot.sessionId, "s1");
    assert.equal(snapshot.selectedSessionId, "s1");
    assert.equal(snapshot.mounted, true);
    assert.equal(snapshot.wantsStream, true);
    assert.equal(snapshot.connection.state, "connected");
    assert.equal(snapshot.connection.opens, 1);
    assert.deepEqual(snapshot.run, { agentRunning: false, bashRunning: false, compacting: false, dialogs: 0 });

    const pageId = peekPageId();
    assert.match(pageId, /^[\w-]+$/);
    assert.equal(snapshot.pageId, pageId);
    assert.equal(state.sources[0].url, `/api/agent/s1/events?holder=${encodeURIComponent(pageId)}`, "the stream is labelled with the page's id");
    assert.ok(state.requests.includes("/api/agent/s1/lease"), "the lease request carries no page id");
    assert.ok(!state.requests.some((url) => url.startsWith("/api/agent/s1/lease?")));
    // A Fast Refresh evaluates the module again; the page, and its open stream, keep their id.
    const reloaded = await createJiti(import.meta.url, { tsconfigPaths: true, alias: { react: shimPath }, moduleCache: false })
      .import("./useAgentSession.ts");
    assert.equal(reloaded.peekPageId(), pageId);
    assert.equal(snapshot.lease.requests, 1);
    assert.equal(snapshot.lease.inFlightSince, null);
    assert.equal(snapshot.lease.renewIntervalMs, SESSION_LEASE_RENEW_MS);
    assert.equal(typeof snapshot.lease.renewStartedAt, "number");
    assert.equal(snapshot.lease.last.outcome, "reply");
    assert.equal(snapshot.lease.last.httpStatus, 200);
    assert.deepEqual(snapshot.lease.last.reply, { running: false, awaitingInput: false, subagentsActive: false });

    // Reading all through the grace moves neither the release nor its check.
    state.hide();
    assert.equal(typeof state.read().hiddenReleaseDueAt, "number");
    for (let index = 0; index < 20; index++) state.read();
    await state.tick(HIDDEN_PAGE_GRACE_MS - 1);
    for (let index = 0; index < 20; index++) state.read();
    assert.equal(state.open().length, 1);
    assert.equal(state.checks(), 0);
    await state.tick(1);
    assert.equal(state.open().length, 0, "released on time");
    assert.equal(state.checks(), 1, "after the one check of its own");

    snapshot = state.read();
    assert.equal(snapshot.released.active, true);
    assert.equal(snapshot.released.count, 1);
    assert.equal(typeof snapshot.released.lastAt, "number");
    assert.equal(snapshot.hiddenReleaseDueAt, null);
    assert.equal(snapshot.wantsStream, false);
    assert.equal(snapshot.connection.state, "idle");
    assert.equal(snapshot.connection.lastClose.reason, "released");
    assert.equal(snapshot.lease.requests, 2);

    const released = state.requests.length;
    for (let index = 0; index < 20; index++) state.read();
    assert.equal(state.requests.length, released);
    assert.equal(state.open().length, 0, "reading a released page reopens nothing");

    setVisibility("visible");
    await settle();
    snapshot = state.read();
    assert.equal(state.open().length, 1);
    assert.equal(snapshot.released.active, false);
    assert.equal(snapshot.released.count, 1);
    assert.equal(snapshot.reattached.count, 1);
    assert.equal(snapshot.reattached.lastReason, "visible");
    assert.equal(snapshot.connection.opens, 2);
  } finally {
    await teardown(state);
  }
  assert.equal(state.read(), null, "unmounting takes the reader back");
});

test("the debug reader shows each lease outcome; an error reply keeps the stream", async () => {
  const never = await setup();
  try {
    await connectIdle(never);
    never.server.answer = "never";
    never.hide();
    await never.tick(HIDDEN_PAGE_GRACE_MS);
    let lease = never.read().lease;
    assert.equal(typeof lease.inFlightSince, "number", "the check waits for its answer");
    assert.equal(lease.requests, 2);
    await never.tick(SESSION_LEASE_TIMEOUT_MS);
    lease = never.read().lease;
    assert.equal(lease.inFlightSince, null);
    assert.equal(lease.unanswered, 1);
    assert.equal(lease.errors, 0);
    assert.deepEqual({ ...lease.last, at: 0, durationMs: 0 }, { at: 0, durationMs: 0, outcome: "unanswered", httpStatus: null, reply: null });
    assert.equal(never.read().released.count, 1);
  } finally {
    await teardown(never);
  }

  const offline = await setup();
  try {
    await connectIdle(offline);
    offline.server.answer = "offline";
    offline.hide();
    await offline.tick(HIDDEN_PAGE_GRACE_MS);
    const { lease, released } = offline.read();
    assert.equal(lease.last.outcome, "unanswered");
    assert.equal(lease.last.httpStatus, null);
    assert.equal(lease.unanswered, 1);
    assert.equal(released.count, 1);
  } finally {
    await teardown(offline);
  }

  for (const answer of ["error", "null"]) {
    const failing = await setup();
    try {
      await connectIdle(failing);
      failing.server.answer = answer;
      failing.hide();
      await failing.tick(HIDDEN_PAGE_GRACE_MS);
      const snapshot = failing.read();
      assert.equal(failing.open().length, 1, `${answer}: the stream stays`);
      assert.equal(snapshot.lease.last.outcome, "error", answer);
      assert.equal(snapshot.lease.last.httpStatus, answer === "error" ? 500 : 200, answer);
      assert.equal(snapshot.lease.last.reply, null, answer);
      assert.equal(snapshot.lease.errors, 1, answer);
      assert.equal(snapshot.lease.unanswered, 0, answer);
      assert.equal(snapshot.released.count, 0, answer);
      assert.equal(typeof snapshot.hiddenReleaseDueAt, "number", `${answer}: checked again next grace`);
    } finally {
      await teardown(failing);
    }
  }
});

test("the debug reader counts a reopen for activity apart from one for the page's return", async () => {
  const state = await setup();
  try {
    await connectIdle(state);
    state.hide();
    await state.tick(HIDDEN_PAGE_GRACE_MS);
    assert.equal(state.read().released.count, 1);

    state.server.busy = true;
    state.server.state = { isStreaming: true, isPromptRunning: true };
    await state.tick(SESSION_LEASE_RENEW_MS);
    let snapshot = state.read();
    assert.equal(state.open().length, 1);
    assert.equal(snapshot.released.active, false);
    assert.equal(snapshot.reattached.count, 1);
    assert.equal(snapshot.reattached.lastReason, "activity");
    assert.deepEqual(snapshot.lease.last.reply, { running: true, awaitingInput: false, subagentsActive: false });
    assert.equal(snapshot.run.agentRunning, true);

    setVisibility("visible");
    await settle();
    snapshot = state.read();
    assert.equal(snapshot.reattached.count, 1, "the return of a page holding its stream reopens nothing");
    assert.equal(snapshot.reattached.lastReason, "activity");
  } finally {
    await teardown(state);
  }
});

test("only a lease reply with nothing under way releases; any activity reopens", () => {
  assert.equal(canReleaseHiddenEventStream({ running: false, awaitingInput: false, subagentsActive: false }), true);
  for (const busy of ["running", "awaitingInput", "subagentsActive"]) {
    assert.equal(canReleaseHiddenEventStream({ [busy]: true }), false, busy);
    assert.equal(sessionLeaseShowsActivity({ [busy]: true }), true, busy);
  }
  assert.equal(canReleaseHiddenEventStream(null), false, "an error reply keeps the stream");
  assert.equal(canReleaseHiddenEventStream("unanswered"), true, "no answer in time (a starved pool) or no network releases");
  assert.equal(sessionLeaseShowsActivity("unanswered"), false, "and reopens nothing");
  assert.equal(sessionLeaseShowsActivity(null), false);
});
