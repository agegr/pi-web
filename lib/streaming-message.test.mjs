import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  INITIAL_STREAMING_STATE,
  streamReducer,
} = await jiti.import("./streaming-message.ts");

function assistant(content = []) {
  return {
    role: "assistant",
    content,
    model: "claude-sonnet-4-6",
    provider: "anthropic",
    timestamp: 123,
  };
}

function snapshot(state, message) {
  return streamReducer(state, { type: "snapshot", message });
}

function delta(state, event) {
  return streamReducer(state, { type: "delta", event });
}

test("builds thinking and text blocks from official assistant deltas", () => {
  let state = streamReducer(INITIAL_STREAMING_STATE, { type: "start" });
  state = snapshot(state, assistant());
  state = delta(state, { type: "thinking_start", contentIndex: 0 });
  state = delta(state, { type: "thinking_delta", contentIndex: 0, delta: "Plan" });
  state = delta(state, { type: "thinking_end", contentIndex: 0, content: "Plan." });
  state = delta(state, { type: "text_start", contentIndex: 1 });
  state = delta(state, { type: "text_delta", contentIndex: 1, delta: "Hel" });
  state = delta(state, { type: "text_delta", contentIndex: 1, delta: "lo" });
  state = delta(state, { type: "text_end", contentIndex: 1, content: "Hello" });

  assert.equal(state.isStreaming, true);
  assert.equal(state.streamingMessage.model, "claude-sonnet-4-6");
  assert.equal(state.streamingMessage.provider, "anthropic");
  assert.equal(state.streamingMessage.timestamp, 123);
  assert.deepEqual(state.streamingMessage.content, [
    { type: "thinking", thinking: "Plan." },
    { type: "text", text: "Hello" },
  ]);
});

test("a reconnect snapshot replaces the old partial before deltas continue", () => {
  let state = snapshot(INITIAL_STREAMING_STATE, assistant([
    { type: "text", text: "stale" },
  ]));
  state = snapshot(state, assistant([
    { type: "text", text: "Hello wor" },
  ]));
  state = delta(state, { type: "text_delta", contentIndex: 0, delta: "ld" });

  assert.deepEqual(state.streamingMessage.content, [
    { type: "text", text: "Hello world" },
  ]);
});

test("text deltas update immutably so React observes each chunk", () => {
  const previous = snapshot(INITIAL_STREAMING_STATE, assistant([
    { type: "text", text: "Hello" },
  ]));
  const next = delta(previous, { type: "text_delta", contentIndex: 0, delta: "!" });

  assert.notStrictEqual(next, previous);
  assert.notStrictEqual(next.streamingMessage, previous.streamingMessage);
  assert.notStrictEqual(next.streamingMessage.content, previous.streamingMessage.content);
  assert.equal(previous.streamingMessage.content[0].text, "Hello");
  assert.equal(next.streamingMessage.content[0].text, "Hello!");
});

test("waits for authoritative toolcall_end instead of buffering tool JSON", () => {
  let state = snapshot(INITIAL_STREAMING_STATE, assistant());
  const beforeTool = state;

  state = delta(state, { type: "toolcall_start", contentIndex: 0 });
  assert.strictEqual(state, beforeTool);
  state = delta(state, { type: "toolcall_delta", contentIndex: 0, delta: '{"path":' });
  assert.strictEqual(state, beforeTool);

  state = delta(state, {
    type: "toolcall_end",
    contentIndex: 0,
    toolCall: {
      type: "toolCall",
      id: "call-1",
      name: "read",
      arguments: { path: "/tmp/file" },
    },
  });
  assert.deepEqual(state.streamingMessage.content, [{
    type: "toolCall",
    toolCallId: "call-1",
    toolName: "read",
    input: { path: "/tmp/file" },
  }]);
});

test("ignores deltas without a baseline and unknown future deltas", () => {
  const started = streamReducer(INITIAL_STREAMING_STATE, { type: "start" });
  assert.strictEqual(
    delta(started, { type: "text_delta", contentIndex: 0, delta: "lost" }),
    started,
  );

  const withMessage = snapshot(started, assistant());
  assert.strictEqual(
    delta(withMessage, { type: "future_delta", contentIndex: 0, delta: "ignored" }),
    withMessage,
  );
});

test("normalizes tool calls in snapshots and clears on end", () => {
  const state = snapshot(INITIAL_STREAMING_STATE, assistant([{
    type: "toolCall",
    id: "call-2",
    name: "bash",
    arguments: { command: "pwd" },
  }]));
  assert.deepEqual(state.streamingMessage.content, [{
    type: "toolCall",
    toolCallId: "call-2",
    toolName: "bash",
    input: { command: "pwd" },
  }]);
  assert.strictEqual(streamReducer(state, { type: "end" }), INITIAL_STREAMING_STATE);
});
