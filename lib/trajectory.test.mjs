import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { buildTrajectory, pageTrajectoryRows, windowTrajectory } = await jiti.import("./trajectory.ts");
const { PI_WEB_TIMING_CUSTOM_TYPE } = await jiti.import("./session-timing.ts");

const base = Date.parse("2026-01-01T00:00:00.000Z");
const iso = (ms) => new Date(base + ms).toISOString();
let nextId = 0;

function entry(type, ms, extra = {}) {
  return { type, id: `e${++nextId}`, parentId: null, timestamp: iso(ms), ...extra };
}

function user(ms, text) {
  return entry("message", ms, { message: { role: "user", content: text, timestamp: base + ms } });
}

function assistant(ms, text, extra = {}) {
  return entry("message", ms, {
    message: {
      role: "assistant",
      content: text === null ? [] : [{ type: "text", text }],
      provider: "p",
      model: "m",
      stopReason: "stop",
      timestamp: base + ms,
      usage: { input: 10, output: 20, cacheRead: 0, cacheWrite: 0, cost: { total: 0.001 } },
      ...extra,
    },
  });
}

function toolResult(ms, name, extra = {}) {
  return entry("message", ms, {
    message: {
      role: "toolResult",
      toolCallId: "c1",
      toolName: name,
      content: [{ type: "text", text: "out" }],
      isError: false,
      timestamp: base + ms,
      ...extra,
    },
  });
}

function live(ms, messageTimestamp, data) {
  return entry("custom", ms, {
    customType: PI_WEB_TIMING_CUSTOM_TYPE,
    data: { messageTimestamp: base + messageTimestamp, ...data },
  });
}

test("groups rows into turns led by each user message", () => {
  const view = buildTrajectory([
    user(0, "第一轮"),
    assistant(3000, "ok"),
    toolResult(5000, "bash"),
    user(60000, "第二轮"),
    assistant(62000, "done"),
  ]);

  assert.equal(view.turns.length, 2);
  assert.equal(view.turns[0].label, "第一轮");
  assert.equal(view.turns[0].rows.length, 3);
  assert.equal(view.turns[1].rows.length, 2);
  assert.deepEqual(view.turns.map((t) => t.index), [0, 1]);
  assert.equal(view.rows.length, 5);
});

test("attributes duration to the row that ended the gap", () => {
  const view = buildTrajectory([
    user(0, "go"),
    assistant(3000, "thinking"),
    toolResult(8000, "bash"),
  ]);

  const [, modelRow, toolRow] = view.rows;
  assert.equal(modelRow.kind, "assistant");
  assert.equal(modelRow.durationMs, 3000);
  assert.equal(modelRow.startedAt, base);
  assert.equal(toolRow.kind, "tool");
  assert.equal(toolRow.durationMs, 5000);
  assert.equal(toolRow.toolName, "bash");
});

test("per-turn model and tool totals match the row durations", () => {
  const view = buildTrajectory([
    user(0, "go"),
    assistant(2000, "a"),
    toolResult(5000, "bash"),
    assistant(9000, "b"),
  ]);
  const turn = view.turns[0];
  assert.equal(turn.modelMs, 2000 + 4000);
  assert.equal(turn.toolMs, 3000);
  const sum = turn.rows.reduce((total, row) => total + row.durationMs, 0);
  assert.equal(turn.modelMs + turn.toolMs, sum);
});

test("joins live timing to its assistant row by message timestamp", () => {
  const view = buildTrajectory([
    user(0, "go"),
    assistant(3000, "a"),
    live(3000, 3000, { ttftMs: 1200, decodeMs: 1000, outputTokens: 250 }),
    assistant(9000, "b"),
  ]);

  assert.equal(view.coverage.assistantRows, 2);
  assert.equal(view.coverage.timedRows, 1);
  // The instrumentation entry is not a row, so the second assistant is at index 2.
  assert.equal(view.rows.length, 3);
  assert.equal(view.rows[1].timing.ttftMs, 1200);
  assert.equal(view.rows[1].timing.decodeMs, 1000);
  assert.equal(view.rows[2].timing, undefined);
});

test("instrumentation entries never appear as rows", () => {
  const withSample = buildTrajectory([
    user(0, "go"),
    assistant(3000, "a"),
    live(3000, 3000, { ttftMs: 100, decodeMs: 200, outputTokens: 10 }),
  ]);
  const withoutSample = buildTrajectory([user(0, "go"), assistant(3000, "a")]);
  assert.equal(withSample.rows.length, withoutSample.rows.length);
  assert.equal(withSample.rows.length, 2);
  assert.equal(withSample.unmatchedTiming, 0);
});

test("drops the incoming idle gap at a user turn and at user bash", () => {
  const view = buildTrajectory([
    user(0, "go"),
    assistant(2000, "a"),
    entry("message", 100000, { message: { role: "bashExecution", command: "ls", timestamp: base + 100000 } }),
    assistant(103000, "b"),
  ]);

  const bashRow = view.rows.find((row) => row.kind === "other");
  assert.equal(bashRow.durationMs, 0);
  assert.equal(view.rows[3].durationMs, 3000);
});

test("counts compaction and branch summaries as model time", () => {
  const view = buildTrajectory([
    user(0, "go"),
    assistant(2000, "a"),
    entry("compaction", 5000, { summary: "summarized" }),
  ]);
  assert.equal(view.turns[0].modelMs, 5000);
  assert.equal(view.rows[2].kind, "compaction");
  assert.equal(view.rows[2].text, "summarized");
  assert.equal(view.rows[2].durationMs, 3000);
});

test("keeps pre-turn rows under a synthetic turn instead of dropping them", () => {
  const view = buildTrajectory([assistant(1000, "orphan"), user(5000, "later")]);
  assert.equal(view.rows.length, 2);
  assert.equal(view.turns.length, 2);
  assert.equal(view.turns[0].rows.length, 1);
  assert.equal(view.turns[0].label, "");
});

test("extracts tool call count and args from an assistant row", () => {
  const view = buildTrajectory([
    user(0, "go"),
    entry("message", 3000, {
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "running" },
          { type: "toolCall", id: "c1", name: "bash", arguments: { command: "ls" } },
        ],
        timestamp: base + 3000,
      },
    }),
  ]);
  assert.equal(view.rows[1].toolCallCount, 1);
  assert.match(view.rows[1].args, /bash/);
  assert.match(view.rows[1].args, /ls/);
  assert.equal(view.rows[1].text, "running");
});

test("carries token usage and error state for the inspector", () => {
  const view = buildTrajectory([
    user(0, "go"),
    assistant(3000, "a"),
    toolResult(5000, "bash", { isError: true }),
  ]);
  assert.deepEqual(view.rows[1].tokens, { input: 10, output: 20, cacheRead: 0, cacheWrite: 0, total: 30 });
  assert.equal(view.rows[1].cost, 0.001);
  assert.equal(view.rows[2].isError, true);
});

test("truncates long payloads", () => {
  const view = buildTrajectory([user(0, "go"), assistant(3000, "x".repeat(5000))]);
  assert.ok(view.rows[1].text.length <= 601);
  assert.ok(view.turns[0].label.length <= 81);
});

test("counts live samples that matched no assistant row", () => {
  const view = buildTrajectory([
    user(0, "go"),
    assistant(3000, "a"),
    live(3000, 999999, { ttftMs: 100, decodeMs: 100, outputTokens: 5 }),
  ]);
  assert.equal(view.unmatchedTiming, 1);
  assert.equal(view.coverage.timedRows, 0);
});

test("ignores malformed live samples", () => {
  const view = buildTrajectory([
    user(0, "go"),
    assistant(3000, "a"),
    entry("custom", 3000, { customType: PI_WEB_TIMING_CUSTOM_TYPE, data: null }),
    entry("custom", 3001, { customType: PI_WEB_TIMING_CUSTOM_TYPE, data: { messageTimestamp: "nope" } }),
    entry("custom", 3002, { customType: "other", data: { messageTimestamp: base + 3000 } }),
  ]);
  assert.equal(view.unmatchedTiming, 0);
  assert.equal(view.coverage.timedRows, 0);
});

test("pages the tail and never repeats the boundary row", () => {
  const rows = Array.from({ length: 10 }, (_, index) => ({ id: `r${index}` }));
  const first = pageTrajectoryRows(rows, { tail: 4 });
  assert.deepEqual(first.rows.map((row) => row.id), ["r6", "r7", "r8", "r9"]);
  assert.equal(first.hasMore, true);
  assert.equal(first.oldestRowId, "r6");

  const second = pageTrajectoryRows(rows, { tail: 4, before: first.oldestRowId });
  assert.deepEqual(second.rows.map((row) => row.id), ["r2", "r3", "r4", "r5"]);
  assert.equal(second.hasMore, true);

  const third = pageTrajectoryRows(rows, { tail: 4, before: second.oldestRowId });
  assert.deepEqual(third.rows.map((row) => row.id), ["r0", "r1"]);
  assert.equal(third.hasMore, false);
  assert.equal(third.oldestRowId, "r0");
});

test("returns everything when no page size is given", () => {
  const rows = [{ id: "a" }, { id: "b" }];
  const page = pageTrajectoryRows(rows);
  assert.equal(page.rows.length, 2);
  assert.equal(page.hasMore, false);
});

test("reports the full-branch span so the axis stays stable across pages", () => {
  const view = buildTrajectory([user(0, "go"), assistant(3000, "a"), toolResult(9000, "bash")]);
  assert.deepEqual(view.span, { start: base, end: base + 9000 });
  assert.deepEqual(buildTrajectory([]).span, { start: 0, end: 0 });
});

test("windows turns without dropping their full-turn totals", () => {
  const view = buildTrajectory([
    user(0, "第一轮"),
    assistant(2000, "a"),
    toolResult(5000, "bash"),
    user(60000, "第二轮"),
    assistant(63000, "b"),
  ]);

  const windowed = windowTrajectory(view, { tail: 2 });
  assert.equal(windowed.rows.length, 2);
  assert.equal(windowed.hasMore, true);
  assert.equal(windowed.turns.length, 1);
  assert.equal(windowed.turns[0].index, 1);
  assert.equal(windowed.turns[0].partial, false);
  // Turn totals stay full-turn even when the page clips the turn.
  assert.equal(windowed.turns[0].modelMs, 3000);

  const clipped = windowTrajectory(view, { tail: 3 });
  assert.equal(clipped.turns.length, 2);
  // The page cuts turn 0 down to its tool row alone, so it is flagged partial.
  assert.equal(clipped.turns[0].rows.length, 1);
  assert.equal(clipped.turns[0].partial, true);
  assert.equal(clipped.turns[1].rows.length, 2);
  assert.equal(clipped.turns[1].partial, false);
  assert.equal(clipped.turns[0].modelMs, 2000);
});

test("the whole branch is returned when the page covers it", () => {
  const view = buildTrajectory([user(0, "go"), assistant(1000, "a")]);
  const windowed = windowTrajectory(view, { tail: 50 });
  assert.equal(windowed.hasMore, false);
  assert.equal(windowed.rows.length, 2);
  assert.equal(windowed.turns.length, 1);
  assert.equal(windowed.turns[0].partial, false);
});
