import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { projectTrajectory } = await jiti.import("./trajectory-projection.ts");

function record(overrides) {
  return {
    schemaVersion: 1,
    type: "record",
    sequence: 1,
    id: "r1",
    kind: "request_start",
    timestamp: 1000,
    ...overrides,
  };
}

const readResult = (records) => ({
  header: null,
  records,
  warnings: [],
  incompleteTail: false,
});

test("filters records to the current branch", () => {
  const records = [
    record({ sequence: 1, id: "branch-a-record", kind: "request_start", leafId: "branch-a-entry" }),
    record({ sequence: 2, id: "branch-b-record", kind: "request_start", leafId: "branch-b-entry" }),
  ];
  const projection = projectTrajectory(readResult(records), {
    leafId: "leaf-b",
    detailLevel: "summary",
    branchEntryIds: new Set(["branch-b-entry"]),
  });
  assert.deepEqual(projection.records.map((r) => r.id), ["branch-b-record"]);
  assert.equal(projection.stats.requests, 1);
  assert.equal(projection.session.leafId, "leaf-b");
});

test("keeps unanchored session-level diagnostics", () => {
  const records = [
    record({ sequence: 1, id: "sess", kind: "session_start", leafId: null }),
    record({ sequence: 2, id: "b", kind: "request_start", leafId: "branch-b-entry" }),
    record({ sequence: 3, id: "other", kind: "request_start", leafId: "branch-a-entry" }),
  ];
  const projection = projectTrajectory(readResult(records), {
    leafId: "leaf-b",
    detailLevel: "summary",
    branchEntryIds: new Set(["branch-b-entry"]),
  });
  assert.deepEqual(projection.records.map((r) => r.id), ["sess", "b"]);
});

test("running records have no fabricated duration", () => {
  const records = [
    record({ sequence: 1, id: "req", kind: "request_start", leafId: "e1" }),
  ];
  const projection = projectTrajectory(readResult(records), {
    leafId: "leaf",
    detailLevel: "summary",
    branchEntryIds: new Set(["e1"]),
  });
  const view = projection.records[0];
  assert.equal(view.status, "running");
  assert.equal(view.durationMs, undefined);
  assert.equal(projection.requests[0].durationMs, undefined);
  assert.equal(projection.requests[0].ttftMs, undefined);
});

test("pairs request timing and usage", () => {
  const records = [
    record({ sequence: 1, id: "req", kind: "request_start", leafId: "e1", requestId: "req", data: { model: "gpt-5" } }),
    record({ sequence: 2, id: "ft", kind: "request_first_token", leafId: "e1", requestId: "req", timestamp: 1800 }),
    record({ sequence: 3, id: "end", kind: "request_end", leafId: "e1", requestId: "req", timestamp: 5000, status: "complete", data: { usage: { input: 10, output: 20, cacheRead: 0, cacheWrite: 0, total: 30 } } }),
  ];
  const projection = projectTrajectory(readResult(records), {
    leafId: "leaf",
    detailLevel: "summary",
    branchEntryIds: new Set(["e1"]),
  });
  const request = projection.requests[0];
  assert.equal(request.model, "gpt-5");
  assert.equal(request.ttftMs, 800);
  assert.equal(request.durationMs, 4000);
  assert.equal(request.status, "complete");
  assert.deepEqual(request.usage, { input: 10, output: 20, cacheRead: 0, cacheWrite: 0, total: 30 });
  assert.deepEqual(projection.stats.tokens, { input: 10, output: 20, cacheRead: 0, cacheWrite: 0, total: 30 });
});

test("groups turns from turn_start/turn_end", () => {
  const records = [
    record({ sequence: 1, id: "t1", kind: "turn_start", leafId: "e1", turnId: "turn-1" }),
    record({ sequence: 2, id: "t2", kind: "turn_end", leafId: "e1", turnId: "turn-1", timestamp: 9000, status: "complete" }),
  ];
  const projection = projectTrajectory(readResult(records), {
    leafId: "leaf",
    detailLevel: "summary",
    branchEntryIds: new Set(["e1"]),
  });
  assert.equal(projection.turns.length, 1);
  assert.equal(projection.turns[0].id, "turn-1");
  assert.equal(projection.turns[0].status, "complete");
  assert.equal(projection.stats.turns, 1);
});

test("aggregates stats across kinds", () => {
  const records = [
    record({ sequence: 1, id: "r1", kind: "request_start", leafId: "e1", requestId: "r1" }),
    record({ sequence: 2, id: "r1e", kind: "request_end", leafId: "e1", requestId: "r1", timestamp: 2000, status: "error", data: { error: "boom" } }),
    record({ sequence: 3, id: "tool1", kind: "tool_start", leafId: "e1" }),
    record({ sequence: 4, id: "tool1e", kind: "tool_end", leafId: "e1", timestamp: 2500, status: "complete" }),
    record({ sequence: 5, id: "retry1", kind: "retry_start", leafId: "e1" }),
    record({ sequence: 6, id: "comp1", kind: "compaction_start", leafId: "e1" }),
    record({ sequence: 7, id: "sub1", kind: "subagent_link", leafId: "e1" }),
  ];
  const projection = projectTrajectory(readResult(records), {
    leafId: "leaf",
    detailLevel: "summary",
    branchEntryIds: new Set(["e1"]),
  });
  assert.equal(projection.stats.requests, 1);
  assert.equal(projection.stats.tools, 1);
  assert.equal(projection.stats.retries, 1);
  assert.equal(projection.stats.compactions, 1);
  assert.equal(projection.stats.subagents, 1);
  assert.equal(projection.stats.errors, 1);
  assert.equal(projection.requests[0].error, "boom");
});

test("projection returns the complete branch without pagination metadata", () => {
  const records = [
    record({ sequence: 1, id: "old", kind: "request_start", leafId: "e1" }),
    record({ sequence: 2, id: "mid", kind: "tool_start", leafId: "e1" }),
    record({ sequence: 3, id: "new", kind: "request_start", leafId: "e1" }),
  ];
  const projection = projectTrajectory(readResult(records), {
    leafId: "leaf",
    detailLevel: "summary",
    branchEntryIds: new Set(["e1"]),
  });
  assert.deepEqual(projection.records.map((r) => r.id), ["old", "mid", "new"]);
  assert.equal("hasOlderRecords" in projection, false);
  assert.equal("nextCursor" in projection, false);
});

test("summary drops payload data while full keeps bounded data", () => {
  const records = [
    record({ sequence: 1, id: "req", kind: "request_start", leafId: "e1", data: { model: "gpt-5", toolInput: { path: "/a" }, note: "n" } }),
  ];
  const summary = projectTrajectory(readResult(records), {
    leafId: "leaf",
    detailLevel: "summary",
    branchEntryIds: new Set(["e1"]),
  });
  assert.equal(summary.records[0].data, undefined);

  const full = projectTrajectory(readResult(records), {
    leafId: "leaf",
    detailLevel: "full",
    branchEntryIds: new Set(["e1"]),
  });
  assert.ok(full.records[0].data);
  assert.equal(full.records[0].data.model, "gpt-5");
  assert.equal("apiKey" in full.records[0].data, false);
});

test("forwards warnings", () => {
  const result = readResult([record({ sequence: 1, id: "req", kind: "request_start", leafId: "e1" })]);
  result.warnings = ["Malformed trajectory line 2"];
  const projection = projectTrajectory(result, {
    leafId: "leaf",
    detailLevel: "summary",
    branchEntryIds: new Set(["e1"]),
  });
  assert.deepEqual(projection.warnings, ["Malformed trajectory line 2"]);
});
