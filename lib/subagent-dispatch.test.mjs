import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });

let createDispatchRuntime;
try {
  ({ createDispatchRuntime } = await jiti.import("./subagent-dispatch.ts"));
} catch {
  // Expected during red phase: module does not exist yet.
}

// ---------------------------------------------------------------------------
// Fake dependency factories
//
// Follows the hand-written-mock convention of
// lib/subagent-runtime.test.mjs: plain objects injected into the unit under
// test, with no mocking library.  Every fake records the values it was given
// so assertions can verify that the dispatch module drove real resolution
// logic through the injected dependencies — never hard-coded fixture strings.
// ---------------------------------------------------------------------------

/**
 * Build a fake controller whose start() resolves the run info compatible with
 * the upstream SubagentRunInfo shape (no model/thinking/tools on the run —
 * those are resolved inside the production controller).  The completion
 * promise is controllable so tests can drive the child lifecycle
 * deterministically.
 */
function createFakeController() {
  const calls = { start: [], steer: [], abort: [] };
  const runs = new Map();
  let runId = 0;

  return {
    extensionRuntime: {
      start: async (request) => {
        calls.start.push(request);
        const id = `child-${++runId}`;

        const run = {
          sessionId: id,
          sessionPath: `/tmp/${id}.jsonl`,
          parentSessionId: request.parentContext?.sessionManager?.getSessionId?.()
            ?? request.parentContext?.sessionManager?.sessionId
            ?? "parent-session",
          parentToolCallId: request.parentToolCallId,
          profile: request.profile ?? "general-purpose",
          description: request.description,
          task: request.task,
          runInBackground: request.runInBackground ?? false,
          status: "queued",
          createdAt: new Date().toISOString(),
        };

        let resolveCompletion;
        const completion = new Promise((resolve) => { resolveCompletion = resolve; });
        runs.set(id, { run, resolveCompletion });

        return { run, completion };
      },
    },
    steer: async (sessionId, message) => {
      calls.steer.push([sessionId, message]);
    },
    abort: async (sessionId) => {
      calls.abort.push(sessionId);
    },
    _calls: calls,
    _runs: runs,
    _resolve: (sessionId, status = "completed", result = "Done") => {
      const stored = runs.get(sessionId);
      if (stored) {
        stored.resolveCompletion({
          ...stored.run,
          status,
          completedAt: new Date().toISOString(),
          ...(result ? { result } : {}),
        });
      }
    },
  };
}

/**
 * Build a dispatch runtime from injected deps.  Mirrors the production
 * binding in lib/subagent-dispatch.ts, but every dependency is supplied
 * by the test.
 */
function createTestRuntime({
  controller,
  parentState = { model: "zenmux/parent-model", thinking: "low" },
} = {}) {
  return createDispatchRuntime({
    getController: () => controller,
    readSettings: () => ({}),
    getParentState: () => parentState,
  });
}

// ---------------------------------------------------------------------------
// S1 — Programmatic dispatch API: start / steer / abort / signal linkage
// ---------------------------------------------------------------------------

test("S1: createDispatchRuntime exposes startSubagentDispatch", () => {
  const runtime = createTestRuntime({ controller: createFakeController() });
  assert.equal(typeof runtime.startSubagentDispatch, "function");
});

test("S1: foreground dispatch awaits completion and returns final text", async () => {
  const controller = createFakeController();
  const runtime = createTestRuntime({ controller });

  const handle = await runtime.startSubagentDispatch("parent-session", {
    task: "Summarise the repo",
    description: "Summarise",
    runInBackground: false,
  });

  assert.equal(typeof handle.dispatchId, "string");
  assert.equal(typeof handle.completion, "object");

  // Drive the child to completion through the fake controller.
  const childSessionId = controller._calls.start[0].sessionId;
  controller._resolve(childSessionId, "completed", "Summary text");

  const event = await handle.completion;
  assert.equal(event.phase, "completed");
  assert.equal(event.result, "Summary text");
});

test("S1: background dispatch returns a handle immediately", async () => {
  const controller = createFakeController();
  const runtime = createTestRuntime({ controller });

  const handle = await runtime.startSubagentDispatch("parent-session", {
    task: "Investigate the parser",
    description: "Investigate",
    runInBackground: true,
  });

  assert.equal(typeof handle.dispatchId, "string");
  assert.equal(typeof handle.steer, "function");
  assert.equal(typeof handle.abort, "function");
  assert.equal(typeof handle.completion, "object");

  const childSessionId = controller._calls.start[0].sessionId;
  controller._resolve(childSessionId, "completed", "Investigation done");
  await handle.completion;
});

test("S1: steer forwards a message to the child session", async () => {
  const controller = createFakeController();
  const runtime = createTestRuntime({ controller });

  const handle = await runtime.startSubagentDispatch("parent-session", {
    task: "Investigate the parser",
    description: "Investigate",
    runInBackground: true,
  });

  await handle.steer("Focus on the error path");
  assert.deepEqual(controller._calls.steer[0][1], "Focus on the error path");

  const childSessionId = controller._calls.start[0].sessionId;
  controller._resolve(childSessionId, "completed", "Done");
  await handle.completion;
});

test("S1: abort terminates the child and marks the event aborted", async () => {
  const controller = createFakeController();
  const runtime = createTestRuntime({ controller });

  const handle = await runtime.startSubagentDispatch("parent-session", {
    task: "A long-running task",
    description: "Long task",
    runInBackground: true,
  });

  await handle.abort();
  assert.equal(controller._calls.abort.length, 1);

  const event = await handle.completion;
  assert.equal(event.phase, "aborted");
});

test("S1: parent AbortSignal aborts the child", async () => {
  const controller = createFakeController();
  const runtime = createTestRuntime({ controller });
  const ac = new AbortController();

  const handle = await runtime.startSubagentDispatch("parent-session", {
    task: "A task we will cancel",
    description: "Cancel task",
    runInBackground: false,
    signal: ac.signal,
  });

  ac.abort();

  const event = await handle.completion;
  assert.equal(event.phase, "aborted");
});

test("S1: started event is emitted before child settles", async () => {
  const controller = createFakeController();
  const runtime = createTestRuntime({ controller });
  const phases = [];

  const handle = await runtime.startSubagentDispatch("parent-session", {
    task: "Track phases",
    description: "Phases",
    runInBackground: true,
    onUpdate: (event) => phases.push(event.phase),
  });

  const childSessionId = controller._calls.start[0].sessionId;
  controller._resolve(childSessionId, "completed", "Done");
  await handle.completion;

  assert.deepEqual(phases, ["started", "completed"]);
});

test("S1: onUpdate exception does not break completion", async () => {
  const controller = createFakeController();
  const runtime = createTestRuntime({ controller });

  const handle = await runtime.startSubagentDispatch("parent-session", {
    task: "Error subscriber",
    description: "Error sub",
    runInBackground: true,
    onUpdate: () => { throw new Error("subscriber exploded"); },
  });

  const childSessionId = controller._calls.start[0].sessionId;
  controller._resolve(childSessionId, "completed", "Done");

  // Must not throw.
  const event = await handle.completion;
  assert.equal(event.phase, "completed");
});

test("S1: childSessionId is populated in completion event", async () => {
  const controller = createFakeController();
  const runtime = createTestRuntime({ controller });

  const handle = await runtime.startSubagentDispatch("parent-session", {
    task: "Check child id",
    description: "Child id",
    runInBackground: true,
  });

  const childSessionId = controller._calls.start[0].sessionId;
  controller._resolve(childSessionId, "completed", "Done");

  const event = await handle.completion;
  assert.equal(event.childSessionId, childSessionId);
});

test("S1: dispatchId is unique per dispatch", async () => {
  const controller = createFakeController();
  const runtime = createTestRuntime({ controller });

  const h1 = await runtime.startSubagentDispatch("parent-session", {
    task: "First",
    description: "First",
    runInBackground: true,
  });
  const h2 = await runtime.startSubagentDispatch("parent-session", {
    task: "Second",
    description: "Second",
    runInBackground: true,
  });

  assert.notEqual(h1.dispatchId, h2.dispatchId);

  // Cleanup.
  controller._resolve(controller._calls.start[0].sessionId, "completed", "Done");
  controller._resolve(controller._calls.start[1].sessionId, "completed", "Done");
  await Promise.all([h1.completion, h2.completion]);
});

// ---------------------------------------------------------------------------
// S4 — Lifecycle events carry effective model / thinking (parent-state fallback)
//
// In this slice the dispatch module resolves model/thinking from the
// three-level fallback: dispatch param → parent session state.  Profile-level
// resolution is handled inside the production controller and will be surfaced
// in a later slice (G4 deep integration).
// ---------------------------------------------------------------------------

test("S4: effectiveModel uses dispatch param when provided", async () => {
  const controller = createFakeController();
  const runtime = createTestRuntime({
    controller,
    parentState: { model: "zenmux/parent-model", thinking: null },
  });

  const handle = await runtime.startSubagentDispatch("parent-session", {
    task: "Model override",
    description: "Model override",
    model: "zenmux/claude-sonnet-4-6",
    runInBackground: true,
  });

  const childSessionId = controller._calls.start[0].sessionId;
  controller._resolve(childSessionId, "completed", "Done");

  const event = await handle.completion;
  assert.equal(event.effectiveModel, "zenmux/claude-sonnet-4-6");
});

test("S4: effectiveModel falls back to parent session model", async () => {
  const controller = createFakeController();
  const runtime = createTestRuntime({
    controller,
    parentState: { model: "zenmux/parent-model", thinking: null },
  });

  const handle = await runtime.startSubagentDispatch("parent-session", {
    task: "Parent model",
    description: "Parent model",
    runInBackground: true,
  });

  const childSessionId = controller._calls.start[0].sessionId;
  controller._resolve(childSessionId, "completed", "Done");

  const event = await handle.completion;
  assert.equal(event.effectiveModel, "zenmux/parent-model");
});

test("S4: effectiveThinking uses dispatch param when provided", async () => {
  const controller = createFakeController();
  const runtime = createTestRuntime({
    controller,
    parentState: { model: "zenmux/default", thinking: "low" },
  });

  const handle = await runtime.startSubagentDispatch("parent-session", {
    task: "Thinking override",
    description: "Thinking override",
    thinking: "high",
    runInBackground: true,
  });

  const childSessionId = controller._calls.start[0].sessionId;
  controller._resolve(childSessionId, "completed", "Done");

  const event = await handle.completion;
  assert.equal(event.effectiveThinking, "high");
});

test("S4: effectiveThinking falls back to parent session thinking", async () => {
  const controller = createFakeController();
  const runtime = createTestRuntime({
    controller,
    parentState: { model: "zenmux/default", thinking: "low" },
  });

  const handle = await runtime.startSubagentDispatch("parent-session", {
    task: "Parent thinking",
    description: "Parent thinking",
    runInBackground: true,
  });

  const childSessionId = controller._calls.start[0].sessionId;
  controller._resolve(childSessionId, "completed", "Done");

  const event = await handle.completion;
  assert.equal(event.effectiveThinking, "low");
});

test("S4: missing parent thinking resolves to null", async () => {
  const controller = createFakeController();
  const runtime = createTestRuntime({
    controller,
    parentState: { model: "zenmux/default", thinking: null },
  });

  const handle = await runtime.startSubagentDispatch("parent-session", {
    task: "No thinking",
    description: "No thinking",
    runInBackground: true,
  });

  const childSessionId = controller._calls.start[0].sessionId;
  controller._resolve(childSessionId, "completed", "Done");

  const event = await handle.completion;
  assert.equal(event.effectiveThinking, null);
});

test("S4: started event also carries effective model/thinking", async () => {
  const controller = createFakeController();
  const runtime = createTestRuntime({
    controller,
    parentState: { model: "zenmux/parent-model", thinking: "medium" },
  });
  const phases = [];

  const handle = await runtime.startSubagentDispatch("parent-session", {
    task: "Started carries model",
    description: "Started model",
    model: "zenmux/explicit-model",
    thinking: "high",
    runInBackground: true,
    onUpdate: (event) => phases.push({ phase: event.phase, model: event.effectiveModel, thinking: event.effectiveThinking }),
  });

  const childSessionId = controller._calls.start[0].sessionId;
  controller._resolve(childSessionId, "completed", "Done");
  await handle.completion;

  const started = phases.find((p) => p.phase === "started");
  assert.ok(started, "started event must be emitted");
  assert.equal(started.model, "zenmux/explicit-model");
  assert.equal(started.thinking, "high");
});
