import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

// Opening a session while a long tool runs: the stream replays the running tool,
// then the mount's state read arrives. It reports only isStreaming, which cannot
// say what the run is waiting on, so it must not replace the running tool with
// "waiting for model" — the tool can run for minutes and sends no further events.
const shimPath = fileURLToPath(new URL("./__fixtures__/react-hook-shim.mjs", import.meta.url));
const jiti = createJiti(import.meta.url, { tsconfigPaths: true, alias: { react: shimPath } });
const { renderHook } = await import(shimPath);
const { useAgentSession } = await jiti.import("./useAgentSession.ts");

globalThis.document ??= Object.assign(new EventTarget(), { visibilityState: "visible" });
globalThis.window ??= new EventTarget();

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

test("a replayed running tool keeps its phase when the mount's state read lands", async () => {
  const sessionRead = Promise.withResolvers();
  const stateRead = Promise.withResolvers();
  globalThis.EventSource = class {
    readyState = 0;
    onmessage = null;
    onerror = null;
    close() { this.readyState = 2; }
  };
  globalThis.fetch = async (url, init = {}) => {
    const command = init.body ? JSON.parse(init.body) : null;
    if (url.startsWith("/api/models")) return json({ models: {}, modelList: [] });
    if (url.startsWith("/api/sessions/s1?")) return sessionRead.promise;
    if (url === "/api/sessions/s1/state") return stateRead.promise;
    if (url === "/api/agent/s1" && command) return json({ success: true, data: [] });
    if (url === "/api/agent/s1") return json({ running: true, state: { isStreaming: true } });
    throw new Error(`unexpected fetch ${url} ${init.body ?? ""}`);
  };

  const hook = renderHook(useAgentSession, { session: { id: "s1", name: "S", cwd: "/project" } });
  // The running state's reconcile interval would otherwise keep the runner alive.
  try {
    await settle();
    hook.flush();

    // 1. The stream connects mid-run and replays the call that is running.
    hook.result.handleAgentEventRef.current({ type: "connected", isStreaming: true });
    hook.result.handleAgentEventRef.current(runningCodemode);
    hook.flush();
    assert.equal(hook.result.agentPhase?.kind, "running_tools");

    // 2. The mount's own state read lands afterwards, reporting only isStreaming.
    sessionRead.resolve(json(sessionData));
    await settle();
    hook.flush();
    stateRead.resolve(json({ running: true, state: { isStreaming: true, isPromptRunning: false } }));
    await settle();
    hook.flush();

    assert.equal(hook.result.agentRunning, true);
    assert.equal(hook.result.agentPhase?.kind, "running_tools");
    assert.deepEqual(hook.result.agentPhase?.tools.map((tool) => tool.name), ["codemode"]);
  } finally {
    hook.unmount();
  }
});
