import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Agent } from "@earendil-works/pi-agent-core";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { createReadTool, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  CODEMODE_SNAPSHOT_CALL_LIMIT,
  isEventIncludedInSnapshot,
  isNestedToolExecutionEvent,
  isSystemMessageEvent,
  liveToolExecutionEvent,
  parallelToolCallIds,
  toolResultFromExecutionEnd,
  toClientAgentEvent,
} = await jiti.import("./agent-event-wire.ts");

function assistantMessage(text) {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "anthropic-messages",
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "pending",
    timestamp: 1,
  };
}

test("projects message_update onto Pi 0.84's JSON/RPC delta shape", () => {
  const partial = assistantMessage("Hello");
  const projected = toClientAgentEvent({
    type: "message_update",
    message: partial,
    assistantMessageEvent: {
      type: "text_delta",
      contentIndex: 0,
      delta: "o",
      partial,
    },
  });

  assert.deepEqual(projected, {
    type: "message_update",
    assistantMessageEvent: {
      type: "text_delta",
      contentIndex: 0,
      delta: "o",
    },
  });
  assert.equal(Object.hasOwn(projected, "message"), false);
  assert.equal(Object.hasOwn(projected.assistantMessageEvent, "partial"), false);
});

test("keeps tool identity on toolcall_start without sending the cumulative partial", () => {
  const partial = {
    ...assistantMessage(""),
    content: [{
      type: "toolCall",
      id: "call-write-1",
      name: "write",
      arguments: {},
      partialJson: "",
    }],
  };
  const projected = toClientAgentEvent({
    type: "message_update",
    message: partial,
    assistantMessageEvent: {
      type: "toolcall_start",
      contentIndex: 0,
      partial,
    },
  });

  assert.deepEqual(projected, {
    type: "message_update",
    assistantMessageEvent: {
      type: "toolcall_start",
      contentIndex: 0,
      id: "call-write-1",
      toolName: "write",
    },
  });
  assert.equal(Object.hasOwn(projected, "message"), false);
  assert.equal(Object.hasOwn(projected.assistantMessageEvent, "partial"), false);
});

test("refreshes late tool identity on toolcall_delta", () => {
  const partial = {
    ...assistantMessage(""),
    content: [{
      type: "toolCall",
      id: "call-late-1",
      name: "write",
      arguments: { path: "/tmp/file" },
      partialJson: '{"path":"/tmp/file"',
    }],
  };
  const projected = toClientAgentEvent({
    type: "message_update",
    message: partial,
    assistantMessageEvent: {
      type: "toolcall_delta",
      contentIndex: 0,
      delta: '"/tmp/file"',
      partial,
    },
  });

  assert.deepEqual(projected, {
    type: "message_update",
    assistantMessageEvent: {
      type: "toolcall_delta",
      contentIndex: 0,
      delta: '"/tmp/file"',
      id: "call-late-1",
      toolName: "write",
    },
  });
});

test("does not whitelist assistant delta event types", () => {
  const projected = toClientAgentEvent({
    type: "message_update",
    message: assistantMessage("future"),
    assistantMessageEvent: {
      type: "future_delta",
      contentIndex: 3,
      value: "kept",
      partial: assistantMessage("future"),
    },
  });

  assert.deepEqual(projected, {
    type: "message_update",
    assistantMessageEvent: {
      type: "future_delta",
      contentIndex: 3,
      value: "kept",
    },
  });
});

test("rejects a malformed message_update without breaking the stream", () => {
  assert.equal(toClientAgentEvent({
    type: "message_update",
    assistantMessageEvent: null,
  }), null);
});

test("recognizes only the in-flight event already covered by a snapshot", () => {
  const snapshot = assistantMessage("Hello");
  assert.equal(isEventIncludedInSnapshot({
    type: "message_update",
    message: snapshot,
    assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "o" },
  }, snapshot), true);
  assert.equal(isEventIncludedInSnapshot({
    type: "message_update",
    message: { ...snapshot },
    assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "!" },
  }, snapshot), false);
  assert.equal(isEventIncludedInSnapshot({
    type: "message_end",
    message: snapshot,
  }, snapshot), false);
});

test("keeps the existing event omissions and slim agent_end", () => {
  assert.equal(toClientAgentEvent({ type: "turn_start" }), null);
  assert.equal(toClientAgentEvent({ type: "turn_end" }), null);
  // An appended entry can be a 1 MiB custom entry (codemode `store()` writes).
  assert.equal(toClientAgentEvent({
    type: "entry_appended",
    entry: { type: "custom", customType: "codemode-store", data: { set: { big: "x".repeat(1024) } } },
  }), null);
  assert.deepEqual(
    toClientAgentEvent({ type: "agent_end", messages: [assistantMessage("done")] }),
    { type: "agent_end" },
  );

  const messageStart = { type: "message_start", message: assistantMessage("") };
  assert.strictEqual(toClientAgentEvent(messageStart), messageStart);
});

test("forwards tool execution progress without repeating tool arguments", () => {
  const partialResult = {
    content: [{ type: "text", text: "Running phase 2" }],
    details: { phase: 2 },
  };

  assert.deepEqual(toClientAgentEvent({
    type: "tool_execution_update",
    toolCallId: "call-workflow-1",
    toolName: "workflow",
    args: { large: "repeated input" },
    partialResult,
  }), {
    type: "tool_execution_update",
    toolCallId: "call-workflow-1",
    toolName: "workflow",
    partialResult,
  });
});

test("keeps a model-issued tool start as is", () => {
  const start = {
    type: "tool_execution_start",
    toolCallId: "call-codemode-1",
    toolName: "codemode",
    args: { code: "await tools.read({ path: 'a' })" },
  };
  assert.strictEqual(toClientAgentEvent(start), start);
});

test("slims the start of a nested call and keeps its parent", () => {
  const start = {
    type: "tool_execution_start",
    toolCallId: "call-codemode-1/1",
    toolName: "read",
    args: { path: "/repo/large-input.txt" },
    parentToolCallId: "call-codemode-1",
  };
  assert.equal(isNestedToolExecutionEvent(start), true);
  assert.deepEqual(toClientAgentEvent(start), {
    type: "tool_execution_start",
    toolCallId: "call-codemode-1/1",
    toolName: "read",
    parentToolCallId: "call-codemode-1",
  });
});

test("drops the progress updates of nested calls before rebuilding updates", () => {
  // Rebuilding first would lose parentToolCallId and forward the update as a top-level one.
  for (const toolName of ["bash", "codemode", "mcp__github__search"]) {
    assert.equal(toClientAgentEvent({
      type: "tool_execution_update",
      toolCallId: "call-codemode-1/2",
      toolName,
      args: {},
      partialResult: { content: [{ type: "text", text: "partial" }], details: {} },
      parentToolCallId: "call-codemode-1",
    }), null);
  }
});

test("delivers completed SDK reads early only while a parallel call remains, retaining full replay", async () => {
  const tool = createReadTool(fileURLToPath(new URL(".", import.meta.url)));
  const calls = ["agent-event-wire.ts", "agent-event-stream.ts"].map((path) => ({
    type: "toolCall", id: randomUUID(), name: tool.name, arguments: { path, offset: 1, limit: 8 },
  }));
  const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null });
  const streamFn = runtime.streamSimple.bind(runtime);
  const agent = new Agent({ streamFn, initialState: { tools: [tool] } });
  const pending = parallelToolCallIds(calls, agent);
  // Both ids are known before either start, including a later sibling of an immediate preparation result.
  assert.deepEqual([...pending], calls.map((call) => call.id));
  assert.equal(parallelToolCallIds([calls[0]], agent).size, 1);
  for (const reason of ["length", "error", "aborted"]) assert.equal(parallelToolCallIds(calls, agent, reason).size, 0);

  const sequential = new Agent({ streamFn, toolExecution: "sequential", initialState: { tools: [tool] } });
  assert.equal(parallelToolCallIds(calls, sequential).size, 0);
  const declaredSequential = new Agent({ streamFn, initialState: { tools: [{ ...tool, executionMode: "sequential" }] } });
  assert.equal(parallelToolCallIds(calls, declaredSequential).size, 0);

  for (const call of calls) {
    const startedAt = performance.now();
    const result = await tool.execute(call.id, call.arguments, new AbortController().signal);
    const event = {
      type: "tool_execution_end", toolCallId: call.id, toolName: tool.name,
      result, isError: false, durationMs: performance.now() - startedAt,
    };
    pending.delete(call.id);
    const live = toClientAgentEvent(liveToolExecutionEvent(event, pending.size > 0));
    const replay = toClientAgentEvent(event);
    const display = { content: result.content, details: result.details, usage: result.usage };
    assert.deepEqual(live.result, pending.size > 0 ? display : undefined);
    assert.deepEqual(replay.result, display);
    assert.equal(live.durationMs, event.durationMs);
    assert.equal(live.isError, event.isError);
    assert.equal(event.result, result);
    assert.ok(result.structuredContent);
    assert.equal(Object.hasOwn(replay.result, "structuredContent"), false);
    assert.deepEqual(toolResultFromExecutionEnd(replay), {
      role: "toolResult", toolCallId: call.id, toolName: tool.name,
      ...display, isError: false, durationMs: event.durationMs,
    });
    const nested = { ...event, toolCallId: `${call.id}/1`, parentToolCallId: call.id };
    assert.equal(toClientAgentEvent(nested).result, undefined);
    assert.equal(toolResultFromExecutionEnd(nested), undefined);
  }
});

test("sends a nested tool end slim, keeping its parent id", () => {
  assert.deepEqual(toClientAgentEvent({
    type: "tool_execution_end",
    toolCallId: "call-codemode-1/1",
    toolName: "read",
    result: { content: [{ type: "text", text: "x" }], details: { structuredContent: { rows: [1] } } },
    isError: true,
    parentToolCallId: "call-codemode-1",
    durationMs: 12,
  }), {
    type: "tool_execution_end",
    toolCallId: "call-codemode-1/1",
    toolName: "read",
    isError: true,
    parentToolCallId: "call-codemode-1",
  });
});

test("recognizes nested calls only by a parent id on tool execution events", () => {
  assert.equal(isNestedToolExecutionEvent({
    type: "tool_execution_end",
    toolCallId: "call-1/1",
    toolName: "read",
  }), false);
  assert.equal(isNestedToolExecutionEvent({
    type: "tool_execution_start",
    toolCallId: "call-1",
    toolName: "read",
    parentToolCallId: "",
  }), false);
  assert.equal(isNestedToolExecutionEvent({ type: "message_end", parentToolCallId: "call-1" }), false);
  assert.equal(isNestedToolExecutionEvent({
    type: "tool_execution_end",
    toolCallId: "call-1/1/1",
    toolName: "read",
    parentToolCallId: "call-1/1",
  }), true);
});

function codemodeCalls(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `call-codemode-1/${index + 1}`,
    name: "read",
    args: `{"path":"file-${index + 1}"}`,
    status: "ok",
  }));
}

test("keeps the newest calls of a large codemode snapshot and counts the rest", () => {
  const calls = codemodeCalls(CODEMODE_SNAPSHOT_CALL_LIMIT + 50);
  const projected = toClientAgentEvent({
    type: "tool_execution_update",
    toolCallId: "call-codemode-1",
    toolName: "codemode",
    args: { code: "for (const f of files) await tools.read({ path: f })" },
    partialResult: { content: [], details: { calls } },
  });

  assert.equal(projected.type, "tool_execution_update");
  assert.equal(Object.hasOwn(projected, "args"), false);
  assert.deepEqual(projected.partialResult.content, []);
  assert.equal(projected.partialResult.details.omittedCalls, 50);
  assert.equal(projected.partialResult.details.calls.length, CODEMODE_SNAPSHOT_CALL_LIMIT);
  assert.deepEqual(projected.partialResult.details.calls[0], calls[50]);
  assert.deepEqual(projected.partialResult.details.calls.at(-1), calls.at(-1));
  // The session's own snapshot is left alone.
  assert.equal(calls.length, CODEMODE_SNAPSHOT_CALL_LIMIT + 50);
});

test("leaves small codemode snapshots and other tools' details untouched", () => {
  const small = { content: [], details: { calls: codemodeCalls(CODEMODE_SNAPSHOT_CALL_LIMIT) } };
  assert.strictEqual(toClientAgentEvent({
    type: "tool_execution_update",
    toolCallId: "call-codemode-1",
    toolName: "codemode",
    partialResult: small,
  }).partialResult, small);

  const other = { content: [], details: { calls: codemodeCalls(CODEMODE_SNAPSHOT_CALL_LIMIT + 1) } };
  assert.strictEqual(toClientAgentEvent({
    type: "tool_execution_update",
    toolCallId: "call-workflow-1",
    toolName: "workflow",
    partialResult: other,
  }).partialResult, other);

  const malformed = { content: [], details: { calls: "not an array" } };
  assert.strictEqual(toClientAgentEvent({
    type: "tool_execution_update",
    toolCallId: "call-codemode-2",
    toolName: "codemode",
    partialResult: malformed,
  }).partialResult, malformed);
});

function projectedCodemodeSnapshotBytes(callCount) {
  const calls = [];
  let bytes = 0;
  for (let index = 0; index < callCount; index += 1) {
    calls.push({ id: `call-codemode-1/${index + 1}`, name: "read", args: '{"path":"file"}', status: "ok" });
    const projected = toClientAgentEvent({
      type: "tool_execution_update",
      toolCallId: "call-codemode-1",
      toolName: "codemode",
      partialResult: { content: [], details: { calls: calls.map((call) => ({ ...call })) } },
    });
    bytes += Buffer.byteLength(JSON.stringify(projected));
  }
  return bytes;
}

test("serialized codemode progress grows linearly once snapshots hit the limit", () => {
  const base = projectedCodemodeSnapshotBytes(CODEMODE_SNAPSHOT_CALL_LIMIT * 2);
  const doubled = projectedCodemodeSnapshotBytes(CODEMODE_SNAPSHOT_CALL_LIMIT * 4);
  // Untruncated, doubling the calls would quadruple the bytes.
  assert.ok(doubled / base < 2.6, `expected near-linear growth, got ${doubled / base}`);
});

function projectedStreamBytes(totalLength) {
  const chunkSize = 64;
  let text = "";
  let bytes = 0;

  for (let offset = 0; offset < totalLength; offset += chunkSize) {
    const delta = "x".repeat(Math.min(chunkSize, totalLength - offset));
    text += delta;
    const partial = assistantMessage(text);
    const projected = toClientAgentEvent({
      type: "message_update",
      message: partial,
      assistantMessageEvent: {
        type: "text_delta",
        contentIndex: 0,
        delta,
        partial,
      },
    });

    assert.equal(Object.hasOwn(projected, "message"), false);
    assert.equal(Object.hasOwn(projected.assistantMessageEvent, "partial"), false);
    bytes += Buffer.byteLength(JSON.stringify(projected));
  }

  return bytes;
}

test("serialized streaming traffic grows linearly with response length", () => {
  const twoKiB = projectedStreamBytes(2 * 1024);
  const fourKiB = projectedStreamBytes(4 * 1024);
  assert.ok(fourKiB / twoKiB < 2.2, `expected near-linear growth, got ${fourKiB / twoKiB}`);
});

function projectedToolStreamBytes(totalLength) {
  const chunkSize = 64;
  let rawInput = "";
  let bytes = 0;

  for (let offset = 0; offset < totalLength; offset += chunkSize) {
    const delta = "x".repeat(Math.min(chunkSize, totalLength - offset));
    rawInput += delta;
    const partial = {
      ...assistantMessage(""),
      content: [{
        type: "toolCall",
        id: "call-write-1",
        name: "write",
        arguments: { content: rawInput },
        partialJson: rawInput,
      }],
    };
    const projected = toClientAgentEvent({
      type: "message_update",
      message: partial,
      assistantMessageEvent: {
        type: "toolcall_delta",
        contentIndex: 0,
        delta,
        partial,
      },
    });

    assert.equal(Object.hasOwn(projected, "message"), false);
    assert.equal(Object.hasOwn(projected.assistantMessageEvent, "partial"), false);
    bytes += Buffer.byteLength(JSON.stringify(projected));
  }

  return bytes;
}

test("serialized tool-input traffic grows linearly with write content", () => {
  const twoKiB = projectedToolStreamBytes(2 * 1024);
  const fourKiB = projectedToolStreamBytes(4 * 1024);
  assert.ok(fourKiB / twoKiB < 2.2, `expected near-linear growth, got ${fourKiB / twoKiB}`);
});

test("drops transcript system messages before they reach the browser", () => {
  // Pi >= 0.86 announces the persisted prompt and tool loadout as a system
  // message; it is never rendered and carries every tool schema.
  const systemMessage = {
    role: "system",
    content: "",
    sections: { preamble: "You are an expert coding assistant." },
    toolsAdded: [{ name: "read", description: "Read a file", parameters: { type: "object" } }],
    timestamp: 1,
  };
  assert.equal(toClientAgentEvent({ type: "message_start", message: systemMessage }), null);
  assert.equal(toClientAgentEvent({ type: "message_end", message: systemMessage }), null);
  assert.equal(isSystemMessageEvent({ type: "message_end", message: systemMessage }), true);
  assert.equal(isSystemMessageEvent({ type: "message_end", message: assistantMessage("hi") }), false);
  assert.equal(isSystemMessageEvent({ type: "agent_end" }), false);

  const userEnd = { type: "message_end", message: { role: "user", content: "hello", timestamp: 1 } };
  assert.strictEqual(toClientAgentEvent(userEnd), userEnd);
});

test("sends only the role of a message_start the browser does not build from", () => {
  const image = { type: "image", data: "A".repeat(4096), mimeType: "image/png" };
  const toolResult = { role: "toolResult", toolCallId: "call-1", toolName: "read", content: [image], isError: false, timestamp: 1 };
  assert.deepEqual(toClientAgentEvent({ type: "message_start", message: toolResult }), { type: "message_start", message: { role: "toolResult" } });
  assert.deepEqual(toClientAgentEvent({ type: "message_start", message: { role: "user", content: "hi", timestamp: 1 } }), { type: "message_start", message: { role: "user" } });
  // The end still carries the message, and an assistant start its snapshot.
  assert.deepEqual(toClientAgentEvent({ type: "message_end", message: toolResult }), { type: "message_end", message: toolResult });
  const reply = assistantMessage("partial");
  assert.equal(toClientAgentEvent({ type: "message_start", message: reply }).message, reply);
});

test("assistant start and end omit signatures but preserve model messages", () => {
  const message = {
    ...assistantMessage("answer"),
    content: [
      { type: "thinking", thinking: "", thinkingSignature: "encrypted-reasoning", redacted: true },
      { type: "text", text: "answer", textSignature: "message-id" },
    ],
  };
  const original = JSON.stringify(message);
  for (const type of ["message_start", "message_end"]) {
    const projected = toClientAgentEvent({ type, message });
    assert.deepEqual(projected, {
      type,
      message: { ...message, content: [
        { type: "thinking", thinking: "", redacted: true },
        { type: "text", text: "answer" },
      ] },
    });
  }
  assert.equal(JSON.stringify(message), original);
});

test("toolcall_end omits the provider signature and preserves tool arguments", () => {
  const toolCall = {
    type: "toolCall", id: "call-1", name: "write",
    arguments: { thoughtSignature: "user data" }, thoughtSignature: "provider state",
  };
  for (const partial of [undefined, assistantMessage("partial")]) {
    const projected = toClientAgentEvent({
      type: "message_update",
      assistantMessageEvent: {
        type: "toolcall_end", contentIndex: 0, toolCall,
        ...(partial ? { partial } : {}),
      },
    });
    assert.deepEqual(projected, {
      type: "message_update",
      assistantMessageEvent: {
        type: "toolcall_end", contentIndex: 0,
        toolCall: { type: "toolCall", id: "call-1", name: "write", arguments: toolCall.arguments },
      },
    });
  }
  assert.equal(toolCall.thoughtSignature, "provider state");
});
