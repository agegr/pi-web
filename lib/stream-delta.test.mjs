import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { applyAssistantDelta } = await jiti.import("./stream-delta.ts");

test("appends text deltas to the current text block", () => {
  let msg = applyAssistantDelta(null, { type: "text_start", contentIndex: 0 });
  msg = applyAssistantDelta(msg, { type: "text_delta", contentIndex: 0, delta: "Hello" });
  msg = applyAssistantDelta(msg, { type: "text_delta", contentIndex: 0, delta: " world" });
  assert.deepEqual(msg.content, [{ type: "text", text: "Hello world" }]);
});

test("text_end replaces the block with the full content", () => {
  let msg = applyAssistantDelta(null, { type: "text_start", contentIndex: 0 });
  msg = applyAssistantDelta(msg, { type: "text_delta", contentIndex: 0, delta: "partial" });
  msg = applyAssistantDelta(msg, { type: "text_end", contentIndex: 0, content: "full content" });
  assert.deepEqual(msg.content, [{ type: "text", text: "full content" }]);
});

test("interleaved thinking and text blocks keep their contentIndex", () => {
  let msg = applyAssistantDelta(null, { type: "thinking_start", contentIndex: 0 });
  msg = applyAssistantDelta(msg, { type: "thinking_delta", contentIndex: 0, delta: "think" });
  msg = applyAssistantDelta(msg, { type: "text_start", contentIndex: 1 });
  msg = applyAssistantDelta(msg, { type: "text_delta", contentIndex: 1, delta: "answer" });
  msg = applyAssistantDelta(msg, { type: "thinking_delta", contentIndex: 0, delta: "ing" });
  assert.deepEqual(msg.content, [
    { type: "thinking", thinking: "thinking" },
    { type: "text", text: "answer" },
  ]);
});

test("toolcall deltas accumulate JSON arguments as a string until toolcall_end", () => {
  let msg = applyAssistantDelta(null, { type: "toolcall_start", contentIndex: 0, id: "call_1", name: "search" });
  // 服务端从 partial 提取的 id/name 在流式期间即可用
  assert.equal(msg.content[0].id, "call_1");
  assert.equal(msg.content[0].name, "search");
  msg = applyAssistantDelta(msg, { type: "toolcall_delta", contentIndex: 0, delta: '{"q' });
  msg = applyAssistantDelta(msg, { type: "toolcall_delta", contentIndex: 0, delta: 'uery":"x"}' });
  // 流式中 arguments 是字符串累积（normalize 后显示为空对象），
  assert.equal(msg.content[0].type, "toolCall");
  assert.equal(msg.content[0].arguments, '{"query":"x"}');
  // toolcall_end 用完整对象覆盖
  const toolCall = { type: "toolCall", id: "call_1", name: "search", arguments: { query: "x" } };
  msg = applyAssistantDelta(msg, { type: "toolcall_end", contentIndex: 0, toolCall });
  assert.deepEqual(msg.content[0], toolCall);
});

test("toolcall_start without injected id/name still creates a placeholder", () => {
  const msg = applyAssistantDelta(null, { type: "toolcall_start", contentIndex: 0 });
  assert.equal(msg.content[0].type, "toolCall");
  assert.equal(msg.content[0].id, "");
  assert.equal(msg.content[0].name, "");
});

test("deltas that do not change content return the same reference", () => {
  const base = applyAssistantDelta(null, { type: "text_start", contentIndex: 0 });
  for (const type of ["start", "done", "error", "unknown_future_type"]) {
    const next = applyAssistantDelta(base, { type });
    assert.equal(next, base, `${type} must not rebuild the message`);
  }
});

test("applying a delta never mutates the previous message", () => {
  const prev = { role: "assistant", content: [{ type: "text", text: "Hi" }] };
  const next = applyAssistantDelta(prev, { type: "text_delta", contentIndex: 0, delta: "!" });
  assert.equal(prev.content[0].text, "Hi"); // 原对象不变
  assert.equal(next.content[0].text, "Hi!");
  assert.notEqual(next, prev);
});

test("delta without a prior block creates the block at contentIndex", () => {
  // 重连等场景下可能缺失 message_start/text_start，直接拼接应能自举。
  const msg = applyAssistantDelta(null, { type: "text_delta", contentIndex: 2, delta: "late" });
  assert.equal(msg.content.length, 3);
  assert.deepEqual(msg.content[2], { type: "text", text: "late" });
});

test("keeps message metadata from the base message", () => {
  const prev = { role: "assistant", model: "claude-x", provider: "acme" };
  const next = applyAssistantDelta(prev, { type: "text_delta", contentIndex: 0, delta: "hi" });
  assert.equal(next.model, "claude-x");
  assert.equal(next.provider, "acme");
});

test("reconnect: snapshot snapshot then deltas assembles the full message", () => {
  // 模拟页面重开后 SSE 重连：错过 message_start 和早前的 delta，服务端注入
  // 当前部分消息快照（含关闭期间生成的全部内容），之后续收 delta 拼接。
  const snapshot = { role: "assistant", model: "m", provider: "p", content: [{ type: "text", text: "Hello wor" }] };
  let msg = applyAssistantDelta(snapshot, { type: "text_delta", contentIndex: 0, delta: "ld" });
  msg = applyAssistantDelta(msg, { type: "text_delta", contentIndex: 0, delta: "!" });
  assert.equal(msg.content[0].text, "Hello world!");
  assert.equal(msg.model, "m");
});
