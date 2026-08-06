import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const agentEventsSource = await readFile(new URL("./[id]/events/route.ts", import.meta.url), "utf8");
const runningEventsSource = await readFile(new URL("./running/events/route.ts", import.meta.url), "utf8");

test("agent SSE projects SDK events onto the fields consumed by the web client", () => {
  assert.match(agentEventsSource, /OMITTED_EVENT_TYPES = new Set\(\["turn_start", "turn_end", "tool_execution_update"\]\)/);
  assert.match(agentEventsSource, /delete clientEvent\.assistantMessageEvent/);
  assert.match(agentEventsSource, /event\.type === "agent_end"\) return \{ type: "agent_end" \}/);
  assert.match(agentEventsSource, /const clientEvent = toClientEvent\(event\)/);
});

test("SSE routes reuse one TextEncoder per stream", () => {
  for (const source of [agentEventsSource, runningEventsSource]) {
    assert.equal((source.match(/new TextEncoder\(\)/g) ?? []).length, 1);
    assert.match(source, /controller\.enqueue\(encoder\.encode\(text\)\)/);
    assert.match(source, /controller\.enqueue\(encoder\.encode\(":\\n\\n"\)\)/);
  }
});
