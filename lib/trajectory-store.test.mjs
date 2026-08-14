import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  appendTrajectoryRecord,
  ensureTrajectoryStore,
  readTrajectoryFile,
  readTrajectoryText,
  trajectoryPath,
} = await jiti.import("./trajectory-store.ts");

function makeRecord(overrides = {}) {
  return {
    schemaVersion: 1,
    type: "record",
    sequence: 1,
    id: "r1",
    kind: "request_start",
    timestamp: 100,
    ...overrides,
  };
}

test("trajectoryPath joins agent dir, trajectories, and session id", () => {
  assert.equal(
    trajectoryPath("/tmp/agent", "abc-123"),
    "/tmp/agent/trajectories/abc-123.jsonl",
  );
});

test("trajectoryPath rejects unsafe session ids", () => {
  assert.throws(() => trajectoryPath("/tmp/agent", "../evil"), TypeError);
  assert.throws(() => trajectoryPath("/tmp/agent", "a/b"), TypeError);
  assert.throws(() => trajectoryPath("/tmp/agent", ""), TypeError);
  assert.throws(() => trajectoryPath("/tmp/agent", "x".repeat(129)), TypeError);
});

test("readTrajectoryText returns header, valid records, and one warning", () => {
  const input = [
    JSON.stringify({ schemaVersion: 1, type: "header", sessionId: "s1", createdAt: 1 }),
    JSON.stringify({ schemaVersion: 1, type: "record", sequence: 1, id: "r1", kind: "request_start", timestamp: 100, leafId: "l1" }),
    "{bad json}",
    '{"schemaVersion":1,"type":"record"',
  ].join("\n");
  const result = readTrajectoryText(input);
  assert.equal(result.header?.sessionId, "s1");
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].id, "r1");
  assert.equal(result.warnings.length, 1);
  assert.equal(result.incompleteTail, true);
});

test("readTrajectoryText parses a valid final line without trailing newline", () => {
  const input = [
    JSON.stringify({ schemaVersion: 1, type: "header", sessionId: "s1", createdAt: 1 }),
    JSON.stringify(makeRecord()),
  ].join("\n");
  const result = readTrajectoryText(input);
  assert.equal(result.records.length, 1);
  assert.equal(result.incompleteTail, false);
});

test("readTrajectoryText handles empty and whitespace input", () => {
  const empty = readTrajectoryText("");
  assert.equal(empty.header, null);
  assert.equal(empty.records.length, 0);
  const blank = readTrajectoryText("\n\n");
  assert.equal(blank.records.length, 0);
});

test("ensureTrajectoryStore creates the directory", async () => {
  const dir = mkdtempSync(join(tmpdir(), "traj-store-"));
  try {
    await ensureTrajectoryStore(dir, "session-1", 1234);
    const header = JSON.parse(readFileSync(join(dir, "trajectories", "session-1.jsonl"), "utf8"));
    assert.equal(header.type, "header");
    assert.equal(header.sessionId, "session-1");
    assert.equal(header.createdAt, 1234);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("appendTrajectoryRecord writes ordered JSONL lines", async () => {
  const dir = mkdtempSync(join(tmpdir(), "traj-store-"));
  try {
    await ensureTrajectoryStore(dir, "session-1");
    await appendTrajectoryRecord(dir, "session-1", makeRecord({ sequence: 1 }));
    await appendTrajectoryRecord(dir, "session-1", makeRecord({ sequence: 2, id: "r2" }));
    const text = readFileSync(join(dir, "trajectories", "session-1.jsonl"), "utf8");
    const lines = text.trim().split("\n");
    assert.equal(lines.length, 3);
    assert.equal(JSON.parse(lines[1]).sequence, 1);
    assert.equal(JSON.parse(lines[2]).id, "r2");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readTrajectoryFile returns null for a missing sidecar", async () => {
  const dir = mkdtempSync(join(tmpdir(), "traj-store-"));
  try {
    const result = await readTrajectoryFile(dir, "session-missing");
    assert.equal(result, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readTrajectoryFile round-trips a sidecar", async () => {
  const dir = mkdtempSync(join(tmpdir(), "traj-store-"));
  try {
    await ensureTrajectoryStore(dir, "session-1");
    await appendTrajectoryRecord(dir, "session-1", makeRecord());
    const result = await readTrajectoryFile(dir, "session-1");
    assert.equal(result?.records.length, 1);
    assert.equal(result?.records[0].kind, "request_start");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
