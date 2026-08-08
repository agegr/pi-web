import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const agentEventsSource = await readFile(new URL("./[id]/events/route.ts", import.meta.url), "utf8");
const runningEventsSource = await readFile(new URL("./running/events/route.ts", import.meta.url), "utf8");
const rpcManagerSource = await readFile(new URL("../../../lib/rpc-manager.ts", import.meta.url), "utf8");

test("agent SSE projects SDK events onto the fields consumed by the web client", () => {
  assert.match(agentEventsSource, /toClientAgentEvent,[\s\S]*from "@\/lib\/agent-event-wire"/);
  assert.match(agentEventsSource, /const clientEvent = toClientAgentEvent\(event\)/);
  assert.match(agentEventsSource, /if \(clientEvent\) encode\(clientEvent\)/);
});

test("agent SSE reconciles the current assistant snapshot before subscribing", () => {
  const streamStart = agentEventsSource.slice(
    agentEventsSource.indexOf("const streamingMessage = session.streamingMessage"),
    agentEventsSource.indexOf("// Heartbeat every 30s"),
  );

  assert.match(streamStart, /isStreaming: session\.isStreaming/);
  assert.match(streamStart, /encode\(\{ type: "message_start", message: streamingMessage \}\)/);
  assert.equal((streamStart.match(/type: "message_start"/g) ?? []).length, 1);
  assert.ok(streamStart.indexOf('type: "connected"') < streamStart.indexOf('type: "message_start"'));
  assert.ok(streamStart.indexOf('type: "message_start"') < streamStart.indexOf("session.onEvent"));
  assert.match(streamStart, /isEventIncludedInSnapshot\(event, streamingMessage\)/);
  assert.match(rpcManagerSource, /get streamingMessage\(\)[\s\S]*?this\.inner\.agent\.state\?\.streamingMessage/);
  assert.match(rpcManagerSource, /get isStreaming\(\): boolean[\s\S]*?this\.inner\.isStreaming/);
});

test("SSE routes reuse one TextEncoder per stream", () => {
  for (const source of [agentEventsSource, runningEventsSource]) {
    assert.equal((source.match(/new TextEncoder\(\)/g) ?? []).length, 1);
    assert.match(source, /controller\.enqueue\(encoder\.encode\(text\)\)/);
    assert.match(source, /controller\.enqueue\(encoder\.encode\(":\\n\\n"\)\)/);
  }
});
