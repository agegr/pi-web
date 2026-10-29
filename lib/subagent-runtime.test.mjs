import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { createSubagentController, hasUnsettledSubagentRun } = await jiti.import("./subagent-runtime.ts");
const { SUBAGENT_NOTIFICATION_PREFIX, subagentFinalText } = await jiti.import("./subagent-extension.ts");

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
  assert.equal(
    delivered[0].message.content,
    `${SUBAGENT_NOTIFICATION_PREFIX}Subagent child-session completed.\n\nParser found`,
  );
  // Compaction reads custom messages as user turns, so the report must announce that it is not one (#875).
  assert.match(delivered[0].message.content, /^The following is a background subagent's report/);
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
  const child = { inner: childInner, sessionFile: childInner.sessionFile, cwd: tmpdir(), isAlive: () => true, isRunning: () => false, waitUntilReady: async () => {} };
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
  // The resumed run's notification must be distinguishable from the first run's (#985).
  assert.equal(result.resumed, true);
  assert.equal(execution.run.resumed, true);
});

for (const [label, live] of [["a live child", true], ["a reopened child", false]]) {
  test(`resume refuses ${label} whose worktree is gone, as a prompt sent to it does (#1202)`, async (t) => {
    // An isolated child's worktree is removed when its run ends.
    const worktree = await mkdtemp(join(tmpdir(), "pi-web-removed-worktree-"));
    await rm(worktree, { recursive: true });
    const calls = [];
    const entries = [
      { type: "custom", customType: "pi-web:subagent", data: {
        version: 1,
        parentSessionId: "parent",
        parentSessionPath: "/tmp/parent.jsonl",
        parentToolCallId: "old-call",
        profile: "general-purpose",
        description: "old task",
        task: "old",
        runInBackground: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        resourceSnapshot: { version: 1, appendSystemPrompt: [], tools: [], loadSkills: false, loadExtensions: false },
        worktreePath: worktree,
        worktreeBranch: "pi-web-agent-test",
      } },
      { type: "custom", customType: "pi-web:subagent-result", data: {
        version: 1, status: "completed", completedAt: "2026-01-01T00:01:00.000Z", result: "old result",
      } },
    ];
    // A released child is read back from its session file, and reopened from it.
    const sessions = await mkdtemp(join(tmpdir(), "pi-web-removed-worktree-sessions-"));
    t.after(() => rm(sessions, { recursive: true, force: true }));
    const sessionFile = join(sessions, "child.jsonl");
    await writeFile(sessionFile, [
      { type: "session", version: 3, id: "child", timestamp: "2026-01-01T00:00:00.000Z", cwd: worktree },
      ...entries.map((entry, index) => ({ ...entry, id: `e${index}`, parentId: index ? `e${index - 1}` : null, timestamp: "2026-01-01T00:00:00.000Z" })),
    ].map((line) => JSON.stringify(line)).join("\n") + "\n");
    const childInner = {
      sessionId: "child",
      sessionFile,
      sessionManager: { getEntries: () => entries, appendCustomEntry: (type, data) => entries.push({ type: "custom", customType: type, data }) },
      prompt: async (task) => { calls.push(task); },
      getLastAssistantText: () => "new result",
      abort: async () => {},
    };
    const child = { inner: childInner, sessionFile, cwd: worktree, isAlive: () => true, isRunning: () => false, waitUntilReady: async () => {} };
    const parent = { inner: { sessionManager: { getSessionId: () => "parent" } }, sessionFile: "/tmp/parent.jsonl", cwd: "/tmp", isAlive: () => true, isRunning: () => false, waitUntilReady: async () => {} };
    let reopened = 0;
    const controller = createSubagentController({
      getSession: (id) => id === "child" ? (live ? child : undefined) : parent,
      registerSession: () => {},
      reopenSession: async () => { reopened += 1; return child; },
      resolveSessionPath: async () => child.sessionFile,
      invalidateSessionList: () => {},
      isBuiltInSubagentsEnabled: () => true,
    });
    await assert.rejects(controller.extensionRuntime.resume({
      parentContext: parent.inner,
      parentToolCallId: "new-call",
      sessionId: "child",
      task: "continue this",
      description: "Continue task",
    }), { message: `Directory does not exist: ${worktree}. Start a new subagent instead.` });
    assert.equal(reopened, live ? 0 : 1);
    assert.deepEqual(calls, []);
    // Nothing was queued or recorded: the child still reads as its earlier, completed run.
    assert.equal(entries.length, 2);
    assert.equal((await controller.extensionRuntime.get("child")).status, "completed");
  });
}

/** A live isolated child whose session ends with `lifecycle`, resumed with `prompt` as its run. */
function resumeIsolatedChild(worktree, lifecycle, prompt = async () => {}) {
  const entries = [
    { type: "custom", customType: "pi-web:subagent", data: {
      version: 1,
      parentSessionId: "parent",
      parentSessionPath: "/tmp/parent.jsonl",
      parentToolCallId: "old-call",
      profile: "general-purpose",
      description: "old task",
      task: "old",
      runInBackground: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      resourceSnapshot: { version: 1, appendSystemPrompt: [], tools: [], loadSkills: false, loadExtensions: false },
      worktreePath: worktree,
      worktreeBranch: "pi-web-agent-test",
    } },
    lifecycle,
  ];
  const childInner = {
    sessionId: "child",
    sessionFile: "/tmp/child.jsonl",
    sessionManager: { getEntries: () => entries, appendCustomEntry: (type, data) => entries.push({ type: "custom", customType: type, data }) },
    prompt,
    getLastAssistantText: () => "new result",
    abort: async () => {},
  };
  const child = { inner: childInner, sessionFile: childInner.sessionFile, cwd: worktree, isAlive: () => true, isRunning: () => false, waitUntilReady: async () => {} };
  const parent = { inner: { sessionManager: { getSessionId: () => "parent" } }, sessionFile: "/tmp/parent.jsonl", cwd: "/tmp", isAlive: () => true, isRunning: () => false, waitUntilReady: async () => {} };
  const controller = createSubagentController({
    getSession: (id) => id === "child" ? child : parent,
    registerSession: () => {},
    reopenSession: async () => child,
    resolveSessionPath: async () => child.sessionFile,
    invalidateSessionList: () => {},
    isBuiltInSubagentsEnabled: () => true,
  });
  return {
    entries,
    before: () => controller.extensionRuntime.get("child"),
    resume: async () => (await controller.extensionRuntime.resume({
      parentContext: parent.inner,
      parentToolCallId: "new-call",
      sessionId: "child",
      task: "continue this",
      description: "Continue task",
    })).completion,
  };
}

/** The child as `get()` reads it from its session file once its wrapper is gone. */
async function readBackFromFile(t, cwd, entries) {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-subagent-read-back-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const sessionFile = join(dir, "child.jsonl");
  await writeFile(sessionFile, [
    { type: "session", version: 3, id: "child", timestamp: "2026-01-01T00:00:00.000Z", cwd },
    ...entries.map((entry, index) => ({ ...entry, id: `e${index}`, parentId: index ? `e${index - 1}` : null, timestamp: "2026-01-01T00:00:00.000Z" })),
  ].map((line) => JSON.stringify(line)).join("\n") + "\n");
  return createSubagentController({
    getSession: () => undefined,
    registerSession: () => {},
    reopenSession: async () => { throw new Error("unused"); },
    resolveSessionPath: async () => sessionFile,
    invalidateSessionList: () => {},
  }).extensionRuntime.get("child");
}

test("a resumed isolated child is told its worktree is still there, never that it was removed (#1202)", async (t) => {
  const worktree = await mkdtemp(join(tmpdir(), "pi-web-kept-worktree-"));
  t.after(() => rm(worktree, { recursive: true, force: true }));
  const earlier = [
    // The process stopped mid-run: nothing removed the worktree, and no result was recorded.
    ["an interrupted run", "interrupted", { type: "custom", customType: "pi-web:subagent-status", data: { version: 1, status: "running" } }],
    // The earlier run's removal was refused; that refusal's reason is not this run's.
    ["a run that kept it", "completed", { type: "custom", customType: "pi-web:subagent-result", data: {
      version: 1, status: "completed", completedAt: "2026-01-01T00:01:00.000Z", result: "old result", worktreeExists: true,
      worktreeCleanupError: `Worktree retained at ${worktree}: fatal: '${worktree}' contains modified or untracked files, use --force to delete it`,
    } }],
  ];
  for (const [label, status, lifecycle] of earlier) {
    await t.test(`after ${label}`, async (t) => {
      const child = resumeIsolatedChild(worktree, lifecycle);
      assert.equal((await child.before()).status, status);
      const result = await child.resume();
      const text = subagentFinalText(result);
      assert.equal(text, `Subagent child completed.\n\nIts worktree is still at ${worktree} (branch pi-web-agent-test).\n\nnew result`);
      assert.deepEqual(child.entries.at(-1).data, { version: 1, status: "completed", completedAt: result.completedAt, result: "new result", worktreeExists: true });
      assert.equal(subagentFinalText(await readBackFromFile(t, worktree, child.entries)), text);
    });
  }
});

test("a worktree removed during a resumed run is reported removed, live and read back (#1202)", async (t) => {
  const worktree = await mkdtemp(join(tmpdir(), "pi-web-removed-during-run-"));
  t.after(() => rm(worktree, { recursive: true, force: true }));
  const child = resumeIsolatedChild(worktree, { type: "custom", customType: "pi-web:subagent-result", data: {
    version: 1, status: "completed", completedAt: "2026-01-01T00:01:00.000Z", result: "old result", worktreeExists: true,
  } }, () => rm(worktree, { recursive: true }));
  const result = await child.resume();
  const text = subagentFinalText(result);
  assert.equal(text, "Subagent child completed.\n\nIts worktree was removed; branch pi-web-agent-test keeps any commits it made.\n\nnew result");
  assert.equal(child.entries.at(-1).data.worktreeExists, false);
  assert.equal(subagentFinalText(await readBackFromFile(t, worktree, child.entries)), text);
});

test("a run collected and resumed in the same turn keeps its held notification suppressed", async () => {
  const delivered = [];
  let parentRunning = true;
  const entries = [
    { type: "custom", customType: "pi-web:subagent", data: {
      version: 1,
      parentSessionId: "parent",
      parentSessionPath: "/tmp/parent.jsonl",
      parentToolCallId: "old-call",
      profile: "explore",
      description: "old task",
      task: "old",
      runInBackground: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      resourceSnapshot: { version: 1, appendSystemPrompt: [], tools: [], loadSkills: false, loadExtensions: false },
    } },
    { type: "custom", customType: "pi-web:subagent-result", data: {
      version: 1, status: "completed", completedAt: "2026-01-01T00:01:00.000Z", result: "old result",
    } },
  ];
  let finishResumed;
  const childInner = {
    sessionId: "collect-and-resume-child",
    sessionFile: "/tmp/child.jsonl",
    sessionManager: { getEntries: () => entries, appendCustomEntry: (type, data) => entries.push({ type: "custom", customType: type, data }) },
    prompt: () => new Promise((resolve) => { finishResumed = resolve; }),
    getLastAssistantText: () => "new result",
    abort: async () => {},
  };
  const child = { inner: childInner, sessionFile: childInner.sessionFile, cwd: tmpdir(), isAlive: () => true, isRunning: () => false, waitUntilReady: async () => {} };
  const parent = {
    inner: {
      sessionManager: { getSessionId: () => "parent" },
      sendCustomMessage: async (message, options) => delivered.push({ message, options }),
    },
    sessionFile: "/tmp/parent.jsonl",
    cwd: "/tmp",
    isAlive: () => true,
    isRunning: () => parentRunning,
    waitUntilReady: async () => {},
  };
  const controller = createSubagentController({
    getSession: (id) => id === "collect-and-resume-child" ? child : parent,
    registerSession: () => {},
    reopenSession: async () => child,
    resolveSessionPath: async () => child.sessionFile,
    invalidateSessionList: () => {},
    isBuiltInSubagentsEnabled: () => true,
  });
  const first = await controller.extensionRuntime.get("collect-and-resume-child");

  // Run 1's notification is held while the parent turn runs; in that turn the parent
  // collects run 1 with get_subagent_result and immediately resumes the same child.
  const heldFirst = controller.extensionRuntime.notifyParent(first);
  await new Promise((resolve) => setTimeout(resolve, 250));
  controller.extensionRuntime.markResultConsumed(first);
  const execution = await controller.extensionRuntime.resume({
    parentContext: parent.inner,
    parentToolCallId: "new-call",
    sessionId: "collect-and-resume-child",
    task: "continue this",
    description: "Continue task",
  });
  parentRunning = false;
  await heldFirst;
  assert.equal(delivered.length, 0, "run 1 was already collected; delivering it again is the #889 duplicate");

  // The resumed run finishes later and is notified: the earlier mark names run 1, not this run.
  finishResumed();
  const second = await execution.completion;
  assert.notEqual(second.completedAt, first.completedAt);
  await controller.extensionRuntime.notifyParent(second);
  assert.equal(delivered.length, 1);
});

test("a resumed run that fails right away still notifies after the parent inspected the earlier failure (#987)", async () => {
  const delivered = [];
  const entries = [
    { type: "custom", customType: "pi-web:subagent", data: {
      version: 1,
      parentSessionId: "parent",
      parentSessionPath: "/tmp/parent.jsonl",
      parentToolCallId: "old-call",
      profile: "explore",
      description: "old task",
      task: "old",
      runInBackground: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      resourceSnapshot: { version: 1, appendSystemPrompt: [], tools: [], loadSkills: false, loadExtensions: false },
    } },
    { type: "message", message: { role: "assistant", content: [], stopReason: "error", errorMessage: "stream disconnected" } },
    { type: "custom", customType: "pi-web:subagent-result", data: {
      version: 1, status: "failed", completedAt: "2026-01-01T00:01:00.000Z", error: "stream disconnected",
    } },
  ];
  const childInner = {
    sessionId: "failed-resume-child",
    sessionFile: "/tmp/child.jsonl",
    sessionManager: { getEntries: () => entries, appendCustomEntry: (type, data) => entries.push({ type: "custom", customType: type, data }) },
    // The resumed run is rejected by the provider at once; pi records that as an errored assistant message.
    prompt: async () => {
      entries.push({ type: "message", message: { role: "assistant", content: [], stopReason: "error", errorMessage: "400 Bad Request" } });
    },
    getLastAssistantText: () => undefined,
    abort: async () => {},
  };
  const child = { inner: childInner, sessionFile: childInner.sessionFile, cwd: tmpdir(), isAlive: () => true, isRunning: () => false, waitUntilReady: async () => {} };
  const parent = {
    inner: {
      sessionManager: { getSessionId: () => "parent" },
      sendCustomMessage: async (message, options) => delivered.push({ message, options }),
    },
    sessionFile: "/tmp/parent.jsonl",
    cwd: "/tmp",
    isAlive: () => true,
    isRunning: () => false,
    waitUntilReady: async () => {},
  };
  const controller = createSubagentController({
    getSession: (id) => id === "failed-resume-child" ? child : parent,
    registerSession: () => {},
    reopenSession: async () => child,
    resolveSessionPath: async () => child.sessionFile,
    invalidateSessionList: () => {},
    isBuiltInSubagentsEnabled: () => true,
  });

  // Run 1's failure is delivered, then the parent inspects it with get_subagent_result before retrying.
  const first = await controller.extensionRuntime.get("failed-resume-child");
  await controller.extensionRuntime.notifyParent(first);
  controller.extensionRuntime.markResultConsumed(first);

  const execution = await controller.extensionRuntime.resume({
    parentContext: parent.inner,
    parentToolCallId: "retry-call",
    sessionId: "failed-resume-child",
    task: "retry with the fix",
    description: "Retry",
  });
  const second = await execution.completion;
  assert.equal(second.status, "failed");
  await controller.extensionRuntime.notifyParent(second);

  assert.equal(delivered.length, 2, "the retry's failure must reach the parent, or it waits forever");
  assert.match(delivered[1].message.content, /Subagent failed-resume-child failed: 400 Bad Request/);
  assert.deepEqual(delivered[1].options, { deliverAs: "followUp", triggerTurn: true });
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

test("a run whose last assistant message ended with a provider error is reported as failed, not completed", async () => {
  const entries = [
    { type: "custom", customType: "pi-web:subagent", data: {
      version: 1,
      parentSessionId: "parent",
      parentSessionPath: "/tmp/parent.jsonl",
      parentToolCallId: "old-call",
      profile: "builder",
      description: "old task",
      task: "old",
      runInBackground: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      resourceSnapshot: { version: 1, appendSystemPrompt: [], tools: [], loadSkills: false, loadExtensions: false },
    } },
    { type: "custom", customType: "pi-web:subagent-result", data: { version: 1, status: "completed", completedAt: "2026-01-01T00:01:00.000Z" } },
  ];
  const childInner = {
    sessionId: "child",
    sessionFile: "/tmp/child.jsonl",
    sessionManager: { getEntries: () => entries, appendCustomEntry: (type, data) => entries.push({ type: "custom", customType: type, data }) },
    // pi's agent loop records a provider stream error as an assistant message and resolves prompt() normally.
    prompt: async () => {
      entries.push({ type: "message", message: { role: "assistant", content: [{ type: "toolCall", id: "t1", name: "edit", arguments: {} }], stopReason: "error", errorMessage: "stream error: stream disconnected before completion" } });
    },
    getLastAssistantText: () => undefined,
    abort: async () => {},
  };
  const child = { inner: childInner, sessionFile: childInner.sessionFile, cwd: tmpdir(), isAlive: () => true, isRunning: () => false, waitUntilReady: async () => {} };
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
  assert.equal(result.status, "failed");
  assert.match(result.error, /stream disconnected/);
  const persisted = entries.at(-1);
  assert.equal(persisted.customType, "pi-web:subagent-result");
  assert.equal(persisted.data.status, "failed");
  assert.match(persisted.data.error, /stream disconnected/);
});

function orphanedEntries(status) {
  return [
    { type: "custom", customType: "pi-web:subagent", data: {
      version: 1,
      parentSessionId: "parent",
      parentSessionPath: "/tmp/parent.jsonl",
      parentToolCallId: "call",
      profile: "explore",
      description: "Find parser",
      task: "Find the parser",
      runInBackground: true,
      createdAt: "2026-01-01T00:00:00.000Z",
    } },
    { type: "custom", customType: "pi-web:subagent-status", data: { version: 1, status } },
  ];
}

function orphanController(child) {
  return createSubagentController({
    getSession: () => child,
    registerSession: () => {},
    reopenSession: async () => child,
    resolveSessionPath: async () => undefined,
    invalidateSessionList: () => {},
  });
}

test("a live child left with a running status but no active run reads as interrupted", async () => {
  for (const status of ["running", "queued"]) {
    const entries = orphanedEntries(status);
    const child = {
      inner: { sessionManager: { getEntries: () => entries } },
      sessionFile: "/tmp/child.jsonl",
      isAlive: () => true,
      isRunning: () => false,
    };

    const run = await orphanController(child).extensionRuntime.get("orphan-child");

    assert.equal(run.status, "interrupted", `persisted ${status} without a result`);
  }
});

test("a child whose wrapper is still running keeps reporting running", async () => {
  const entries = orphanedEntries("running");
  const child = {
    inner: { sessionManager: { getEntries: () => entries } },
    sessionFile: "/tmp/child.jsonl",
    isAlive: () => true,
    isRunning: () => true,
  };

  const run = await orphanController(child).extensionRuntime.get("orphan-child");

  assert.equal(run.status, "running");
});

test("a child session read back from disk after a restart mid-run reads as interrupted", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-orphaned-subagent-"));
  try {
    const sessionPath = join(dir, "child.jsonl");
    const header = { type: "session", version: 3, id: "orphan-child", timestamp: "2026-01-01T00:00:00.000Z", cwd: dir, parentSession: "/tmp/parent.jsonl" };
    const lines = [header, ...orphanedEntries("running").map((entry, index) => ({
      ...entry,
      id: `e${index}`,
      parentId: index === 0 ? null : `e${index - 1}`,
      timestamp: "2026-01-01T00:00:00.000Z",
    }))];
    await writeFile(sessionPath, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
    const controller = createSubagentController({
      getSession: () => undefined,
      registerSession: () => {},
      reopenSession: async () => { throw new Error("unused"); },
      resolveSessionPath: async () => sessionPath,
      invalidateSessionList: () => {},
    });

    const run = await controller.extensionRuntime.get("orphan-child");

    assert.equal(run.status, "interrupted");
    assert.equal(run.completedAt, undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function idleParentDependencies(delivered, overrides = {}) {
  const parent = {
    cwd: "/tmp",
    sessionFile: "/tmp/parent.jsonl",
    isAlive: () => true,
    isRunning: () => false,
    waitUntilReady: async () => {},
    inner: {
      sendCustomMessage: async (message, options) => delivered.push({ message, options }),
    },
    ...overrides,
  };
  return {
    getSession: () => parent,
    registerSession: () => {},
    reopenSession: async () => parent,
    resolveSessionPath: async () => "/tmp/parent.jsonl",
    invalidateSessionList: () => {},
  };
}

test("a result already collected with get_subagent_result is never delivered again", async () => {
  const delivered = [];
  const controller = createSubagentController(idleParentDependencies(delivered));
  const run = { ...completedRun(), sessionId: "collected-child" };

  controller.extensionRuntime.markResultConsumed(run);
  await controller.extensionRuntime.notifyParent(run);

  assert.equal(delivered.length, 0);

  // The mark is consumed, so a later run reusing that session ID still notifies.
  await controller.extensionRuntime.notifyParent({ ...run, completedAt: "2026-01-01T00:05:00.000Z" });
  assert.equal(delivered.length, 1);
});

test("a mark left by an earlier run never swallows the next run's notification (#987)", async () => {
  const delivered = [];
  const controller = createSubagentController(idleParentDependencies(delivered));
  const first = { ...completedRun(), sessionId: "rerun-child" };

  // Run 1 notifies first; the parent then polls get_subagent_result and marks a result
  // whose notification has already been delivered, so no notifyParent ever takes that mark.
  await controller.extensionRuntime.notifyParent(first);
  controller.extensionRuntime.markResultConsumed(first);
  assert.equal(delivered.length, 1);

  const second = { ...first, parentToolCallId: "second-call", completedAt: "2026-01-01T00:05:00.000Z" };
  await controller.extensionRuntime.notifyParent(second);

  assert.equal(delivered.length, 2);
  assert.equal(delivered[1].options.triggerTurn, true);
});

test("a notification waits for a busy parent and is dropped when that turn collects the result", async () => {
  const delivered = [];
  let running = true;
  const controller = createSubagentController(idleParentDependencies(delivered, { isRunning: () => running }));
  const run = { ...completedRun(), sessionId: "racing-child" };

  const notified = controller.extensionRuntime.notifyParent(run);
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(delivered.length, 0, "must not deliver while the parent turn is still running");

  // The parent's in-flight get_subagent_result call returns the same result, then the turn ends.
  controller.extensionRuntime.markResultConsumed(run);
  running = false;
  await notified;

  assert.equal(delivered.length, 0);
});

test("a notification held for a busy parent is delivered once that parent goes idle", async () => {
  const delivered = [];
  let running = true;
  const controller = createSubagentController(idleParentDependencies(delivered, { isRunning: () => running }));
  const run = { ...completedRun(), sessionId: "waiting-child" };

  const notified = controller.extensionRuntime.notifyParent(run);
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(delivered.length, 0);

  running = false;
  await notified;

  assert.equal(delivered.length, 1);
  assert.equal(
    delivered[0].message.content,
    `${SUBAGENT_NOTIFICATION_PREFIX}Subagent waiting-child completed.\n\nParser found`,
  );
  assert.deepEqual(delivered[0].options, { deliverAs: "followUp", triggerTurn: true });
});

test("a session has an unsettled subagent run while one under it, at any depth, is in the run map", () => {
  const previous = globalThis.__piSubagentRuns;
  const stored = (sessionId, parentSessionId) => [sessionId, { run: { sessionId, parentSessionId } }];
  try {
    // parent -> child (idle, settled) -> grandchild (still running): the grandchild's end
    // starts a turn in the child, whose end starts one in the parent.
    globalThis.__piSubagentRuns = new Map([stored("grandchild", "child"), stored("other-child", "other")]);
    assert.equal(hasUnsettledSubagentRun("child"), true);
    assert.equal(hasUnsettledSubagentRun("parent"), false);
    globalThis.__piSubagentRuns.set(...stored("child", "parent"));
    assert.equal(hasUnsettledSubagentRun("parent"), true);
    assert.equal(hasUnsettledSubagentRun("grandchild"), false);
    assert.equal(hasUnsettledSubagentRun("unrelated"), false);
  } finally {
    globalThis.__piSubagentRuns = previous;
  }
});

test("a background run counts as unsettled until its parent notification is delivered", async () => {
  const ready = Promise.withResolvers();
  const delivered = [];
  const parent = {
    cwd: "/tmp",
    sessionFile: "/tmp/parent.jsonl",
    isAlive: () => true,
    isRunning: () => false,
    waitUntilReady: () => ready.promise,
    inner: { sendCustomMessage: async (message) => delivered.push(message) },
  };
  const controller = createSubagentController({
    getSession: () => parent,
    registerSession: () => {},
    reopenSession: async () => parent,
    resolveSessionPath: async () => "/tmp/parent.jsonl",
    invalidateSessionList: () => {},
  });
  // The run has left the run map; the parent's turn has not started yet.
  const notifying = controller.extensionRuntime.notifyParent(completedRun());
  assert.equal(hasUnsettledSubagentRun("parent-session"), true);
  ready.resolve();
  await notifying;
  assert.equal(delivered.length, 1);
  assert.equal(hasUnsettledSubagentRun("parent-session"), false);

  // A failed delivery lets go as well.
  parent.waitUntilReady = async () => { throw new Error("gone"); };
  await assert.rejects(controller.extensionRuntime.notifyParent(completedRun()), /gone/);
  assert.equal(hasUnsettledSubagentRun("parent-session"), false);
});
