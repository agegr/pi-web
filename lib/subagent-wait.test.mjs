import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { createSubagentExtension, SUBAGENT_WAIT_TIMEOUT_MS } = await jiti.import("./subagent-extension.ts");
const { createSubagentController } = await jiti.import("./subagent-runtime.ts");

function run(overrides = {}) {
  return {
    sessionId: "child-wait", sessionPath: "/tmp/child-wait.jsonl",
    parentSessionId: "parent-wait", parentToolCallId: "call",
    profile: "explore", description: "Inspect", task: "Inspect",
    runInBackground: false, status: "running", createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function flush() {
  // Flush the extension's async runtime, race and notification continuations.
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

async function toolsFor(runtime) {
  const tools = new Map();
  // A new call that omits subagent_type starts the default profile, which must be enabled.
  const profiles = [{ name: "general-purpose", description: "General", tools: [], enabled: true }];
  await createSubagentExtension(runtime, () => profiles).factory({
    registerTool(tool) { tools.set(tool.name, tool); },
  });
  return tools;
}

for (const resume of [false, true]) {
  test(`${resume ? "resumed" : "new"} foreground Agent stops waiting but keeps the child and notifies once`, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const completion = deferred();
    const notifications = [], updates = [];
    let request;
    const launch = async (value) => {
      request = value;
      value.onUpdate(run({ status: "queued" }));
      return { run: run({ status: "queued" }), completion: completion.promise };
    };
    const tools = await toolsFor({ start: launch, resume: launch,
      async notifyParent(value) { notifications.push(value); },
    });
    const parent = new AbortController();
    const pending = tools.get("Agent").execute("call", {
      prompt: "Inspect", description: "Inspect", ...(resume ? { resume: "child-wait" } : {}),
    }, parent.signal, (value) => updates.push(value), {});
    await flush();
    request.onUpdate(run());
    let returned = false;
    pending.then(() => { returned = true; });
    t.mock.timers.tick(120_000);
    await flush();
    assert.equal(returned, false, "A normal multi-minute task must not yield after two minutes");
    t.mock.timers.tick(SUBAGENT_WAIT_TIMEOUT_MS - 120_000 - 1);
    await flush();
    assert.equal(returned, false);
    t.mock.timers.tick(1);
    const result = await pending;
    assert.equal(result.isError, undefined);
    assert.equal(result.details.status, "running");
    assert.equal(result.details.sessionId, "child-wait");
    assert.match(result.content[0].text, /Wait budget exhausted \(1800 seconds\)/);
    assert.match(result.content[0].text, /not cancelled/);
    assert.match(result.content[0].text, /report will arrive automatically/);
    assert.deepEqual(notifications, []);
    const updateCount = updates.length;
    assert.deepEqual(getEventListeners(parent.signal, "abort"), []);
    parent.abort();
    assert.equal(request.signal.aborted, false, "A later parent Stop must not kill the detached child");
    const completed = run({ status: "completed", result: "done", completedAt: "2026-01-01T00:05:00Z" });
    request.onUpdate(completed);
    completion.resolve(completed);
    await flush();
    assert.deepEqual(notifications, [completed]);
    assert.equal(updates.length, updateCount, "No updates after the tool result was returned");
  });
}

test("the default budget is 30 minutes and both tools expose an optional integer wait_timeout", async () => {
  assert.equal(SUBAGENT_WAIT_TIMEOUT_MS, 30 * 60_000);
  const tools = await toolsFor({});
  for (const name of ["Agent", "get_subagent_result"]) {
    const schema = tools.get(name).parameters;
    assert.equal(schema.properties.wait_timeout.type, "integer");
    assert.equal(schema.properties.wait_timeout.minimum, 1);
    assert.equal(schema.properties.wait_timeout.maximum, 2_147_483);
    assert.ok(!schema.required.includes("wait_timeout"));
  }
});

for (const resume of [false, true]) {
  for (const seconds of [1, 7200]) {
    test(`${resume ? "resumed" : "new"} foreground Agent honors a ${seconds}-second wait budget`, async (t) => {
      t.mock.timers.enable({ apis: ["setTimeout"] });
      const completion = deferred(), notifications = [];
      let childSignal;
      const launch = async (request) => {
        childSignal = request.signal;
        return { run: run(), completion: completion.promise };
      };
      const tools = await toolsFor({ start: launch, resume: launch,
        async notifyParent(value) { notifications.push(value); },
      });
      const pending = tools.get("Agent").execute("call", {
        prompt: "Inspect", description: "Inspect", wait_timeout: seconds,
        ...(resume ? { resume: "child-wait" } : {}),
      }, undefined, undefined, {});
      let returned = false;
      pending.then(() => { returned = true; });
      await flush();
      t.mock.timers.tick(seconds * 1000 - 1);
      await flush();
      assert.equal(returned, false);
      t.mock.timers.tick(1);
      const result = await pending;
      assert.equal(result.details.status, "running");
      assert.equal(result.isError, undefined);
      assert.ok(result.content[0].text.includes(`Wait budget exhausted (${seconds} seconds)`));
      assert.equal(childSignal.aborted, false);
      const terminal = run({ status: "completed", result: "LONG_TASK_DONE" });
      completion.resolve(terminal);
      await flush();
      assert.deepEqual(notifications, [terminal]);
    });
  }
}

for (const seconds of [1, 7200]) {
  test(`get_subagent_result honors a ${seconds}-second wait budget`, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let reads = 0;
    const tools = await toolsFor({ async get() { reads++; return run(); } });
    const pending = tools.get("get_subagent_result").execute("call", {
      agent_id: "child-wait", wait: true, wait_timeout: seconds,
    });
    let returned = false;
    pending.then(() => { returned = true; });
    await flush();
    t.mock.timers.tick(seconds * 1000 - 1);
    await flush();
    assert.equal(returned, false);
    t.mock.timers.tick(1);
    const result = await pending;
    assert.equal(result.details.status, "running");
    assert.equal(result.isError, undefined);
    assert.ok(result.content[0].text.includes(`Wait budget exhausted (${seconds} seconds)`));
    await flush();
    const before = reads;
    t.mock.timers.tick(seconds * 2000);
    await flush();
    assert.equal(reads, before, "No polling after the custom budget expires");
  });
}

test("invalid wait budgets are rejected before starting or looking up a child", async () => {
  let starts = 0, reads = 0;
  const tools = await toolsFor({
    async start() { starts++; throw new Error("must not launch"); },
    async resume() { starts++; throw new Error("must not resume"); },
    async get() { reads++; return run(); },
  });
  for (const seconds of [0, -1, 1.5, NaN, Infinity, 2_147_484, "60", null]) {
    for (const resume of [false, true]) {
      const result = await tools.get("Agent").execute("call", {
        prompt: "Inspect", description: "Inspect", wait_timeout: seconds,
        ...(resume ? { resume: "child-wait" } : {}),
      }, undefined, undefined, {});
      assert.equal(result.isError, true);
      assert.match(result.content[0].text, /wait_timeout must be an integer/);
    }
    await assert.rejects(tools.get("get_subagent_result").execute("call", {
      agent_id: "child-wait", wait: true, wait_timeout: seconds,
    }), /wait_timeout must be an integer/);
  }
  assert.equal(starts, 0);
  assert.equal(reads, 0);
});

test("a wait budget does not delay background dispatch or a non-waiting result lookup", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const completion = deferred(), notifications = [];
  let reads = 0;
  const tools = await toolsFor({
    async start() { return { run: run({ runInBackground: true }), completion: completion.promise }; },
    async get() { reads++; return run(); },
    async notifyParent(value) { notifications.push(value); },
  });
  const background = await tools.get("Agent").execute("call", {
    prompt: "Inspect", description: "Inspect", run_in_background: true, wait_timeout: 7200,
  }, undefined, undefined, {});
  assert.match(background.content[0].text, /started in background/);
  const status = await tools.get("get_subagent_result").execute("get", {
    agent_id: "child-wait", wait: false, wait_timeout: 7200,
  });
  assert.equal(status.details.status, "running");
  assert.equal(reads, 1);
  assert.deepEqual(notifications, []);
  completion.resolve(run({ status: "completed" }));
  await flush();
  assert.equal(notifications.length, 1);
});

test("foreground Agent completes normally before its deadline and clears the wait timer", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const completion = deferred(), notifications = [];
  const tools = await toolsFor({
    async start() { return { run: run(), completion: completion.promise }; },
    async notifyParent(value) { notifications.push(value); },
  });
  const pending = tools.get("Agent").execute("call", { prompt: "Inspect", description: "Inspect" }, undefined, undefined, {});
  await flush();
  t.mock.timers.tick(SUBAGENT_WAIT_TIMEOUT_MS - 1);
  completion.resolve(run({ status: "completed", result: "done" }));
  const result = await pending;
  assert.equal(result.content[0].text, "Subagent child-wait completed.\n\ndone");
  t.mock.timers.tick(SUBAGENT_WAIT_TIMEOUT_MS * 2);
  await flush();
  assert.deepEqual(notifications, []);
});

test("foreground cancellation still reaches the child and releases the wait even if it does not settle", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let childSignal;
  const tools = await toolsFor({
    async start(request) {
      childSignal = request.signal;
      return { run: run(), completion: new Promise(() => {}) };
    },
  });
  const parent = new AbortController();
  const pending = tools.get("Agent").execute("call", { prompt: "Inspect", description: "Inspect" }, parent.signal, undefined, {});
  await flush();
  parent.abort();
  const result = await pending;
  assert.equal(childSignal.aborted, true);
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /Result wait aborted/);
  t.mock.timers.tick(SUBAGENT_WAIT_TIMEOUT_MS * 2);
});

for (const status of ["queued", "starting", "running"]) {
  test(`get_subagent_result bounds a ${status} wait and stops polling without consuming a result`, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const consumed = [];
    let reads = 0;
    const tools = await toolsFor({
      async get() { reads++; return run({ status, runInBackground: true }); },
      markResultConsumed(value) { consumed.push(value); },
    });
    const pending = tools.get("get_subagent_result").execute("call", { agent_id: "child-wait", wait: true });
    await flush();
    t.mock.timers.tick(SUBAGENT_WAIT_TIMEOUT_MS);
    const result = await pending;
    assert.equal(result.details.status, status);
    assert.equal(result.isError, undefined);
    assert.match(result.content[0].text, /Wait budget exhausted/);
    assert.match(result.content[0].text, new RegExp(`is ${status}`));
    assert.deepEqual(consumed, []);
    await flush();
    const readCount = reads;
    t.mock.timers.tick(SUBAGENT_WAIT_TIMEOUT_MS * 2);
    await flush();
    assert.equal(reads, readCount, "No polling may survive the deadline");
  });
}

test("get_subagent_result bounds its initial status lookup without inventing a status", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const lookup = deferred(), consumed = [];
  let reads = 0;
  const tools = await toolsFor({
    async get() { reads++; return lookup.promise; },
    markResultConsumed(value) { consumed.push(value); },
  });
  const parent = new AbortController();
  const pending = tools.get("get_subagent_result").execute("call", { agent_id: "child-wait", wait: true }, parent.signal);
  await flush();
  t.mock.timers.tick(SUBAGENT_WAIT_TIMEOUT_MS);
  const result = await pending;
  assert.equal(result.isError, undefined);
  assert.equal(result.details, undefined);
  assert.match(result.content[0].text, /child-wait: status lookup is still pending/);
  assert.deepEqual(getEventListeners(parent.signal, "abort"), []);
  lookup.resolve(run({ status: "completed" }));
  await flush();
  t.mock.timers.tick(SUBAGENT_WAIT_TIMEOUT_MS);
  await flush();
  assert.equal(reads, 1);
  assert.deepEqual(consumed, []);
});

test("get_subagent_result returns completion before its deadline and consumes only the terminal result", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const consumed = [];
  let current = run({ status: "queued", runInBackground: true });
  const tools = await toolsFor({
    async get() { return current; },
    markResultConsumed(value) { consumed.push(value); },
  });
  const pending = tools.get("get_subagent_result").execute("call", { agent_id: "child-wait", wait: true });
  await flush();
  current = run({ status: "completed", result: "done", runInBackground: true, completedAt: "2026-01-01T00:01:00Z" });
  t.mock.timers.tick(500);
  const result = await pending;
  assert.equal(result.content[0].text, "Subagent child-wait completed.\n\ndone");
  assert.deepEqual(consumed, [current]);
});

test("get_subagent_result cancellation stops polling and removes its abort listener", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let reads = 0;
  const tools = await toolsFor({ async get() { reads++; return run(); } });
  const parent = new AbortController();
  const pending = tools.get("get_subagent_result").execute("call", { agent_id: "child-wait", wait: true }, parent.signal);
  const rejected = assert.rejects(pending, /Result wait aborted/);
  await flush();
  parent.abort();
  await rejected;
  assert.deepEqual(getEventListeners(parent.signal, "abort"), []);
  const readCount = reads;
  t.mock.timers.tick(SUBAGENT_WAIT_TIMEOUT_MS * 2);
  await flush();
  assert.equal(reads, readCount);
});

test("a collected foreground result suppresses its late completion notification after wait expiry", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let parentRunning = true;
  const delivered = [], completion = deferred();
  const parent = {
    isAlive: () => true, isRunning: () => parentRunning, waitUntilReady: async () => {},
    inner: { sendCustomMessage: async (message) => delivered.push(message) },
  };
  const controller = createSubagentController({
    getSession: () => parent, registerSession() {}, reopenSession: async () => parent,
    resolveSessionPath: async () => null, invalidateSessionList() {},
  });
  const terminal = run({ status: "completed", result: "done", completedAt: "2026-01-01T00:06:00Z" });
  const tools = await toolsFor({
    async start() { return { run: run(), completion: completion.promise }; },
    async get() { return terminal; },
    notifyParent: controller.extensionRuntime.notifyParent,
    markResultConsumed: controller.extensionRuntime.markResultConsumed,
  });
  const pending = tools.get("Agent").execute("call", { prompt: "Inspect", description: "Inspect" }, undefined, undefined, {});
  await flush();
  t.mock.timers.tick(SUBAGENT_WAIT_TIMEOUT_MS);
  await pending;
  completion.resolve(terminal);
  await flush();
  const result = await tools.get("get_subagent_result").execute("get", { agent_id: terminal.sessionId });
  assert.equal(result.details.status, "completed");
  parentRunning = false;
  t.mock.timers.tick(500);
  await flush();
  assert.deepEqual(delivered, []);
  // The old consumed marker must not suppress a later resumed run (#987).
  await controller.extensionRuntime.notifyParent({ ...terminal, resumed: true, completedAt: "2026-01-01T00:07:00Z" });
  assert.equal(delivered.length, 1);
});
