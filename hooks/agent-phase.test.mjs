import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createJiti } from "jiti";

// Opening a session while a long tool runs: the stream replays the running tool,
// then the mount's state read arrives. It reports only isStreaming, which cannot
// say what the run is waiting on, so it must not replace the running tool with
// "waiting for model" — the tool can run for minutes and sends no further events.
// `connected` is another matter: the server replays every call still running
// right after it, so it starts from none and the replay is the whole list.
const shimPath = fileURLToPath(new URL("./__fixtures__/react-hook-shim.mjs", import.meta.url));
const jiti = createJiti(import.meta.url, { tsconfigPaths: true, alias: { react: shimPath } });
const { renderHook } = await import(pathToFileURL(shimPath).href);
const { useAgentSession } = await jiti.import("./useAgentSession.ts");

globalThis.document ??= Object.assign(new EventTarget(), { visibilityState: "visible" });
globalThis.window ??= new EventTarget();

// useAgentSession's EVENT_STREAM_RECONNECT_DELAY_MS.
const RECONNECT_DELAY_MS = 1_000;

const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
const settle = async () => { for (let index = 0; index < 10; index++) await new Promise((resolve) => setImmediate(resolve)); };

const sessionData = {
  sessionId: "s1",
  filePath: "",
  totalActiveMs: 0,
  tree: [],
  leafId: null,
  context: {
    messages: [], entryIds: [], oldestEntryId: null, hasMore: false, turnsBefore: 0,
    thinkingLevel: "off", model: null,
  },
};

// What a reconnecting client receives for a call that is still running.
const runningCodemode = {
  type: "tool_execution_update",
  toolCallId: "call_1",
  toolName: "codemode",
  partialResult: {
    content: [],
    details: { calls: [{ id: "call_1/1", name: "bash", args: "{\"command\":\"sleep 600\"}", status: "running" }] },
  },
};

async function setup() {
  mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const sources = [];
  const stateRead = Promise.withResolvers();
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
  globalThis.fetch = async (url, init = {}) => {
    if (url.startsWith("/api/models")) return json({ models: {}, modelList: [] });
    if (url.startsWith("/api/sessions/s1?")) return json(sessionData);
    if (url === "/api/sessions/s1/state") return stateRead.promise;
    if (url.startsWith("/api/agent/s1/lease?holder=")) return json({ success: true, running: true, awaitingInput: false, subagentsActive: false });
    if (url === "/api/agent/s1" && init.body) return json({ success: true, data: [] });
    if (url.startsWith("/api/agent/s1")) return json({ running: true, state: { isStreaming: true } });
    throw new Error(`unexpected fetch ${url} ${init.body ?? ""}`);
  };

  const hook = renderHook(useAgentSession, { session: { id: "s1", name: "S", cwd: "/project" } });
  await settle();
  hook.flush();
  const stream = () => sources.find((source) => source.readyState !== 2);
  const emit = async (...events) => {
    for (const event of events) stream().emit(event);
    await settle();
    hook.flush();
  };
  // The mount's own state read, reporting only that the run streams.
  const landStateRead = async () => {
    stateRead.resolve(json({ running: true, state: { isStreaming: true, isPromptRunning: false } }));
    await settle();
    hook.flush();
  };
  // The stream breaks and the connection opens a new one after its delay.
  const reconnect = async () => {
    const broken = stream();
    broken.onerror?.();
    mock.timers.tick(RECONNECT_DELAY_MS);
    await settle();
    hook.flush();
    assert.notEqual(stream(), broken, "a new stream opened");
  };
  const phase = () => hook.result.agentPhase;
  const toolNames = () => phase()?.tools?.map((tool) => tool.name);
  return { hook, emit, landStateRead, reconnect, phase, toolNames };
}

function teardown(state) {
  state.hook.unmount();
  mock.timers.reset();
}

test("a replayed running tool keeps its phase when the mount's state read lands", async () => {
  const state = await setup();
  try {
    // 1. The stream connects mid-run and replays the call that is running.
    await state.emit({ type: "connected", sessionId: "s1", isStreaming: true }, runningCodemode);
    assert.equal(state.phase()?.kind, "running_tools");

    // 2. The mount's own state read lands afterwards, reporting only isStreaming.
    await state.landStateRead();

    assert.equal(state.hook.result.agentRunning, true);
    assert.equal(state.phase()?.kind, "running_tools");
    assert.deepEqual(state.toolNames(), ["codemode"]);
  } finally {
    teardown(state);
  }
});

test("a state read that lands before the stream connects is followed by the replay", async () => {
  const state = await setup();
  try {
    await state.landStateRead();
    assert.deepEqual(state.phase(), { kind: "waiting_model" });

    await state.emit({ type: "connected", sessionId: "s1", isStreaming: true }, runningCodemode);
    assert.equal(state.phase()?.kind, "running_tools");
    assert.deepEqual(state.toolNames(), ["codemode"]);
  } finally {
    teardown(state);
  }
});

test("a reconnect lists only the calls the server replays, not one that ended while the stream was down", async () => {
  const state = await setup();
  try {
    await state.emit(
      { type: "connected", sessionId: "s1", isStreaming: true },
      { type: "tool_execution_start", toolCallId: "call_1", toolName: "bash" },
    );
    await state.landStateRead();
    assert.deepEqual(state.toolNames(), ["bash"]);

    // bash ended and the model called read while the stream was down: its end
    // never reached the page, and the replay holds read alone.
    await state.reconnect();
    await state.emit(
      { type: "connected", sessionId: "s1", isStreaming: true },
      { type: "tool_execution_start", toolCallId: "call_2", toolName: "read" },
    );
    assert.deepEqual(state.toolNames(), ["read"]);

    // Nothing running at the next reconnect: the model is answering.
    await state.reconnect();
    await state.emit({ type: "connected", sessionId: "s1", isStreaming: true });
    assert.deepEqual(state.phase(), { kind: "waiting_model" });
  } finally {
    teardown(state);
  }
});
