import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const shimPath = fileURLToPath(new URL("./__fixtures__/react-hook-shim.mjs", import.meta.url));
const jiti = createJiti(import.meta.url, { tsconfigPaths: true, alias: { react: shimPath } });
const { renderHook } = await import(shimPath);
const { useAgentSession } = await jiti.import("./useAgentSession.ts");

const session = (id, relation) => ({ id, cwd: "/work", path: `/work/${id}.jsonl`, relation });
const json = (body) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
const view = (id) => ({ sessionId: id, tree: [], leafId: null, totalActiveMs: 0, context: { messages: [], entryIds: [], oldestEntryId: null, hasMore: false, thinkingLevel: "off", model: null } });
let state;
let stateAnswer;
let stateRequests;
let sources;
const mounted = [];
const requests = [];

class FakeEventSource {
  readyState = 1;
  onmessage = null;
  onerror = null;
  constructor(url) { this.url = url; sources.push(this); }
  close() { this.readyState = 2; }
  emit(event) { this.onmessage?.({ data: JSON.stringify(event) }); }
}

test.beforeEach(() => {
  state = { completionId: "100", isStreaming: false, isPromptRunning: false };
  stateAnswer = null;
  stateRequests = 0;
  sources = [];
  globalThis.window = Object.assign(new EventTarget(), { localStorage: { getItem: () => null, setItem() {}, removeItem() {} } });
  globalThis.document = Object.assign(new EventTarget(), { visibilityState: "visible", title: "", querySelector: () => null });
  globalThis.EventSource = FakeEventSource;
  globalThis.fetch = async (url, init = {}) => {
    url = String(url);
    requests.push(url);
    if (url.includes("/lease?")) return json({ running: false });
    if (/\/api\/sessions\/[^/?]+\?/.test(url)) return json(view(url.split("/")[3].split("?")[0]));
    if (url.includes("/state") || (/\/api\/agent\/[^/?]+/.test(url) && init.method !== "POST")) {
      stateRequests++;
      return stateAnswer ? stateAnswer() : json({ running: true, state: { ...state } });
    }
    if (url.startsWith("/api/models")) return json({ models: [], modelList: [], defaultModel: null });
    if (init.method === "POST") {
      const command = JSON.parse(init.body);
      if (command.type === "get_state") return json({ success: true, data: { ...state } });
      return json({ success: true, data: [] });
    }
    return json({});
  };
});

test.afterEach(() => {
  for (const hook of mounted.splice(0)) hook.unmount();
  requests.length = 0;
});

function mount(id = "main", relation) {
  const ended = [];
  const props = { session: session(id, relation), newSessionCwd: null, newSessionDraftKey: null, onAgentEnd: (info) => ended.push(info) };
  const hook = renderHook(useAgentSession, props);
  mounted.push(hook);
  return { hook, ended, props };
}
async function settle(hook) {
  for (let i = 0; i < 6; i++) { await new Promise((resolve) => setImmediate(resolve)); hook.flush(); }
}
const emit = (hook, event) => { hook.result.handleAgentEventRef.current(event); hook.flush(); };

// These tests exercise the hook itself: the completion tracker cannot mask
// accidental notification calls retained in old UI settlement paths.
test("UI settlement events remain functional but only session_complete notifies", async () => {
  const { hook, ended } = mount();
  sources[0].emit({ type: "connected", completionId: "100" });
  await settle(hook);
  emit(hook, { type: "agent_start" });
  assert.equal(hook.result.agentRunning, true);
  emit(hook, { type: "agent_end" });
  assert.equal(hook.result.agentRunning, true);
  emit(hook, { type: "agent_settled", aborted: false });
  assert.equal(hook.result.agentRunning, false);
  emit(hook, { type: "prompt_done" });
  await settle(hook);
  assert.deepEqual(ended, []);
  emit(hook, { type: "session_complete", completionId: "101" });
  emit(hook, { type: "session_complete", completionId: "101" });
  emit(hook, { type: "connected", completionId: "101" });
  await settle(hook);
  assert.deepEqual(ended, [{ aborted: false }]);
});

test("first HTTP snapshot then subscription-buffered live with the same ID announces exactly once", async () => {
  const { hook, ended } = mount();
  await settle(hook);
  assert.deepEqual(ended, [], "snapshot 100 is initial history");
  sources[0].emit({ type: "connected", completionId: "99" });
  sources[0].emit({ type: "session_complete", completionId: "100" });
  sources[0].emit({ type: "session_complete", completionId: "100" });
  await settle(hook);
  assert.deepEqual(ended, [{ aborted: false }]);
  sources[0].emit({ type: "connected", completionId: "100" });
  await settle(hook);
  assert.deepEqual(ended, [{ aborted: false }]);
});

test("stopped turns and subagents are silent", async () => {
  const { hook, ended } = mount();
  emit(hook, { type: "connected", completionId: "100" });
  await settle(hook);
  emit(hook, { type: "agent_start" });
  emit(hook, { type: "agent_end" });
  emit(hook, { type: "agent_settled", aborted: true });
  emit(hook, { type: "prompt_done", aborted: true });
  await settle(hook);
  assert.deepEqual(ended, []);
  hook.unmount();
  mounted.splice(mounted.indexOf(hook), 1);
  const child = mount("child", { kind: "subagent", parentSessionId: "main" });
  emit(child.hook, { type: "connected", completionId: "100" });
  emit(child.hook, { type: "session_complete", completionId: "200" });
  emit(child.hook, { type: "connected", completionId: "201" });
  await settle(child.hook);
  assert.deepEqual(child.ended, []);
});

test("SSE before initial snapshot wins over late old state, and reconnect recovers a new ID once", async () => {
  let answer;
  stateAnswer = () => new Promise((resolve) => { answer = resolve; });
  const { hook, ended } = mount();
  await settle(hook);
  assert.ok(answer);
  emit(hook, { type: "session_complete", completionId: "200" });
  stateAnswer = null;
  answer(json({ running: true, state: { completionId: "100" } }));
  await settle(hook);
  state.completionId = "150";
  emit(hook, { type: "connected", completionId: "150" });
  await settle(hook);
  assert.deepEqual(ended, [{ aborted: false }]);
  state.completionId = "201";
  emit(hook, { type: "connected", completionId: "201" });
  await settle(hook);
  assert.deepEqual(ended, [{ aborted: false }, { aborted: false }]);
  assert.ok(stateRequests > 1, "connected also reads and deduplicates the HTTP state");
});

test("state-only recovery notifies, and late responses across an ABA session switch are ignored", async () => {
  const { hook, ended, props } = mount();
  emit(hook, { type: "connected", completionId: "100" });
  await settle(hook);
  state.completionId = "101";
  emit(hook, { type: "connected", completionId: "100" });
  await settle(hook);
  assert.equal(ended.length, 1, "new HTTP completion while UI idle is recovered");

  let answer;
  stateAnswer = () => new Promise((resolve) => { answer = resolve; });
  emit(hook, { type: "connected", completionId: "101" });
  assert.ok(answer);
  const outgoingSource = sources.at(-1);
  hook.rerender({ ...props, session: session("other") });
  outgoingSource.emit({ type: "session_complete", completionId: "199" });
  assert.equal(ended.length, 1, "the outgoing session's stream cannot notify under the new selection");
  hook.rerender(props);
  stateAnswer = null;
  answer(json({ running: true, state: { completionId: "200" } }));
  await settle(hook);
  assert.equal(ended.length, 1, "same sid is insufficient: generation must still match");
  emit(hook, { type: "session_complete", completionId: "200" });
  assert.equal(ended.length, 2, "ignored stale response did not consume this completion");
});

test("reconcile and non-streaming finish recover the authoritative ID without an idle-based alert", async () => {
  const { hook, ended } = mount();
  emit(hook, { type: "connected", completionId: "100" });
  await settle(hook);
  emit(hook, { type: "agent_start" });
  window.dispatchEvent(new Event("online"));
  await settle(hook);
  assert.equal(hook.result.agentRunning, false, "missed settlement still clears running UI");
  assert.deepEqual(ended, [], "idle without a new ID must not announce");
  emit(hook, { type: "agent_start" });
  state.completionId = "101";
  window.dispatchEvent(new Event("online"));
  await settle(hook);
  assert.equal(hook.result.agentRunning, false);
  assert.deepEqual(ended, [{ aborted: false }], "reconcile, finish and loaded state deduplicate");
});
