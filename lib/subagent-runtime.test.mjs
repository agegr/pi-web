import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

// Hermetic agent dir so start() never reads the developer's real ~/.pi/agent.
process.env.PI_CODING_AGENT_DIR = process.env.PI_CODING_AGENT_DIR
  ?? await mkdtemp(join(tmpdir(), "pi-web-subagent-runtime-"));
process.on("exit", () => {
  try { rmSync(process.env.PI_CODING_AGENT_DIR, { recursive: true, force: true }); } catch { /* already cleaned */ }
});

const { createSubagentController } = await createJiti(import.meta.url).import("./subagent-runtime.ts");

// ---------------------------------------------------------------------------
// Helpers for behavior tests
// ---------------------------------------------------------------------------

/** Minimal fake parent that passes the alive/sessionFile guards in start(). */
function fakeParent(overrides = {}) {
  return {
    cwd: "/tmp",
    sessionFile: "/tmp/parent.jsonl",
    isAlive: () => true,
    isRunning: () => false,
    waitUntilReady: async () => {},
    inner: {
      sessionManager: {
        getSessionId: () => "parent-session",
        buildSessionContext: () => ({ messages: [] }),
      },
      model: undefined,
      agent: { state: undefined },
      sendCustomMessage: async () => {},
      ...overrides,
    },
  };
}

/** Clear globalThis subagent state between tests. */
function clearSubagentState() {
  delete globalThis.__piSubagentRuns;
  delete globalThis.__piSubagentQueue;
}

function completedRun() {
  return {
    sessionId: "child-session",
    sessionPath: "/tmp/child.jsonl",
    parentSessionId: "parent-session",
    parentToolCallId: "tool-call",
    profile: "Explore",
    description: "Inspect parser",
    task: "Find the parser",
    runInBackground: true,
    status: "completed",
    createdAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:01:00.000Z",
    result: "Parser found",
  };
}

test("completion notification reopens an idle parent and uses its current session", async () => {
  const delivered = [];
  const reopened = [];
  let ready = false;
  let parent;
  const liveParent = {
    cwd: "/tmp",
    sessionFile: "/tmp/parent.jsonl",
    isAlive: () => true,
    isRunning: () => false,
    waitUntilReady: async () => { ready = true; },
    inner: {
      sendCustomMessage: async (message, options) => delivered.push({ message, options }),
    },
  };
  const controller = createSubagentController({
    getSession: () => parent,
    registerSession: () => {},
    reopenSession: async (sessionId, sessionFile) => {
      reopened.push([sessionId, sessionFile]);
      parent = liveParent;
      return liveParent;
    },
    resolveSessionPath: async () => "/tmp/parent.jsonl",
    invalidateSessionList: () => {},
  });

  await controller.extensionRuntime.notifyParent(completedRun());

  assert.deepEqual(reopened, [["parent-session", "/tmp/parent.jsonl"]]);
  assert.equal(ready, true);
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].message.content, "Parser found");
  assert.equal(delivered[0].message.details.sessionId, "child-session");
  assert.deepEqual(delivered[0].options, { deliverAs: "followUp", triggerTurn: true });
});

test("disabled built-in subagents reject stale Agent calls before starting", async () => {
  const controller = createSubagentController({
    getSession: () => { throw new Error("must not inspect a parent"); },
    registerSession: () => {},
    reopenSession: async () => { throw new Error("unused"); },
    resolveSessionPath: async () => null,
    invalidateSessionList: () => {},
    isBuiltInSubagentsEnabled: () => false,
  });

  await assert.rejects(
    controller.extensionRuntime.start({
      parentContext: { sessionManager: { getSessionId: () => "parent" } },
      parentToolCallId: "call",
      profile: "explore",
      task: "Inspect",
      description: "Inspect",
    }),
    /built-in sub-agents are disabled/,
  );
});

test("resume reuses the persisted child session and keeps its session id", async () => {
  const calls = [];
  const entries = [
    { type: "custom", customType: "pi-web:subagent", data: {
      version: 1,
      parentSessionId: "parent",
      parentSessionPath: "/tmp/parent.jsonl",
      parentToolCallId: "old-call",
      profile: "explore",
      description: "old task",
      task: "old",
      runInBackground: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      resourceSnapshot: { version: 1, appendSystemPrompt: [], tools: [], loadSkills: false, loadExtensions: false },
    } },
    { type: "custom", customType: "pi-web:subagent-result", data: {
      version: 1, status: "completed", completedAt: "2026-01-01T00:01:00.000Z", result: "old result",
    } },
  ];
  const childInner = {
    sessionId: "child",
    sessionFile: "/tmp/child.jsonl",
    sessionManager: { getEntries: () => entries, appendCustomEntry: (type, data) => entries.push({ type: "custom", customType: type, data }) },
    prompt: async (task) => { calls.push(task); },
    getLastAssistantText: () => "new result",
    abort: async () => {},
  };
  const child = { inner: childInner, sessionFile: childInner.sessionFile, cwd: "/tmp", isAlive: () => true, isRunning: () => false, waitUntilReady: async () => {} };
  const parent = { inner: { sessionManager: { getSessionId: () => "parent" } }, sessionFile: "/tmp/parent.jsonl", cwd: "/tmp", isAlive: () => true, isRunning: () => false, waitUntilReady: async () => {} };
  const controller = createSubagentController({
    getSession: (id) => id === "child" ? child : parent,
    registerSession: () => {},
    reopenSession: async () => child,
    resolveSessionPath: async () => child.sessionFile,
    invalidateSessionList: () => {},
    isBuiltInSubagentsEnabled: () => true,
  });
  const execution = await controller.extensionRuntime.resume({
    parentContext: parent.inner,
    parentToolCallId: "new-call",
    sessionId: "child",
    task: "continue this",
    description: "Continue task",
  });
  const result = await execution.completion;
  assert.equal(execution.run.sessionId, "child");
  assert.equal(result.sessionId, "child");
  assert.equal(result.status, "completed");
  assert.deepEqual(calls, ["continue this"]);
});

test("resume rejects a child owned by another parent", async () => {
  const controller = createSubagentController({
    getSession: (id) => id === "parent" ? { inner: { sessionManager: { getSessionId: () => "parent" } }, sessionFile: "/tmp/parent.jsonl", cwd: "/tmp", isAlive: () => true, isRunning: () => false, waitUntilReady: async () => {} } : undefined,
    registerSession: () => {},
    reopenSession: async () => { throw new Error("unused"); },
    resolveSessionPath: async () => null,
    invalidateSessionList: () => {},
    isBuiltInSubagentsEnabled: () => true,
  });
  await assert.rejects(controller.extensionRuntime.resume({
    parentContext: { sessionManager: { getSessionId: () => "parent" } },
    parentToolCallId: "call",
    sessionId: "missing",
    task: "continue",
    description: "Continue",
  }), /Subagent not found/);
});

// ---------------------------------------------------------------------------
// G4 — Effective model/thinking surfaced in SubagentRunInfo and resourceSnapshot
// ---------------------------------------------------------------------------

test("G4: runtime resolves model via three-level fallback before resourceSnapshot", async () => {
  const source = await readFile(new URL("./subagent-runtime.ts", import.meta.url), "utf8");

  // The three-level fallback chain for model: request.model ?? profile.model
  // resolved through parseSubagentModel, falling back to parent.inner.model.
  assert.match(source, /parseSubagentModel\(parentModelRuntime, request\.model \?\? profile\.model\)/);
  assert.match(source, /parent\.inner\.model as ReturnType<ModelRuntime\["getModel"\]>/);

  // The three-level fallback chain for thinking: request → profile → parent state.
  assert.match(source, /request\.thinking \?\? profile\.thinking \?\? parent\.inner\.agent\.state\?\.thinkingLevel/);

  // Authoritative resolvedModel is surfaced into resourceSnapshot.
  assert.match(source, /model: effectiveModel/);
  assert.match(source, /thinking: thinking \?\? null/);

  // The resourceSnapshot block must contain model and thinking assignments.
  const snapshotStart = source.indexOf("resourceSnapshot:");
  const snapshotBlock = source.slice(snapshotStart, source.indexOf("};", snapshotStart) + 2);
  assert.match(snapshotBlock, /model: effectiveModel/);
  assert.match(snapshotBlock, /thinking: thinking \?\? null/);
});

test("G4: runtime puts effective model/thinking into initialRun lifecycle event", async () => {
  const source = await readFile(new URL("./subagent-runtime.ts", import.meta.url), "utf8");

  // The initialRun object must carry model and thinking from the resolved values.
  const runStart = source.indexOf("const initialRun: SubagentRunInfo");
  const runBlock = source.slice(runStart, source.indexOf("};", runStart) + 2);
  assert.match(runBlock, /model: effectiveModel/);
  assert.match(runBlock, /thinking: thinking \?\? null/);
});

test("G4: dispatch module reads authoritative values from the run, not transitional fallback", async () => {
  const source = await readFile(new URL("./subagent-dispatch.ts", import.meta.url), "utf8");

  // After G4 the readEffectiveModel/readEffectiveThinking must read from run.
  assert.match(source, /run\.model \?\? ""/);
  assert.match(source, /run\.thinking \?\? null/);

  // The old transitional fallback (params.model ?? parentState.model) must
  // have been removed.
  assert.doesNotMatch(source, /params\.model \?\? parentState\.model/);
  assert.doesNotMatch(source, /params\.thinking \?\? parentState\.thinking/);
});

// ---------------------------------------------------------------------------
// G4 — Behavior: three-level fallback for model/thinking
// ---------------------------------------------------------------------------

test("G4 behavior: thinking fallback reaches parent state when no request or profile value", async () => {
  clearSubagentState();
  try {
    // Parent has an invalid thinking level — start() must reject at the
    // thinking validation, proving the fallback resolved to the parent's live value.
    const parent = fakeParent({
      agent: { state: { thinkingLevel: "invalid-level" } },
    });
    const controller = createSubagentController({
      getSession: () => parent,
      registerSession: () => {},
      reopenSession: async () => { throw new Error("unused"); },
      resolveSessionPath: async () => null,
      invalidateSessionList: () => {},
      isBuiltInSubagentsEnabled: () => true,
    });

    // No request.thinking, no profile.thinking (builtin "explore" has none).
    // Fallback resolves to parent's "invalid-level" → validation rejects.
    await assert.rejects(
      controller.extensionRuntime.start({
        parentContext: { sessionManager: { getSessionId: () => "parent-session" } },
        parentToolCallId: "call",
        profile: "explore",
        task: "Test thinking fallback",
        description: "Thinking fallback",
      }),
      /Invalid subagent thinking level: invalid-level/,
    );
  } finally {
    clearSubagentState();
  }
});

test("G4 behavior: valid request thinking bypasses parent's invalid thinking", async () => {
  clearSubagentState();
  try {
    // Parent has an invalid thinking level, but the request supplies a valid one.
    const parent = fakeParent({
      agent: { state: { thinkingLevel: "invalid-level" } },
      model: { provider: "parentprov", id: "parentmodel" },
    });
    const controller = createSubagentController({
      getSession: () => parent,
      registerSession: () => {},
      reopenSession: async () => { throw new Error("unused"); },
      resolveSessionPath: async () => null,
      invalidateSessionList: () => {},
      isBuiltInSubagentsEnabled: () => true,
    });

    const updates = [];
    const handle = await controller.extensionRuntime.start({
      parentContext: { sessionManager: { getSessionId: () => "parent-session" } },
      parentToolCallId: "call",
      profile: "explore",
      task: "Test request thinking",
      description: "Request thinking",
      thinking: "high",
      onUpdate: (run) => updates.push(run),
    });

    // Request level wins the chain; model falls back to parent's live model.
    assert.ok(handle.run, "start() must return a run object");
    assert.equal(handle.run.status, "running");
    assert.equal(handle.run.thinking, "high");
    assert.equal(handle.run.model, "parentprov/parentmodel");
    // onUpdate fires multiple times (initial run + queue status transitions).
    // The first update carries the initial run payload with the resolved values.
    assert.ok(updates.length >= 1, "onUpdate must fire at least once");
    assert.equal(updates[0].thinking, "high");
    assert.equal(updates[0].model, "parentprov/parentmodel");
    assert.equal(updates[0].sessionId, handle.run.sessionId);
  } finally {
    clearSubagentState();
  }
});

test("G4 behavior: request model wins the fallback chain via the parent model runtime", async () => {
  clearSubagentState();
  try {
    const parent = fakeParent({
      model: { provider: "parentprov", id: "parentmodel" },
      modelRuntime: {
        getModel: (provider, modelId) =>
          provider === "reqprov" && modelId === "reqmodel"
            ? { provider: "reqprov", id: "reqmodel" }
            : undefined,
        getModels: () => [],
        refresh: async () => {},
      },
    });
    const controller = createSubagentController({
      getSession: () => parent,
      registerSession: () => {},
      reopenSession: async () => { throw new Error("unused"); },
      resolveSessionPath: async () => null,
      invalidateSessionList: () => {},
      isBuiltInSubagentsEnabled: () => true,
    });

    const handle = await controller.extensionRuntime.start({
      parentContext: { sessionManager: { getSessionId: () => "parent-session" } },
      parentToolCallId: "call",
      profile: "explore",
      task: "Test request model",
      description: "Request model",
      model: "reqprov/reqmodel",
    });

    assert.equal(handle.run.model, "reqprov/reqmodel");
  } finally {
    clearSubagentState();
  }
});

test("G4 behavior: unresolvable request model rejects with a not-found error", async () => {
  clearSubagentState();
  try {
    const parent = fakeParent({
      model: { provider: "parentprov", id: "parentmodel" },
      modelRuntime: { getModel: () => undefined, getModels: () => [] },
    });
    const controller = createSubagentController({
      getSession: () => parent,
      registerSession: () => {},
      reopenSession: async () => { throw new Error("unused"); },
      resolveSessionPath: async () => null,
      invalidateSessionList: () => {},
      isBuiltInSubagentsEnabled: () => true,
    });

    await assert.rejects(
      controller.extensionRuntime.start({
        parentContext: { sessionManager: { getSessionId: () => "parent-session" } },
        parentToolCallId: "call",
        profile: "explore",
        task: "Test bad model",
        description: "Bad model",
        model: "noexist/nonexist",
      }),
      /Subagent model not found: noexist\/nonexist/,
    );
  } finally {
    clearSubagentState();
  }
});

test("G4 behavior: activeTools is carried on the run object", async () => {
  clearSubagentState();
  try {
    const parent = fakeParent({
      modelRuntime: { getModel: () => undefined, getModels: () => [], refresh: async () => {}, getAvailableSnapshot: () => [] },
    });
    const controller = createSubagentController({
      getSession: () => parent,
      registerSession: () => {},
      reopenSession: async () => { throw new Error("unused"); },
      resolveSessionPath: async () => null,
      invalidateSessionList: () => {},
      isBuiltInSubagentsEnabled: () => true,
    });

    const handle = await controller.extensionRuntime.start({
      parentContext: { sessionManager: { getSessionId: () => "parent-session" } },
      parentToolCallId: "call",
      profile: "explore",
      task: "Test activeTools",
      description: "activeTools",
      tools: ["read", "bash"],
    });

    // The run must carry the effective tool set from the request.
    assert.ok(Array.isArray(handle.run.activeTools));
    assert.ok(handle.run.activeTools.includes("read"));
    assert.ok(handle.run.activeTools.includes("bash"));
  } finally {
    clearSubagentState();
  }
});
