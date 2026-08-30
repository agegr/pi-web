import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const { resolveSessionIdleTimeoutMs } = await jiti.import("./rpc-manager.ts");

const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

function makePromptInner(prompt) {
  return {
    sessionId: "session-1",
    isBashRunning: false,
    isStreaming: false,
    extensionRunner: {},
    sessionManager: { getCwd: () => "/tmp" },
    agent: { state: {} },
    getContextUsage: () => null,
    getSteeringMessages: () => [],
    getFollowUpMessages: () => [],
    prompt,
    dispose() {},
  };
}

test("defaults to the 10-minute idle timeout when the env var is unset or blank", () => {
  assert.equal(resolveSessionIdleTimeoutMs(), 10 * 60 * 1000);
  assert.equal(resolveSessionIdleTimeoutMs(""), 10 * 60 * 1000);
  assert.equal(resolveSessionIdleTimeoutMs("   "), 10 * 60 * 1000);
});

test("treats zero as disabling idle shutdown", () => {
  assert.equal(resolveSessionIdleTimeoutMs("0"), 0);
});

test("uses a positive value as the timeout in milliseconds", () => {
  assert.equal(resolveSessionIdleTimeoutMs("1800000"), 1_800_000);
});

test("falls back to the 10-minute default for invalid or negative values", () => {
  assert.equal(resolveSessionIdleTimeoutMs("abc"), 10 * 60 * 1000);
  assert.equal(resolveSessionIdleTimeoutMs("-5"), 10 * 60 * 1000);
  assert.equal(resolveSessionIdleTimeoutMs("NaN"), 10 * 60 * 1000);
  assert.equal(resolveSessionIdleTimeoutMs("Infinity"), 10 * 60 * 1000);
});

test("PI_WEB_IDLE_TIMEOUT_MS=0 disables idle shutdown", async (t) => {
  process.env.PI_WEB_IDLE_TIMEOUT_MS = "0";
  try {
    const freshJiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
    const { AgentSessionWrapper } = await freshJiti.import("./rpc-manager.ts");

    t.mock.timers.enable({ apis: ["setTimeout"] });
    const inner = makePromptInner(() => Promise.resolve());
    inner.isStreaming = true;
    inner.subscribe = () => () => {};
    inner.dispose = () => {};
    const wrapper = new AgentSessionWrapper(inner);
    t.after(() => wrapper.destroy());
    wrapper.start();

    // Far beyond the default 10-minute timeout: the wrapper must survive.
    t.mock.timers.tick(60 * 60 * 1000);
    await nextTurn();
    assert.equal(wrapper.isAlive(), true);
  } finally {
    delete process.env.PI_WEB_IDLE_TIMEOUT_MS;
  }
});
