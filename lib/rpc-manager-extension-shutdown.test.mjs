import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");
const { createAgentEventStream } = await jiti.import("./agent-event-stream.ts");
const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

function fixture(t, id = "extension-exit") {
  let bindings;
  let listener;
  const order = [];
  const inner = {
    sessionId: id,
    sessionFile: "",
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    agent: { state: {} },
    sessionManager: { getCwd: () => process.cwd(), getSessionName: () => undefined, getEntries: () => [] },
    extensionRunner: { async emit(event) { order.push(event.type); } },
    async bindExtensions(value) { bindings = value; },
    subscribe(value) { listener = value; return () => {}; },
    getContextUsage: () => null,
    getSteeringMessages: () => [],
    getFollowUpMessages: () => [],
    dispose() { order.push("dispose"); },
  };
  const wrapper = new AgentSessionWrapper(inner);
  wrapper.onDestroy(() => order.push("unregister"));
  wrapper.onEvent((event) => order.push(event));
  wrapper.start();
  t.after(() => wrapper.destroy());
  return { inner, wrapper, order, bind: () => wrapper.beginExtensionBinding(), shutdown: () => bindings.shutdownHandler(), emit: (event) => listener(event) };
}

const terminalOrder = (id) => ["session_shutdown", "dispose", "unregister", { type: "session_ended", sessionId: id }];

test("an extension shutdown runs hooks and disposes once before its terminal event, for only its wrapper", async (t) => {
  const first = fixture(t);
  const second = fixture(t, "other-session");
  first.bind();
  second.bind();
  await nextTurn();
  first.shutdown();
  first.shutdown();
  await nextTurn();
  assert.deepEqual(first.order, terminalOrder("extension-exit"));
  assert.equal(first.wrapper.isAlive(), false);
  assert.equal(second.wrapper.isAlive(), true);
  assert.deepEqual(second.order, []);
});

test("a shutdown requested during binding waits for binding without self-deadlocking", async (t) => {
  const f = fixture(t);
  let finishBinding;
  f.inner.bindExtensions = async ({ shutdownHandler }) => {
    shutdownHandler();
    await new Promise((resolve) => { finishBinding = resolve; });
    f.order.push("bound");
  };
  f.bind();
  await nextTurn();
  assert.deepEqual(f.order, []);
  finishBinding();
  await nextTurn();
  assert.deepEqual(f.order, ["bound", ...terminalOrder("extension-exit")]);

  // A cold start can resolve to a wrapper session_start already ended. It must
  // still tell the client to stop, rather than close and start that extension again.
  const stream = createAgentEventStream(new Request("http://localhost/events"), "extension-exit", Promise.resolve(f.wrapper));
  const reader = stream.getReader();
  let data = "";
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    data += new TextDecoder().decode(chunk.value);
  }
  assert.match(data, /"type":"session_ended","sessionId":"extension-exit"/);
});

test("a shutdown requested inside a prompt waits past agent_settled and prompt_done", async (t) => {
  const f = fixture(t);
  f.bind();
  await nextTurn();
  let finish;
  f.inner.prompt = (_message, options) => {
    f.inner.isStreaming = true;
    options.preflightResult("started");
    f.shutdown();
    return new Promise((resolve) => { finish = resolve; });
  };
  await f.wrapper.send({ type: "prompt", message: "/quit" });
  await nextTurn();
  assert.deepEqual(f.order, []);
  f.inner.isStreaming = false;
  f.emit({ type: "agent_settled" });
  await nextTurn();
  assert.equal(f.wrapper.isAlive(), true, "the command's prompt has not returned yet");
  finish();
  await nextTurn();
  assert.deepEqual(f.order, [{ type: "agent_settled" }, { type: "prompt_done" }, ...terminalOrder("extension-exit")]);
});

test("shutdown requested by an extension command with no model turn follows prompt completion", async (t) => {
  const f = fixture(t);
  f.bind();
  await nextTurn();
  f.inner.prompt = async (_message, options) => {
    f.shutdown();
    options.preflightResult("handled");
  };
  await f.wrapper.send({ type: "prompt", message: "/quit" });
  await nextTurn();
  assert.deepEqual(f.order, [{ type: "prompt_done" }, ...terminalOrder("extension-exit")]);
});

test("a shutdown requested mid-run still takes Stop and steering, as pi does, and ends once idle", async (t) => {
  const f = fixture(t);
  f.bind();
  await nextTurn();
  let finish;
  const steered = [];
  f.inner.prompt = (message, options) => {
    if (options?.streamingBehavior) { steered.push(message); options.preflightResult?.("queued"); return Promise.resolve(); }
    f.inner.isStreaming = true;
    options.preflightResult("started");
    return new Promise((resolve) => { finish = resolve; });
  };
  f.inner.abort = async () => { f.inner.isStreaming = false; finish(); };
  await f.wrapper.send({ type: "prompt", message: "long run" });
  f.shutdown(); // e.g. pi's docs example: a tool_call handler on a fatal input
  await nextTurn();
  assert.equal(f.wrapper.isAlive(), true, "deferred while the run goes");
  await f.wrapper.send({ type: "prompt", message: "steer", streamingBehavior: "steer" });
  assert.deepEqual(steered, ["steer"]);
  await f.wrapper.send({ type: "abort" });
  f.emit({ type: "agent_settled" });
  await nextTurn();
  await nextTurn();
  assert.equal(f.wrapper.isAlive(), false);
  assert.deepEqual(f.order.at(-1), { type: "session_ended", sessionId: "extension-exit" });
});
