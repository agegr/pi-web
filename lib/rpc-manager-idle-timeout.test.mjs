import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const { resolveSessionIdleTimeoutMs } = await jiti.import("./rpc-manager.ts");

const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

function makeIdleInner() {
  return {
    sessionId: "session-1",
    isBashRunning: false,
    isStreaming: false,
    isCompacting: false,
    extensionRunner: {},
    agent: { state: {} },
    subscribe: () => () => {},
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
  assert.equal(resolveSessionIdleTimeoutMs("2147483647"), 2_147_483_647);
});

test("falls back to the 10-minute default and warns for invalid or out-of-range values", (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  assert.equal(resolveSessionIdleTimeoutMs("abc"), 10 * 60 * 1000);
  assert.equal(resolveSessionIdleTimeoutMs("-5"), 10 * 60 * 1000);
  assert.equal(resolveSessionIdleTimeoutMs("NaN"), 10 * 60 * 1000);
  assert.equal(resolveSessionIdleTimeoutMs("Infinity"), 10 * 60 * 1000);
  assert.equal(resolveSessionIdleTimeoutMs("2147483648"), 10 * 60 * 1000);
  assert.equal(resolveSessionIdleTimeoutMs("2592000000"), 10 * 60 * 1000);
  assert.equal(warn.mock.callCount(), 6);
});

for (const [rawValue, timeoutMs] of [
  ["0", 0],
  ["1800000", 1_800_000],
  ["2592000000", 600_000],
]) {
  test(`PI_WEB_IDLE_TIMEOUT_MS=${rawValue} applies to an idle session`, async (t) => {
    const previousValue = process.env.PI_WEB_IDLE_TIMEOUT_MS;
    process.env.PI_WEB_IDLE_TIMEOUT_MS = rawValue;
    try {
      const freshJiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
      const { AgentSessionWrapper } = await freshJiti.import("./rpc-manager.ts");

      t.mock.timers.enable({ apis: ["setTimeout"] });
      const wrapper = new AgentSessionWrapper(makeIdleInner());
      t.after(() => wrapper.destroy());
      wrapper.start();
      assert.equal(wrapper.isRunning(), false);

      t.mock.timers.tick(timeoutMs === 0 ? 60 * 60 * 1000 : timeoutMs - 1);
      await nextTurn();
      assert.equal(wrapper.isAlive(), true);

      if (timeoutMs !== 0) {
        t.mock.timers.tick(1);
        await nextTurn();
        assert.equal(wrapper.isAlive(), false);
      }
    } finally {
      if (previousValue === undefined) delete process.env.PI_WEB_IDLE_TIMEOUT_MS;
      else process.env.PI_WEB_IDLE_TIMEOUT_MS = previousValue;
    }
  });
}
