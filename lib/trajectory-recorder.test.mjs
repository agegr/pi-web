import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { TrajectoryRecorder } = await jiti.import("./trajectory-recorder.ts");
const { readTrajectoryFile } = await jiti.import("./trajectory-store.ts");

function makeDir() {
  return mkdtempSync(join(tmpdir(), "traj-rec-"));
}

function makeRecorder(dir, overrides = {}) {
  return new TrajectoryRecorder({
    agentDir: dir,
    sessionId: "session-1",
    cwd: "/tmp/work",
    now: () => 1000,
    getLeafId: () => "leaf-1",
    ...overrides,
  });
}

test("start writes header and session_start", async () => {
  const dir = makeDir();
  try {
    const recorder = makeRecorder(dir);
    await recorder.start();
    await recorder.flush();
    const result = await readTrajectoryFile(dir, "session-1");
    assert.equal(result.records.length, 1);
    assert.equal(result.records[0].kind, "session_start");
    assert.equal(result.records[0].leafId, "leaf-1");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("records turn, parallel tool, retry, compaction lifecycle", async () => {
  const dir = makeDir();
  try {
    const recorder = makeRecorder(dir);
    await recorder.start();
    recorder.onAgentEvent({ type: "turn_start", turnIndex: 0, timestamp: 1000 });
    recorder.onAgentEvent({ type: "tool_execution_start", toolCallId: "tc1", toolName: "read", args: { path: "/a" } });
    recorder.onAgentEvent({ type: "tool_execution_start", toolCallId: "tc2", toolName: "grep", args: { pattern: "x" } });
    recorder.onAgentEvent({ type: "tool_execution_end", toolCallId: "tc1", toolName: "read", result: { text: "hi" }, isError: false });
    recorder.onAgentEvent({ type: "tool_execution_end", toolCallId: "tc2", toolName: "grep", result: { text: "" }, isError: true });
    recorder.onAgentEvent({ type: "auto_retry_start", attempt: 1, maxAttempts: 3, delayMs: 500, errorMessage: "rate limited" });
    recorder.onAgentEvent({ type: "auto_retry_end", success: true, attempt: 1 });
    recorder.onAgentEvent({ type: "compaction_start", reason: "threshold" });
    recorder.onAgentEvent({ type: "compaction_end", reason: "threshold", aborted: false });
    recorder.onAgentEvent({ type: "turn_end", turnIndex: 0, timestamp: 5000 });
    await recorder.flush();

    const result = await readTrajectoryFile(dir, "session-1");
    const byKind = new Map(result.records.map((r) => [r.kind, r]));
    assert.equal(byKind.get("turn_start").turnId, "turn-0");
    assert.equal(byKind.get("turn_start").leafId, "leaf-1");
    const toolStart1 = result.records.find((r) => r.kind === "tool_start" && r.stepId === "tc1");
    assert.equal(toolStart1.data.toolName, "read");
    assert.equal(result.records.find((r) => r.kind === "tool_start" && r.stepId === "tc2").data.toolName, "grep");
    const toolEnd1 = result.records.find((r) => r.kind === "tool_end" && r.stepId === "tc1");
    assert.equal(toolEnd1.status, "complete");
    assert.equal(toolEnd1.endTimestamp, 1000);
    assert.equal(result.records.find((r) => r.kind === "tool_end" && r.stepId === "tc2").status, "error");
    assert.equal(byKind.get("retry_start").data.attempt, 1);
    assert.equal(byKind.get("retry_end").status, "complete");
    assert.equal(byKind.get("compaction_start").data.reason, "threshold");
    assert.equal(byKind.get("compaction_end").status, "complete");
    assert.equal(byKind.get("turn_end").status, "complete");
    const sequences = result.records.map((r) => r.sequence);
    assert.deepEqual(sequences, [...sequences].sort((a, b) => a - b));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("compaction abort and retry failure close with error status", async () => {
  const dir = makeDir();
  try {
    const recorder = makeRecorder(dir);
    await recorder.start();
    recorder.onAgentEvent({ type: "compaction_start", reason: "overflow" });
    recorder.onAgentEvent({ type: "compaction_end", reason: "overflow", aborted: true });
    recorder.onAgentEvent({ type: "auto_retry_start", attempt: 1, maxAttempts: 2, delayMs: 100, errorMessage: "boom" });
    recorder.onAgentEvent({ type: "auto_retry_end", success: false, attempt: 1, finalError: "Retry cancelled" });
    await recorder.flush();
    const result = await readTrajectoryFile(dir, "session-1");
    const compaction = result.records.find((r) => r.kind === "compaction_end");
    const retry = result.records.find((r) => r.kind === "retry_end");
    assert.equal(compaction.status, "aborted");
    assert.equal(retry.status, "error");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("request lifecycle records timing, usage and errors", async () => {
  const dir = makeDir();
  try {
    const recorder = makeRecorder(dir);
    await recorder.start();
    const requestId = recorder.startRequest(
      { id: "gpt-5", provider: "openai" },
      { systemPrompt: "sys", messages: [{ role: "user", content: "hi" }] },
      { thinkingLevel: "high" },
    );
    recorder.firstToken(requestId);
    recorder.finishRequest(requestId, "complete", {
      usage: { input: 10, output: 20, cacheRead: 5, cacheWrite: 2, totalTokens: 37, cost: { total: 0.01 } },
      stopReason: "stop",
      errorMessage: undefined,
    });
    await recorder.flush();
    const result = await readTrajectoryFile(dir, "session-1");
    const start = result.records.find((r) => r.kind === "request_start");
    const firstToken = result.records.find((r) => r.kind === "request_first_token");
    const end = result.records.find((r) => r.kind === "request_end");
    assert.equal(start.requestId, requestId);
    assert.equal(start.data.model, "gpt-5");
    assert.equal(start.data.thinkingLevel, "high");
    assert.equal(firstToken.requestId, requestId);
    assert.equal(end.status, "complete");
    assert.deepEqual(end.data.usage, { input: 10, output: 20, cacheRead: 5, cacheWrite: 2, total: 37 });
    assert.equal(end.data.stopReason, "stop");
    assert.equal(result.records.length, 4);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("agent_end closes open requests and turns as aborted", async () => {
  const dir = makeDir();
  try {
    const recorder = makeRecorder(dir);
    await recorder.start();
    const requestId = recorder.startRequest({ id: "m" }, {}, {});
    recorder.onAgentEvent({ type: "turn_start", turnIndex: 0, timestamp: 1000 });
    recorder.onAgentEvent({ type: "agent_end", messages: [], willRetry: false });
    await recorder.flush();
    const result = await readTrajectoryFile(dir, "session-1");
    const end = result.records.find((r) => r.kind === "request_end");
    const turnEnd = result.records.find((r) => r.kind === "turn_end");
    assert.equal(end.status, "aborted");
    assert.equal(end.data.error, "aborted");
    assert.equal(turnEnd.status, "aborted");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("recordSubagentLink writes a subagent_link record", async () => {
  const dir = makeDir();
  try {
    const recorder = makeRecorder(dir);
    await recorder.start();
    recorder.recordSubagentLink({ childSessionId: "child-1", runId: "run-1", agent: "worker" });
    await recorder.flush();
    const result = await readTrajectoryFile(dir, "session-1");
    const link = result.records.find((r) => r.kind === "subagent_link");
    assert.equal(link.data.childSessionId, "child-1");
    assert.equal(link.data.agent, "worker");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("write failures are swallowed and do not reject callers", async () => {
  const dir = makeDir();
  try {
    // trajectories/ exists as a file, so mkdir/append cannot succeed.
    writeFileSync(join(dir, "trajectories"), "blocking file");
    const recorder = makeRecorder(dir, { now: () => 1 });
    await recorder.start().catch(() => {});
    let threw = false;
    try {
      recorder.onAgentEvent({ type: "turn_start", turnIndex: 0, timestamp: 1000 });
    } catch {
      threw = true;
    }
    await recorder.flush();
    assert.equal(threw, false);
    assert.equal(recorder.failed, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("onVersion fires after successful appends", async () => {
  const dir = makeDir();
  try {
    const versions = [];
    const recorder = makeRecorder(dir, { onVersion: (v) => versions.push(v) });
    await recorder.start();
    await recorder.flush();
    recorder.onAgentEvent({ type: "turn_start", turnIndex: 0, timestamp: 1000 });
    await recorder.flush();
    assert.ok(versions.length >= 1);
    assert.equal(versions[versions.length - 1] > 0, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("missing tool start still records a standalone tool_end", async () => {
  const dir = makeDir();
  try {
    const recorder = makeRecorder(dir);
    await recorder.start();
    recorder.onAgentEvent({ type: "tool_execution_end", toolCallId: "orphan", toolName: "bash", result: { text: "out" }, isError: true });
    await recorder.flush();
    const result = await readTrajectoryFile(dir, "session-1");
    const end = result.records.find((r) => r.kind === "tool_end");
    assert.equal(end.stepId, "orphan");
    assert.equal(end.status, "error");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
