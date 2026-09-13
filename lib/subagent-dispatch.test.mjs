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
 * Build a fake controller whose start() resolves the run info with G4 fields
 * (model, thinking, activeTools) on the run — matching the production
 * controller's three-level fallback resolution.  The resolved values are
 * fixed constants that differ from any request params, so the dispatch
 * layer's "read from run" behavior is provably distinct from "echo request
 * params".
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

        // G4: the production controller resolves model/thinking/activeTools
        // through three-level fallback and puts them on the run.  The fake
        // mirrors this by putting fixed resolved values on the run that are
        // intentionally different from request params, so the dispatch's
        // "read from run" path is provably distinct from echoing back params.
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
          // G4: authoritative resolved values from the controller.
          model: "zenmux/resolved-model",
          thinking: "medium",
          activeTools: ["read", "edit", "write"],
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
 * Like createFakeController, but allows overriding specific fields on the run
 * object returned by start().  Used to test edge cases like undefined model
 * or null thinking.
 */
function createFakeControllerWithRunOverrides(runOverrides) {
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
          model: "zenmux/resolved-model",
          thinking: "medium",
          activeTools: ["read", "edit", "write"],
          ...runOverrides,
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
// S4 — Lifecycle events carry authoritative effective model / thinking
//
// The dispatch layer reads model/thinking/activeTools from the run object
// returned by the controller — never re-resolves from params or parentState.
// The fake controller returns fixed resolved values that differ from any
// request params, proving the dispatch reads from the run.
// ---------------------------------------------------------------------------

test("S4: effectiveModel reads from run, not request params", async () => {
  const controller = createFakeController();
  const runtime = createTestRuntime({
    controller,
    parentState: { model: "zenmux/parent-model", thinking: null },
  });

  // Request specifies one model; the fake controller resolves a different one.
  const handle = await runtime.startSubagentDispatch("parent-session", {
    task: "Run-anchored model",
    description: "Run model",
    model: "zenmux/request-model",
    runInBackground: true,
  });

  const childSessionId = controller._calls.start[0].sessionId;
  controller._resolve(childSessionId, "completed", "Done");

  const event = await handle.completion;
  // Must use the controller's resolved value, not the request param.
  assert.equal(event.effectiveModel, "zenmux/resolved-model");
});

test("S4: effectiveThinking reads from run, not request params", async () => {
  const controller = createFakeController();
  const runtime = createTestRuntime({
    controller,
    parentState: { model: "zenmux/default", thinking: "low" },
  });

  // Request says "high"; the fake controller resolves "medium".
  const handle = await runtime.startSubagentDispatch("parent-session", {
    task: "Run-anchored thinking",
    description: "Run thinking",
    thinking: "high",
    runInBackground: true,
  });

  const childSessionId = controller._calls.start[0].sessionId;
  controller._resolve(childSessionId, "completed", "Done");

  const event = await handle.completion;
  // Must use the controller's resolved value, not the request param.
  assert.equal(event.effectiveThinking, "medium");
});

test("S4: effectiveTools reads from run.activeTools", async () => {
  const controller = createFakeController();
  const runtime = createTestRuntime({
    controller,
    parentState: { model: "zenmux/default", thinking: null },
  });

  const handle = await runtime.startSubagentDispatch("parent-session", {
    task: "Tool list",
    description: "Tools",
    runInBackground: true,
  });

  const childSessionId = controller._calls.start[0].sessionId;
  controller._resolve(childSessionId, "completed", "Done");

  const event = await handle.completion;
  // Fake controller returns ["read", "edit", "write"], not the request's defaults.
  assert.deepEqual(event.effectiveTools, ["read", "edit", "write"]);
});

test("S4: started event carries run values, not request params", async () => {
  const controller = createFakeController();
  const runtime = createTestRuntime({
    controller,
    parentState: { model: "zenmux/parent-model", thinking: "medium" },
  });
  const phases = [];

  // Request says model=A, thinking=B; fake controller resolves model=C, thinking=D.
  const handle = await runtime.startSubagentDispatch("parent-session", {
    task: "Started carries run values",
    description: "Started run",
    model: "zenmux/request-model",
    thinking: "high",
    runInBackground: true,
    onUpdate: (event) => phases.push({
      phase: event.phase,
      model: event.effectiveModel,
      thinking: event.effectiveThinking,
    }),
  });

  const childSessionId = controller._calls.start[0].sessionId;
  controller._resolve(childSessionId, "completed", "Done");
  await handle.completion;

  const started = phases.find((p) => p.phase === "started");
  assert.ok(started, "started event must be emitted");
  // Must use the controller's resolved values, not the request params.
  assert.equal(started.model, "zenmux/resolved-model");
  assert.equal(started.thinking, "medium");
});

test("S4: terminal event also carries run values", async () => {
  const controller = createFakeController();
  const runtime = createTestRuntime({
    controller,
    parentState: { model: "zenmux/parent", thinking: null },
  });

  const handle = await runtime.startSubagentDispatch("parent-session", {
    task: "Terminal run values",
    description: "Terminal",
    model: "zenmux/req",
    thinking: "high",
    runInBackground: true,
  });

  const childSessionId = controller._calls.start[0].sessionId;
  controller._resolve(childSessionId, "completed", "Done");

  const event = await handle.completion;
  // Terminal event also reads from the run, not from params.
  assert.equal(event.effectiveModel, "zenmux/resolved-model");
  assert.equal(event.effectiveThinking, "medium");
});

// ---------------------------------------------------------------------------
// S6 — persistSession forwarding
//
// The dispatch layer forwards persistSession to the controller so the
// runtime can decide whether to persist or use an in-memory session.
// ---------------------------------------------------------------------------

test("S6: persistSession:false forwards to the controller request", async () => {
  const controller = createFakeController();
  const runtime = createTestRuntime({ controller });

  const handle = await runtime.startSubagentDispatch("parent-session", {
    task: "Fire-and-forget",
    description: "In-memory",
    persistSession: false,
    runInBackground: true,
  });

  const childSessionId = controller._calls.start[0].sessionId;
  controller._resolve(childSessionId, "completed", "Done");

  const event = await handle.completion;
  assert.equal(event.phase, "completed");

  // The dispatch module must forward persistSession: false on the request.
  assert.equal(controller._calls.start[0].persistSession, false,
    "dispatch must forward persistSession:false to the controller");
});

test("S6: persistSession:true forwards to the controller request", async () => {
  const controller = createFakeController();
  const runtime = createTestRuntime({ controller });

  const handle = await runtime.startSubagentDispatch("parent-session", {
    task: "Persisted run",
    description: "Persisted",
    persistSession: true,
    runInBackground: true,
  });

  const childSessionId = controller._calls.start[0].sessionId;
  controller._resolve(childSessionId, "completed", "Done");

  await handle.completion;

  // The dispatch module must forward persistSession: true on the request.
  assert.equal(controller._calls.start[0].persistSession, true,
    "dispatch must forward persistSession:true to the controller");
});

test("S6: undefined persistSession defaults to undefined on request", async () => {
  const controller = createFakeController();
  const runtime = createTestRuntime({ controller });

  await runtime.startSubagentDispatch("parent-session", {
    task: "Default",
    description: "Default persist",
    runInBackground: true,
  });

  // When not specified, persistSession is undefined on the request — the
  // runtime resolves the default (true) from the profile.
  assert.equal(controller._calls.start[0].persistSession, undefined,
    "dispatch must not inject a default when persistSession is omitted");
});

// ---------------------------------------------------------------------------
// S4 edge cases — empty model / thinking on run
//
// When the controller's run has no model or thinking (e.g. fallback resolved
// nothing), the dispatch event must carry empty-string / null, never undefined.
// ---------------------------------------------------------------------------

test("S4 edge: empty model on run produces effectiveModel ''", async () => {
  // Build a controller whose start() returns runs with model=undefined.
  const controller = createFakeControllerWithRunOverrides({ model: undefined });

  const runtime = createTestRuntime({
    controller,
    parentState: { model: undefined, thinking: null },
  });

  const handle = await runtime.startSubagentDispatch("parent-session", {
    task: "No model",
    description: "No model",
    runInBackground: true,
  });

  const childSessionId = controller._calls.start[0].sessionId;
  controller._resolve(childSessionId, "completed", "Done");

  const event = await handle.completion;
  // effectiveModel must be "" (empty string), never undefined.
  assert.equal(event.effectiveModel, "",
    "effectiveModel must be '' when run.model is undefined");
});

test("S4 edge: null thinking on run produces effectiveThinking null", async () => {
  // Build a controller whose start() returns runs with thinking=null.
  const controller = createFakeControllerWithRunOverrides({ thinking: null });

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
  // effectiveThinking must be null, never undefined.
  assert.equal(event.effectiveThinking, null,
    "effectiveThinking must be null when run.thinking is null");
});
