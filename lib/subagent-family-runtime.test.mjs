import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const { createSubagentController, hasUnsettledSubagentRun } = await createJiti(import.meta.url).import("./subagent-runtime.ts");
const deferred = () => Promise.withResolvers();
const fileSnapshot = async (path) => ({ content: await readFile(path), mtimeNs: (await stat(path, { bigint: true })).mtimeNs });

// Every session, path and prompt is synthetic; even the agent settings live in a temp dir.
async function harness(t) {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-family-runtime-"));
  const previousDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  const globals = ["__piSubagentRuns", "__piSubagentQueue", "__piSubagentConsumedResults", "__piSubagentFamilyTracking"];
  const previous = globals.map((key) => globalThis[key]);
  for (const key of globals) delete globalThis[key];
  await mkdir(join(dir, "agents"));
  await writeFile(join(dir, "agents", "settings.json"), JSON.stringify({ maxConcurrent: 1 }));
  const nodes = new Map();
  const events = [];
  const deliveries = [];
  const executions = [];
  const gates = [];
  const gate = () => { const value = deferred(); gates.push(value); return value; };
  t.after(async () => {
    for (const value of gates) value.resolve();
    await Promise.allSettled(executions);
    for (let i = 0; i < globals.length; i++) {
      if (previous[i] === undefined) delete globalThis[globals[i]];
      else globalThis[globals[i]] = previous[i];
    }
    if (previousDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousDir;
    await rm(dir, { recursive: true, force: true });
  });
  function node(id, parentId) {
    const prompt = gate();
    const metadata = parentId ? [{ type: "custom", customType: "pi-web:subagent", data: {
      version: 1, parentSessionId: parentId, parentSessionPath: join(dir, `${parentId}.jsonl`),
      parentToolCallId: "original", profile: "fixture", description: id, task: "old", runInBackground: false,
      createdAt: "2026-01-01T00:00:00.000Z",
    } }, { type: "custom", customType: "pi-web:subagent-result", data: {
      version: 1, status: "completed", completedAt: "2026-01-01T00:01:00.000Z", result: "old result",
    } }] : [];
    const wrapper = {
      id, parentId, prompt, entries: metadata, cwd: dir, sessionFile: join(dir, `${id}.jsonl`),
      isAlive: () => true, isRunning: () => false, waitUntilReady: async () => {},
      inner: {
        sessionId: id, sessionFile: join(dir, `${id}.jsonl`),
        sessionManager: {
          getSessionId: () => id, getEntries: () => metadata,
          appendCustomEntry: (customType, data) => metadata.push({ type: "custom", customType, data }),
        },
        prompt: () => prompt.promise, getLastAssistantText: () => `${id} result`, abort: async () => {},
        sendCustomMessage: async (message, options) => { deliveries.push({ id, message, options }); },
      },
    };
    nodes.set(id, wrapper);
    return wrapper;
  }
  const controller = createSubagentController({
    getSession: (id) => nodes.get(id), registerSession: () => { throw new Error("fixture uses resume"); },
    reopenSession: async () => { throw new Error("unexpected reopen"); },
    resolveSessionPath: async (id) => nodes.get(id)?.sessionFile ?? null,
    invalidateSessionList: () => {}, isBuiltInSubagentsEnabled: () => true,
    onFamilySettled: (id, options) => events.push({ id, options, unsettled: hasUnsettledSubagentRun(id) }),
  });
  async function resume(child, background = false, extra = {}) {
    const execution = await controller.extensionRuntime.resume({
      parentContext: nodes.get(child.parentId).inner, parentToolCallId: `call-${executions.length}`,
      sessionId: child.id, task: "synthetic work", description: child.id, runInBackground: background, ...extra,
    });
    executions.push(execution.completion);
    return execution;
  }
  async function persist(wrapper, forkParent, version = 3) {
    const lines = [{ type: "session", version, id: wrapper.id, cwd: dir,
      timestamp: "2026-01-01T00:00:00.000Z", ...(forkParent ? { parentSession: forkParent.sessionFile } : {}) },
    ...wrapper.entries.map((entry, i) => ({ ...entry, id: `entry-${i}`, parentId: i ? `entry-${i - 1}` : null,
      timestamp: "2026-01-01T00:00:00.000Z" }))];
    await writeFile(wrapper.sessionFile, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");
  }
  return { dir, node, nodes, events, deliveries, controller, resume, persist, gate };
}

test("a completed intermediate child remains an ancestor while its grandchild runs", async (t) => {
  const h = await harness(t);
  h.node("root");
  const child = h.node("child", "root");
  const grandchild = h.node("grandchild", "child");
  const first = await h.resume(child);
  const second = await h.resume(grandchild);
  child.prompt.resolve();
  await first.completion;
  assert.equal(globalThis.__piSubagentRuns.has("child"), false, "terminal run records still leave the active map");
  assert.equal(hasUnsettledSubagentRun("root"), true);
  assert.equal(hasUnsettledSubagentRun("child"), true);
  assert.equal(hasUnsettledSubagentRun("grandchild"), false, "this API counts descendants, not itself");
  grandchild.prompt.resolve();
  await second.completion;
  assert.deepEqual(h.events.slice(-2).map(({ id, unsettled }) => [id, unsettled]), [["child", false], ["root", false]]);
  assert.equal(hasUnsettledSubagentRun("root"), false);
});

test("background dispatch, terminal cleanup, notification and the final parent reply have continuous occupancy", async (t) => {
  const h = await harness(t);
  const root = h.node("root");
  const child = h.node("child", "root");
  const ready = h.gate();
  const finalReply = h.gate();
  const entered = deferred();
  root.waitUntilReady = () => ready.promise;
  root.inner.sendCustomMessage = async () => {
    // This stands for the SDK's final agent_settled, before sendCustomMessage resolves.
    assert.equal(hasUnsettledSubagentRun("root"), true);
    entered.resolve();
    await finalReply.promise;
  };
  const observed = [];
  const execution = await h.resume(child, true, { onUpdate: () => observed.push(hasUnsettledSubagentRun("root")) });
  assert.equal(hasUnsettledSubagentRun("root"), true);
  child.prompt.resolve();
  const result = await execution.completion;
  assert.equal(globalThis.__piSubagentRuns.has("child"), false);
  assert.ok(observed.every(Boolean), "even the terminal onUpdate is covered");
  assert.equal(hasUnsettledSubagentRun("root"), true, "the completion-to-notifyParent gap is covered");
  const notifying = h.controller.extensionRuntime.notifyParent(result);
  assert.equal(hasUnsettledSubagentRun("root"), true);
  ready.resolve();
  await entered.promise;
  assert.ok(h.events.every(({ unsettled }) => unsettled), "no settled callback before the final reply returns");
  finalReply.resolve();
  await notifying;
  assert.deepEqual(h.events.at(-1), { id: "root", options: undefined, unsettled: false });
  assert.equal(hasUnsettledSubagentRun("root"), false);
});

for (const failingStage of ["ready", "send"]) {
  test(`failed ${failingStage} delivery releases its token and flags all ancestors`, async (t) => {
    const h = await harness(t);
    h.node("root");
    const child = h.node("child", "root");
    const grandchild = h.node("grandchild", "child");
    const execution = await h.resume(grandchild, true);
    grandchild.prompt.resolve();
    const result = await execution.completion;
    if (failingStage === "ready") child.waitUntilReady = async () => { throw new Error("delivery failed"); };
    else child.inner.sendCustomMessage = async () => { throw new Error("delivery failed"); };
    await assert.rejects(h.controller.extensionRuntime.notifyParent(result), /delivery failed/);
    assert.equal(hasUnsettledSubagentRun("root"), false);
    assert.deepEqual(h.events.slice(-2), ["child", "root"].map((id) => ({ id, options: { deliveryFailed: true }, unsettled: false })));
  });
}

test("already consumed results release pending occupancy without waking the parent", async (t) => {
  const h = await harness(t);
  const root = h.node("root");
  const child = h.node("child", "root");
  const execution = await h.resume(child, true);
  child.prompt.resolve();
  const result = await execution.completion;
  const ready = h.gate();
  root.waitUntilReady = () => ready.promise;
  const notifying = h.controller.extensionRuntime.notifyParent(result);
  h.controller.extensionRuntime.markResultConsumed(result);
  assert.equal(hasUnsettledSubagentRun("root"), true);
  ready.resolve();
  await notifying;
  assert.equal(h.deliveries.length, 0);
  assert.deepEqual(h.events.at(-1), { id: "root", options: undefined, unsettled: false });
});

test("an old pending notification cannot release a newer resume token, even with identical timestamps", async (t) => {
  const h = await harness(t);
  const root = h.node("root");
  const child = h.node("child", "root");
  const first = await h.resume(child, true);
  child.prompt.resolve();
  const firstResult = await first.completion;
  const oldReply = h.gate();
  const entered = deferred();
  root.inner.sendCustomMessage = async () => { entered.resolve(); await oldReply.promise; };
  const oldNotification = h.controller.extensionRuntime.notifyParent(firstResult);
  await entered.promise;
  child.prompt = h.gate();
  child.inner.prompt = () => child.prompt.promise;
  const second = await h.resume(child, true);
  child.prompt.resolve();
  const secondResult = await second.completion;
  secondResult.completedAt = firstResult.completedAt;
  oldReply.resolve();
  await oldNotification;
  assert.equal(hasUnsettledSubagentRun("root"), true, "new result still awaits its own delivery");
  const newReply = h.gate();
  root.inner.sendCustomMessage = () => newReply.promise;
  const newNotification = h.controller.extensionRuntime.notifyParent(secondResult);
  assert.equal(hasUnsettledSubagentRun("root"), true);
  newReply.resolve();
  await newNotification;
  assert.equal(hasUnsettledSubagentRun("root"), false);
});

test("independent families do not block or receive each other's rechecks", async (t) => {
  const h = await harness(t);
  h.node("root-a"); h.node("root-b");
  const a = h.node("child-a", "root-a");
  const b = h.node("child-b", "root-b");
  const first = await h.resume(a);
  const second = await h.resume(b);
  a.prompt.resolve();
  await first.completion;
  assert.equal(hasUnsettledSubagentRun("root-a"), false);
  assert.equal(hasUnsettledSubagentRun("root-b"), true);
  assert.deepEqual(h.events.map(({ id }) => id), ["root-a"]);
  b.prompt.resolve();
  await second.completion;
});

test("normal foreground runs release at terminal cleanup without awaiting a notification", async (t) => {
  const h = await harness(t);
  h.node("root");
  const child = h.node("child", "root");
  const execution = await h.resume(child);
  assert.equal(hasUnsettledSubagentRun("root"), true);
  child.prompt.resolve();
  assert.equal((await execution.completion).status, "completed");
  assert.equal(hasUnsettledSubagentRun("root"), false);
  assert.deepEqual(h.events, [{ id: "root", options: undefined, unsettled: false }]);
  assert.equal(h.deliveries.length, 0);
});

for (const background of [false, true]) {
  test(`cancelled queued ${background ? "background" : "foreground"} run releases and rechecks`, async (t) => {
    const h = await harness(t);
    h.node("root");
    const blocker = h.node("blocker", "root");
    const child = h.node("child", "root");
    const first = await h.resume(blocker);
    const second = await h.resume(child, background);
    assert.equal(second.run.status, "queued");
    await h.controller.abort("child");
    const result = await second.completion;
    assert.equal(result.status, "aborted");
    assert.equal(globalThis.__piSubagentRuns.has("child"), false);
    assert.equal(h.events.at(-1).unsettled, true, "the blocker still runs");
    if (background) await h.controller.extensionRuntime.notifyParent(result);
    blocker.prompt.resolve();
    await first.completion;
    assert.equal(hasUnsettledSubagentRun("root"), false);
  });
}

test("MCP preparation is occupied and stopping it keeps background occupancy until delivery", async (t) => {
  const h = await harness(t);
  h.node("root");
  const child = h.node("child", "root");
  const entered = deferred();
  child.prepareMcpForRun = (signal) => new Promise((resolve) => {
    signal.addEventListener("abort", () => resolve(false), { once: true });
    entered.resolve();
  });
  const execution = await h.resume(child, true);
  await entered.promise;
  assert.equal(hasUnsettledSubagentRun("root"), true);
  await h.controller.abort("child");
  const result = await execution.completion;
  assert.equal(result.status, "aborted");
  assert.equal(hasUnsettledSubagentRun("root"), true);
  await h.controller.extensionRuntime.notifyParent(result);
  assert.equal(hasUnsettledSubagentRun("root"), false);
});

test("metadata ancestry restores a completed ancestor without reopening its wrapper", async (t) => {
  const h = await harness(t);
  h.node("root");
  const middle = h.node("middle", "root");
  h.node("child", "middle");
  const grandchild = h.node("grandchild", "child");
  await h.persist(middle, undefined, 1);
  const before = await fileSnapshot(middle.sessionFile);
  h.nodes.delete("middle");
  const execution = await h.resume(grandchild);
  assert.equal(hasUnsettledSubagentRun("root"), true);
  grandchild.prompt.resolve();
  await execution.completion;
  assert.deepEqual(h.events.map(({ id }) => id), ["child", "middle", "root"]);
  assert.deepEqual(await fileSnapshot(middle.sessionFile), before, "observing old metadata must not migrate or rewrite the file");
});

test("an ordinary fork header never becomes a family edge", async (t) => {
  const h = await harness(t);
  const root = h.node("root");
  const fork = h.node("fork");
  h.node("child", "fork");
  const grandchild = h.node("grandchild", "child");
  await h.persist(fork, root);
  h.nodes.delete("fork");
  const execution = await h.resume(grandchild);
  assert.equal(hasUnsettledSubagentRun("fork"), true);
  assert.equal(hasUnsettledSubagentRun("root"), false);
  grandchild.prompt.resolve();
  await execution.completion;
  assert.deepEqual(h.events.map(({ id }) => id), ["child", "fork"]);
});

test("a consumed persisted result restores its ancestry before releasing, without reopening", async (t) => {
  const h = await harness(t);
  h.node("root");
  const child = h.node("child", "root");
  const grandchild = h.node("grandchild", "child");
  await h.persist(child, undefined, 1);
  await h.persist(grandchild, undefined, 1);
  const childBefore = await fileSnapshot(child.sessionFile);
  const grandchildBefore = await fileSnapshot(grandchild.sessionFile);
  h.nodes.delete("child");
  const result = await h.controller.get("grandchild");
  h.controller.extensionRuntime.markResultConsumed(result);
  const notifying = h.controller.extensionRuntime.notifyParent(result);
  assert.equal(hasUnsettledSubagentRun("root"), true);
  await notifying;
  assert.equal(hasUnsettledSubagentRun("root"), false);
  assert.equal(h.deliveries.length, 0);
  assert.deepEqual(h.events.map(({ id }) => id), ["child", "root"]);
  assert.deepEqual(await fileSnapshot(child.sessionFile), childBefore);
  assert.deepEqual(await fileSnapshot(grandchild.sessionFile), grandchildBefore);
});

test("malformed metadata cycles terminate traversal and recheck each ancestor once", async (t) => {
  const h = await harness(t);
  h.node("a", "b");
  h.node("b", "a");
  const child = h.node("child", "a");
  const execution = await h.resume(child);
  assert.equal(hasUnsettledSubagentRun("a"), true);
  assert.equal(hasUnsettledSubagentRun("b"), true);
  assert.equal(hasUnsettledSubagentRun("unrelated"), false);
  child.prompt.resolve();
  await execution.completion;
  assert.deepEqual(h.events.map(({ id }) => id), ["a", "b"]);
});
