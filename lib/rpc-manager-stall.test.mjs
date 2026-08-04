import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  interopDefault: true,
  moduleCache: false,
});

const STALL_MS = 1000;

async function loadWrapper() {
  process.env.PI_WEB_MODEL_STALL_TIMEOUT_MS = String(STALL_MS);
  const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");
  return AgentSessionWrapper;
}

function makeInner(overrides = {}) {
  const inner = {
    sessionId: "stall-test",
    sessionFile: "",
    isStreaming: false,
    isBashRunning: false,
    isCompacting: false,
    aborted: 0,
    emitToSubscriber: null,
    subscribe(listener) {
      inner.emitToSubscriber = listener;
      return () => { inner.emitToSubscriber = null; };
    },
    abort() {
      inner.aborted += 1;
    },
    abortBash() {},
    dispose() {},
    sessionManager: { getCwd: () => "/tmp" },
    ...overrides,
  };
  return inner;
}

/** Drive the wrapper into "a turn is running" without touching the real SDK. */
function startTurn(wrapper) {
  wrapper.promptRunning = true;
  wrapper.resetStallTimer();
}

function collectEvents(wrapper) {
  const events = [];
  wrapper.onEvent((event) => events.push(event));
  return events;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("a turn with no model activity is aborted once the stall window passes", async () => {
  const AgentSessionWrapper = await loadWrapper();
  const inner = makeInner({ isStreaming: true });
  const wrapper = new AgentSessionWrapper(inner);
  wrapper.start();
  const events = collectEvents(wrapper);
  startTurn(wrapper);

  await wait(STALL_MS * 2);

  assert.equal(inner.aborted, 1, "the wedged turn should be aborted");
  const stallError = events.find((e) => e.type === "prompt_error");
  assert.ok(stallError, "the abort should be explained, not silent");
  assert.match(stallError.errorMessage, /No response from the model/);
  wrapper.destroy();
});

test("streaming activity keeps the turn alive", async () => {
  const AgentSessionWrapper = await loadWrapper();
  const inner = makeInner({ isStreaming: true });
  const wrapper = new AgentSessionWrapper(inner);
  wrapper.start();
  startTurn(wrapper);

  // A chunk arrives before each deadline — the same shape as a slow but healthy
  // response, which must never be killed.
  for (let i = 0; i < 3; i++) {
    await wait(STALL_MS * 0.6);
    inner.emitToSubscriber({ type: "message_update", message: { role: "assistant" } });
  }

  assert.equal(inner.aborted, 0, "a producing turn must not be aborted");
  wrapper.destroy();
});

test("a silent long-running shell command is not treated as a stalled model", async () => {
  const AgentSessionWrapper = await loadWrapper();
  const inner = makeInner({ isStreaming: true, isBashRunning: true });
  const wrapper = new AgentSessionWrapper(inner);
  wrapper.start();
  startTurn(wrapper);

  await wait(STALL_MS * 2);

  assert.equal(inner.aborted, 0, "shell work emits nothing and must be left alone");
  wrapper.destroy();
});

test("a tool still executing is not treated as a stalled model", async () => {
  const AgentSessionWrapper = await loadWrapper();
  const inner = makeInner({ isStreaming: true });
  const wrapper = new AgentSessionWrapper(inner);
  wrapper.start();
  startTurn(wrapper);
  inner.emitToSubscriber({ type: "tool_execution_start", toolCallId: "t1", toolName: "read" });

  await wait(STALL_MS * 2);

  assert.equal(inner.aborted, 0, "a pending tool is progress, not a stall");
  wrapper.destroy();
});

test("an idle session is never aborted", async () => {
  const AgentSessionWrapper = await loadWrapper();
  const inner = makeInner();
  const wrapper = new AgentSessionWrapper(inner);
  wrapper.start();

  await wait(STALL_MS * 2);

  assert.equal(inner.aborted, 0, "nothing is running, so there is nothing to abort");
  wrapper.destroy();
});

test("the watchdog can be turned off", async () => {
  process.env.PI_WEB_MODEL_STALL_TIMEOUT_MS = "disabled";
  const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");
  const inner = makeInner({ isStreaming: true });
  const wrapper = new AgentSessionWrapper(inner);
  wrapper.start();
  startTurn(wrapper);

  await wait(STALL_MS * 2);

  assert.equal(inner.aborted, 0, "disabled means disabled");
  wrapper.destroy();
  delete process.env.PI_WEB_MODEL_STALL_TIMEOUT_MS;
});
