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

async function withIdleTimeoutEnv(rawValue, run) {
  const previousValue = process.env.PI_WEB_IDLE_TIMEOUT_MS;
  process.env.PI_WEB_IDLE_TIMEOUT_MS = rawValue;
  try {
    const freshJiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
    const { AgentSessionWrapper } = await freshJiti.import("./rpc-manager.ts");
    await run(AgentSessionWrapper);
  } finally {
    if (previousValue === undefined) delete process.env.PI_WEB_IDLE_TIMEOUT_MS;
    else process.env.PI_WEB_IDLE_TIMEOUT_MS = previousValue;
  }
}

test("PI_WEB_IDLE_TIMEOUT_MS=0 still reaps a run that Stop cannot unwind", async (t) => {
  await withIdleTimeoutEnv("0", async (AgentSessionWrapper) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const inner = makeIdleInner();
    inner.isStreaming = true;
    // A handler that ignores the abort signal keeps the SDK run pending forever.
    inner.abort = () => new Promise(() => {});
    const wrapper = new AgentSessionWrapper(inner);
    t.after(() => wrapper.destroy());
    wrapper.start();

    t.mock.timers.tick(60 * 60 * 1000);
    await nextTurn();
    assert.equal(wrapper.isAlive(), true);

    void wrapper.send({ type: "abort" });
    await nextTurn();
    t.mock.timers.tick(10 * 60 * 1000 - 1);
    await nextTurn();
    assert.equal(wrapper.isAlive(), true);

    t.mock.timers.tick(1);
    await nextTurn();
    assert.equal(wrapper.isAlive(), false);
  });
});

test("PI_WEB_IDLE_TIMEOUT_MS=0 keeps a session alive after Stop unwinds its run", async (t) => {
  await withIdleTimeoutEnv("0", async (AgentSessionWrapper) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const inner = makeIdleInner();
    inner.isStreaming = true;
    inner.abort = async () => {
      inner.isStreaming = false;
    };
    const wrapper = new AgentSessionWrapper(inner);
    t.after(() => wrapper.destroy());
    wrapper.start();

    await wrapper.send({ type: "abort" });
    t.mock.timers.tick(60 * 60 * 1000);
    await nextTurn();
    assert.equal(wrapper.isAlive(), true);
  });
});

for (const rawValue of ["", "0"]) {
  test(`PI_WEB_IDLE_TIMEOUT_MS=${JSON.stringify(rawValue)}: pressing Stop again does not postpone the forced cleanup`, async (t) => {
    await withIdleTimeoutEnv(rawValue, async (AgentSessionWrapper) => {
      t.mock.timers.enable({ apis: ["setTimeout"] });
      const inner = makeIdleInner();
      inner.isStreaming = true;
      inner.abort = () => new Promise(() => {});
      const wrapper = new AgentSessionWrapper(inner);
      t.after(() => wrapper.destroy());
      wrapper.start();

      void wrapper.send({ type: "abort" });
      await nextTurn();
      t.mock.timers.tick(9 * 60 * 1000);
      await nextTurn();
      // A stuck user presses Stop again (or reloads the page).
      void wrapper.send({ type: "abort" });
      await nextTurn();
      assert.equal(wrapper.isAlive(), true);

      t.mock.timers.tick(60 * 1000);
      await nextTurn();
      assert.equal(wrapper.isAlive(), false);
    });
  });
}

test("PI_WEB_IDLE_TIMEOUT_MS=0 reaps a bash command that abort_bash cannot stop", async (t) => {
  await withIdleTimeoutEnv("0", async (AgentSessionWrapper) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const inner = makeIdleInner();
    inner.isBashRunning = true;
    inner.abortBash = () => {};
    const wrapper = new AgentSessionWrapper(inner);
    t.after(() => wrapper.destroy());
    wrapper.start();

    await wrapper.send({ type: "abort_bash" });
    t.mock.timers.tick(10 * 60 * 1000 - 1);
    await nextTurn();
    assert.equal(wrapper.isAlive(), true);

    t.mock.timers.tick(1);
    await nextTurn();
    assert.equal(wrapper.isAlive(), false);
  });
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

// A page's lease renewal (POST /api/agent/[id]/lease) is the session's one countdown.
test("renewIdleTimer() starts the idle countdown over, and is not a command", async (t) => {
  await withIdleTimeoutEnv("", async (AgentSessionWrapper) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
    const wrapper = new AgentSessionWrapper(makeIdleInner());
    t.after(() => wrapper.destroy());
    wrapper.start();
    const before = wrapper.getDebugSnapshot();

    t.mock.timers.tick(9 * 60 * 1000);
    wrapper.renewIdleTimer();
    const after = wrapper.getDebugSnapshot();
    assert.deepEqual(after.idle, { ...before.idle, lastResetAt: 1_540_000, nextCheckAt: 1_540_000 + 10 * 60 * 1000 });
    assert.equal(after.lastCommand, null);
    assert.equal(after.run.mutatingCommands, before.run.mutatingCommands);

    // A closed tab: reaped one idle timeout after its last renewal, not before.
    t.mock.timers.tick(10 * 60 * 1000 - 1);
    await nextTurn();
    assert.equal(wrapper.isAlive(), true);
    t.mock.timers.tick(1);
    await nextTurn();
    assert.equal(wrapper.isAlive(), false);
  });
});

test("renewIdleTimer() never moves Stop's forced deadline", async (t) => {
  await withIdleTimeoutEnv("", async (AgentSessionWrapper) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const inner = makeIdleInner();
    inner.isStreaming = true;
    inner.abort = () => new Promise(() => {});
    const wrapper = new AgentSessionWrapper(inner);
    t.after(() => wrapper.destroy());
    wrapper.start();

    void wrapper.send({ type: "abort" });
    await nextTurn();
    const forced = wrapper.getDebugSnapshot().idle;
    assert.equal(forced.forcedByStop, true);
    t.mock.timers.tick(9 * 60 * 1000);
    wrapper.renewIdleTimer();
    assert.deepEqual(wrapper.getDebugSnapshot().idle, forced);

    t.mock.timers.tick(60 * 1000);
    await nextTurn();
    assert.equal(wrapper.isAlive(), false);
  });
});

test("renewIdleTimer() arms nothing on a closing or destroyed wrapper", async (t) => {
  await withIdleTimeoutEnv("", async (AgentSessionWrapper) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const inner = makeIdleInner();
    // session_shutdown never settles: the wrapper stays closing until the shutdown deadline.
    inner.extensionRunner = { emit: () => new Promise(() => {}) };
    const wrapper = new AgentSessionWrapper(inner);
    t.after(() => wrapper.destroy());
    wrapper.start();
    const armed = wrapper.getDebugSnapshot().idle;

    const closing = wrapper.shutdown();
    await nextTurn();
    assert.equal(wrapper.getDebugSnapshot().state, "closing");
    t.mock.timers.tick(1_000);
    wrapper.renewIdleTimer();
    assert.deepEqual(wrapper.getDebugSnapshot().idle, armed, "a closing wrapper is not revived");

    t.mock.timers.tick(60 * 1000);
    await closing;
    wrapper.renewIdleTimer();
    assert.equal(wrapper.getDebugSnapshot().idle.nextCheckAt, null);
    assert.equal(wrapper.isAlive(), false);
  });
});

test("renewIdleTimer() keeps idle reaping disabled under PI_WEB_IDLE_TIMEOUT_MS=0", async (t) => {
  await withIdleTimeoutEnv("0", async (AgentSessionWrapper) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const wrapper = new AgentSessionWrapper(makeIdleInner());
    t.after(() => wrapper.destroy());
    wrapper.start();
    wrapper.renewIdleTimer();
    assert.equal(wrapper.getDebugSnapshot().idle.nextCheckAt, null);
    t.mock.timers.tick(60 * 60 * 1000);
    await nextTurn();
    assert.equal(wrapper.isAlive(), true);
  });
});
