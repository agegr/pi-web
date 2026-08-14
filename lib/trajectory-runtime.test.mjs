import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { createTrajectoryRuntime } = await jiti.import("./trajectory-runtime.ts");
const { readTrajectoryFile } = await jiti.import("./trajectory-store.ts");
const { createAssistantMessageEventStream } = await jiti.import("@earendil-works/pi-ai");

const rpcSource = readFileSync(new URL("./rpc-manager.ts", import.meta.url), "utf8");
const wireSource = readFileSync(new URL("./agent-event-wire.ts", import.meta.url), "utf8");

test("rpc-manager wires trajectory runtime for new sessions", () => {
  assert.match(rpcSource, /createTrajectoryRuntime/);
  assert.match(rpcSource, /emitTrajectoryVersion/);
  assert.match(rpcSource, /trajectoryRuntime/);
});

test("agent-event-wire passes trajectory_update through", () => {
  assert.match(wireSource, /trajectory_update/);
});

function makeSession(leafId = "leaf-x") {
  const base = () => {
    const stream = createAssistantMessageEventStream();
    const assistant = { role: "assistant", content: [], model: "m", provider: "p" };
    stream.push({ type: "start", partial: assistant });
    stream.push({ type: "text_delta", contentIndex: 0, delta: "ok", partial: assistant });
    stream.end(assistant);
    return stream;
  };
  return {
    agent: { streamFunction: base },
    sessionManager: { getLeafId: () => leafId },
  };
}

test("installStreamWrapper replaces the stream function once", async () => {
  const dir = mkdtempSync(join(tmpdir(), "traj-rt-"));
  try {
    const session = makeSession();
    const original = session.agent.streamFunction;
    const runtime = createTrajectoryRuntime(session, {
      agentDir: dir,
      sessionId: "s1",
      cwd: "/tmp",
    });
    await runtime.recorder.start();
    runtime.installStreamWrapper();
    runtime.installStreamWrapper();
    assert.notEqual(session.agent.streamFunction, original);
    const seen = [];
    for await (const event of session.agent.streamFunction({ id: "m" }, {}, {})) {
      seen.push(event);
    }
    assert.equal(seen.length, 2);
    await runtime.close();
    const result = await readTrajectoryFile(dir, "s1");
    const kinds = result.records.map((r) => r.kind);
    assert.ok(kinds.includes("request_start"));
    assert.ok(kinds.includes("request_first_token"));
    assert.ok(kinds.includes("request_end"));
    const start = result.records.find((r) => r.kind === "request_start");
    assert.equal(start.leafId, "leaf-x");
    assert.equal(start.data.model, "m");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("handleAgentEvent forwards lifecycle events to the recorder", async () => {
  const dir = mkdtempSync(join(tmpdir(), "traj-rt-"));
  try {
    const session = makeSession();
    const runtime = createTrajectoryRuntime(session, {
      agentDir: dir,
      sessionId: "s1",
      cwd: "/tmp",
    });
    await runtime.recorder.start();
    runtime.handleAgentEvent({ type: "turn_start", turnIndex: 0, timestamp: 1 });
    runtime.handleAgentEvent({ type: "tool_execution_start", toolCallId: "tc", toolName: "read", args: {} });
    runtime.handleAgentEvent({ type: "turn_end", turnIndex: 0, timestamp: 2 });
    await runtime.close();
    const result = await readTrajectoryFile(dir, "s1");
    assert.deepEqual(
      result.records.map((r) => r.kind),
      ["session_start", "turn_start", "tool_start", "turn_end"],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("close is idempotent", async () => {
  const dir = mkdtempSync(join(tmpdir(), "traj-rt-"));
  try {
    const session = makeSession();
    const runtime = createTrajectoryRuntime(session, {
      agentDir: dir,
      sessionId: "s1",
      cwd: "/tmp",
    });
    await runtime.recorder.start();
    await runtime.close();
    await runtime.close();
    const result = await readTrajectoryFile(dir, "s1");
    assert.equal(result.records.filter((r) => r.kind === "turn_end").length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("onVersion callback fires with an increasing version", async () => {
  const dir = mkdtempSync(join(tmpdir(), "traj-rt-"));
  try {
    const versions = [];
    const session = makeSession();
    const runtime = createTrajectoryRuntime(session, {
      agentDir: dir,
      sessionId: "s1",
      cwd: "/tmp",
      onVersion: (v) => versions.push(v),
    });
    await runtime.recorder.start();
    await runtime.recorder.flush();
    runtime.handleAgentEvent({ type: "turn_start", turnIndex: 0, timestamp: 1 });
    await runtime.recorder.flush();
    assert.ok(versions.length >= 2);
    assert.equal(versions[1] > versions[0], true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
