import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const agentEventsSource = await readFile(new URL("./[id]/events/route.ts", import.meta.url), "utf8");
const runningEventsSource = await readFile(new URL("./running/events/route.ts", import.meta.url), "utf8");

test("agent SSE projects SDK events onto the fields consumed by the web client", () => {
  assert.match(agentEventsSource, /OMITTED_EVENT_TYPES = new Set\(\["turn_start", "turn_end", "tool_execution_update"\]\)/);
  assert.match(agentEventsSource, /event\.type === "agent_end"\) return \{ type: "agent_end" \}/);
  assert.match(agentEventsSource, /const clientEvent = toClientEvent\(event\)/);
});

test("message_update is projected to a light delta event with partial stripped", () => {
  // 轻量字段白名单存在，且覆盖 SDK 的全部 delta 类型
  assert.match(agentEventsSource, /DELTA_FIELDS: Record<string, readonly string\[\]>/);
  assert.match(agentEventsSource, /text_delta: \["contentIndex", "delta"\]/);
  assert.match(agentEventsSource, /thinking_delta: \["contentIndex", "delta"\]/);
  assert.match(agentEventsSource, /toolcall_delta: \["contentIndex", "delta"\]/);
  assert.match(agentEventsSource, /toolcall_end: \["contentIndex", "toolCall"\]/);
  // 已知 delta 类型 → 剥离 partial 后转发为 message_delta（浏览器增量拼接）
  assert.match(agentEventsSource, /type: "message_delta", assistantMessageEvent: slimDelta/);
  assert.doesNotMatch(agentEventsSource, /slimDelta\["partial"\]/);
  // done/error 不转发（reason 已随 message_end 的完整消息下发）
  assert.match(agentEventsSource, /OMITTED_DELTA_TYPES = new Set\(\["done", "error"\]\)/);
  // toolcall_start 从 partial 提取 id/name（避免流式期间工具无名）
  assert.match(agentEventsSource, /slimDelta\.id = block\.id/);
  // 无 delta / 未知 delta 类型 → 降级为完整快照（罕见兜底），仍删除 assistantMessageEvent
  assert.match(agentEventsSource, /delete clientEvent\.assistantMessageEvent/);
  assert.match(agentEventsSource, /降级为完整快照/);
});

test("SSE reconnect injects a full-message snapshot when the session is mid-stream", () => {
  assert.match(agentEventsSource, /const streamingMessage = session\.streamingMessage/);
  assert.match(agentEventsSource, /\{ type: "message_update", message: streamingMessage \}/);
  assert.match(agentEventsSource, /重建增量拼接基座/);
});

test("SSE routes reuse one TextEncoder per stream", () => {
  for (const source of [agentEventsSource, runningEventsSource]) {
    assert.equal((source.match(/new TextEncoder\(\)/g) ?? []).length, 1);
    assert.match(source, /controller\.enqueue\(encoder\.encode\(text\)\)/);
    assert.match(source, /controller\.enqueue\(encoder\.encode\(":\\n\\n"\)\)/);
  }
});
