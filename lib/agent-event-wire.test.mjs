import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  CODEMODE_SNAPSHOT_CALL_LIMIT,
  isEventIncludedInSnapshot,
  isNestedToolExecutionEvent,
  isSystemMessageEvent,
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

test("sends a tool end without its result", () => {
  const result = {
    content: [{ type: "text", text: "x".repeat(4096) }],
    details: { structuredContent: { rows: [1, 2, 3] } },
  };
  const topLevel = toClientAgentEvent({
    type: "tool_execution_end",
    toolCallId: "call-bash-1",
    toolName: "bash",
    result,
    isError: false,
  });
  assert.deepEqual(topLevel, {
    type: "tool_execution_end",
    toolCallId: "call-bash-1",
    toolName: "bash",
    isError: false,
  });
  assert.equal(Object.hasOwn(topLevel, "parentToolCallId"), false);

  assert.deepEqual(toClientAgentEvent({
    type: "tool_execution_end",
    toolCallId: "call-codemode-1/1",
    toolName: "read",
    result,
    isError: true,
    parentToolCallId: "call-codemode-1",
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
