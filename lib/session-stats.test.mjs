import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { computeSessionStats, mergeSessionStats } = await jiti.import("./session-stats.ts");
const { buildContextEntries } = await jiti.import("@earendil-works/pi-coding-agent");

function usage(over = {}) {
  return {
    input: 10,
    output: 5,
    cacheRead: 2,
    cacheWrite: 1,
    cost: { input: 0.1, output: 0.05, cacheRead: 0.01, cacheWrite: 0.02, total: 0.18 },
    ...over,
  };
}

function userEntry(id, parentId, content = "hi") {
  return { type: "message", id, parentId, timestamp: "2026-01-01T00:00:00.000Z", message: { role: "user", content } };
}

function assistantEntry(id, parentId, blocks = [{ type: "text", text: "ok" }], u) {
  const message = {
    role: "assistant",
    provider: "test",
    model: "test-model",
    content: blocks,
  };
  if (u) message.usage = u;
  return { type: "message", id, parentId, timestamp: "2026-01-01T00:00:00.000Z", message };
}

function toolResultEntry(id, parentId, u) {
  const message = { role: "toolResult", toolCallId: "tc1", content: [{ type: "text", text: "result" }] };
  if (u) message.usage = u;
  return { type: "message", id, parentId, timestamp: "2026-01-01T00:00:00.000Z", message };
}

function compactionEntry(id, parentId, summary, u) {
  const entry = {
    type: "compaction",
    id,
    parentId,
    timestamp: "2026-01-01T00:00:00.000Z",
    summary,
    firstKeptEntryId: "u2",
    tokensBefore: 100,
  };
  if (u) entry.usage = u;
  return entry;
}

test("sums usage across ALL entries, including history compacted away", () => {
  const entries = [
    userEntry("u1", null),
    assistantEntry("a1", "u1", [{ type: "text", text: "old" }], usage()), // pre-compaction
    compactionEntry("c1", "a1", "summary of old history", usage({ input: 1, output: 1, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.05 } })),
    userEntry("u2", "c1"),
    assistantEntry("a2", "u2", [{ type: "text", text: "new" }], usage({ input: 20, cost: { input: 0.2, output: 0.1, cacheRead: 0, cacheWrite: 0, total: 0.3 } })),
  ];
  const stats = computeSessionStats(entries);

  assert.equal(stats.tokens.input, 10 + 1 + 20);
  assert.equal(stats.tokens.output, 5 + 1 + 5);
  assert.equal(stats.tokens.cacheRead, 2 + 2 + 2);
  assert.equal(stats.tokens.cacheWrite, 1 + 1 + 1);
  assert.equal(stats.tokens.total, stats.tokens.input + stats.tokens.output + stats.tokens.cacheRead + stats.tokens.cacheWrite);
  assert.ok(Math.abs(stats.cost - (0.18 + 0.05 + 0.3)) < 1e-9);
  assert.equal(stats.userMessages, 2);
  assert.equal(stats.assistantMessages, 2);
  assert.equal(stats.toolResults, 0);
  assert.equal(stats.totalMessages, 4);
});

test("counts tool calls and includes tool result usage", () => {
  const entries = [
    userEntry("u1", null),
    assistantEntry("a1", "u1", [
      { type: "toolCall", toolCallId: "tc1", toolName: "bash", input: {} },
      { type: "toolCall", toolCallId: "tc2", toolName: "read", input: {} },
      { type: "text", text: "done" },
    ], usage()),
    toolResultEntry("t1", "a1", usage({ input: 3, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.1 } })),
    toolResultEntry("t2", "t1"), // no usage (e.g. local tool)
  ];
  const stats = computeSessionStats(entries);
  assert.equal(stats.toolCalls, 2);
  assert.equal(stats.toolResults, 2);
  assert.equal(stats.tokens.input, 10 + 3);
  assert.ok(Math.abs(stats.cost - 0.28) < 1e-9);
});

test("includes branch summary usage", () => {
  const entries = [
    userEntry("u1", null),
    assistantEntry("a1", "u1", [{ type: "text", text: "x" }], usage()),
    {
      type: "branch_summary",
      id: "b1",
      parentId: "a1",
      timestamp: "2026-01-01T00:00:00.000Z",
      fromId: "a1",
      summary: "side branch",
      usage: usage({ input: 7, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.7 } }),
    },
  ];
  const stats = computeSessionStats(entries);
  assert.equal(stats.tokens.input, 17);
  assert.ok(Math.abs(stats.cost - 0.88) < 1e-9);
});

test("tolerates entries without usage (older session files)", () => {
  const entries = [
    userEntry("u1", null),
    compactionEntry("c1", "u1", "old summary without usage"),
    userEntry("u2", "c1"),
  ];
  const stats = computeSessionStats(entries);
  assert.equal(stats.tokens.total, 0);
  assert.equal(stats.cost, 0);
  assert.equal(stats.totalMessages, 2);
});

test("returns zeros for an empty session", () => {
  const stats = computeSessionStats([]);
  assert.deepEqual(stats, {
    userMessages: 0,
    assistantMessages: 0,
    toolCalls: 0,
    toolResults: 0,
    totalMessages: 0,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cost: 0,
  });
});

test("full-file stats never shrink relative to the post-compaction context", () => {
  const entries = [
    userEntry("u1", null),
    assistantEntry("a1", "u1", [{ type: "text", text: "old" }], usage()),
    assistantEntry("a2", "a1", [{ type: "text", text: "older" }], usage({ input: 40 })),
    compactionEntry("c1", "a2", "summary", usage()),
    userEntry("u3", "c1"),
    assistantEntry("a3", "u3", [{ type: "text", text: "new" }], usage({ input: 5 })),
  ];
  const byId = new Map(entries.map((e) => [e.id, e]));
  // What the SDK exposes to the UI after compaction: the compaction entry plus
  // entries kept/recreated after it — everything before is dropped.
  const contextEntries = buildContextEntries(entries, "a3", byId);

  const full = computeSessionStats(entries);
  const context = computeSessionStats(contextEntries);
  for (const field of ["input", "output", "cacheRead", "cacheWrite", "total"]) {
    assert.ok(
      full.tokens[field] >= context.tokens[field],
      `full.tokens.${field} (${full.tokens[field]}) should be >= context.tokens.${field} (${context.tokens[field]})`,
    );
  }
  assert.ok(full.cost >= context.cost);
});

test("adds messages completed after load to compacted file totals", () => {
  const entries = [
    userEntry("u1", null),
    assistantEntry("a1", "u1", [{ type: "text", text: "old" }], usage()),
    compactionEntry("c1", "a1", "summary", usage()),
    userEntry("u2", "c1"),
    assistantEntry("a2", "u2", [{ type: "text", text: "loaded" }], usage({ input: 20 })),
  ];
  const loadedMessages = entries.slice(-2).map((entry) => entry.message);
  const newUser = userEntry("u3", "a2");
  const newAssistant = assistantEntry("a3", "u3", [
    { type: "toolCall", toolCallId: "tc1", toolName: "bash", input: {} },
  ], usage({ input: 40, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.4 } }));
  const currentMessages = [...loadedMessages, newUser.message, newAssistant.message];

  const file = computeSessionStats(entries);
  const merged = mergeSessionStats(file, loadedMessages, currentMessages);

  assert.equal(merged.tokens.input, file.tokens.input + 40);
  assert.ok(Math.abs(merged.cost - (file.cost + 0.4)) < 1e-9);
  assert.equal(merged.userMessages, file.userMessages + 1);
  assert.equal(merged.assistantMessages, file.assistantMessages + 1);
  assert.equal(merged.toolCalls, file.toolCalls + 1);
  assert.equal(merged.totalMessages, file.totalMessages + 2);

  const reloadedFile = computeSessionStats([...entries, newUser, newAssistant]);
  assert.deepEqual(mergeSessionStats(reloadedFile, currentMessages, currentMessages), reloadedFile);
});
