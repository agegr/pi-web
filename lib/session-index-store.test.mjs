import assert from "node:assert/strict";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() } });
const {
  SESSION_INDEX_MAX_ENTRIES,
  defaultSessionIndexPath,
  loadSessionIndex,
  persistSessionIndex,
} = await jiti.import("./session-index-store.mts");

function entry(filePath, id = "session") {
  return {
    fingerprint: {
      size: "12",
      mtimeNs: "100",
      ctimeNs: "101",
      dev: "1",
      ino: "2",
    },
    metadata: {
      path: filePath,
      id,
      cwd: "/tmp/project",
      created: "2026-01-01T00:00:00.000Z",
      modified: "2026-01-01T00:00:01.000Z",
      messageCount: 1,
      firstMessage: "sensitive first message",
    },
  };
}

test("persistent session indexes round-trip atomically with private permissions", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "pi-web-index-store-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const filePath = defaultSessionIndexPath(directory);
  const entries = new Map([
    ["/sessions/a.jsonl", entry("/sessions/a.jsonl", "a")],
    ["/sessions/invalid.jsonl", { ...entry("/sessions/invalid.jsonl"), metadata: null }],
  ]);

  persistSessionIndex(filePath, "sdk-0.84.2-projection-1", entries);
  const loaded = loadSessionIndex(filePath, "sdk-0.84.2-projection-1");
  assert.deepEqual([...loaded.entries()], [...entries.entries()]);
  assert.equal(readdirSync(join(directory, "cache", "pi-web")).some((name) => name.endsWith(".tmp")), false);
  if (process.platform !== "win32") {
    assert.equal(statSync(join(directory, "cache", "pi-web")).mode & 0o777, 0o700);
    assert.equal(statSync(filePath).mode & 0o777, 0o600);
  }
});

test("schema, projection, checksum, truncation, and permissions failures rebuild safely", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "pi-web-index-store-invalid-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const filePath = join(directory, "index.json");
  const entries = new Map([["/sessions/a.jsonl", entry("/sessions/a.jsonl", "a")]]);

  persistSessionIndex(filePath, "projection-1", entries);
  assert.equal(loadSessionIndex(filePath, "projection-2"), null);

  const envelope = JSON.parse(readFileSync(filePath, "utf8"));
  envelope.schemaVersion += 1;
  writeFileSync(filePath, JSON.stringify(envelope), { mode: 0o600 });
  assert.equal(loadSessionIndex(filePath, "projection-1"), null);

  persistSessionIndex(filePath, "projection-1", entries);
  const corrupted = JSON.parse(readFileSync(filePath, "utf8"));
  corrupted.entries[0][1].metadata.firstMessage = "tampered";
  writeFileSync(filePath, JSON.stringify(corrupted), { mode: 0o600 });
  assert.equal(loadSessionIndex(filePath, "projection-1"), null);

  writeFileSync(filePath, "{\"schemaVersion\":1", { mode: 0o600 });
  assert.equal(loadSessionIndex(filePath, "projection-1"), null);

  if (process.platform !== "win32") {
    persistSessionIndex(filePath, "projection-1", entries);
    chmodSync(filePath, 0o644);
    assert.equal(loadSessionIndex(filePath, "projection-1"), null);
  }
});

test("子会话投影可以持久化，非法关系字段触发重建", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "pi-web-index-store-subagent-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const filePath = join(directory, "index.json");
  const value = entry("/sessions/a.jsonl", "a");
  const relation = { parentSessionId: "parent", profile: "explore", description: "检查", status: "completed" };
  value.metadata.subagent = relation;
  const entries = new Map([["/sessions/a.jsonl", value]]);
  persistSessionIndex(filePath, "projection-2", entries);
  assert.deepEqual(loadSessionIndex(filePath, "projection-2").get("/sessions/a.jsonl").metadata.subagent, relation);
  assert.equal(loadSessionIndex(filePath, "projection-1"), null);
  // persistSessionIndex computes a valid checksum: these failures test schema validation, not tampering.
  for (const invalid of [null, [], { ...relation, parentSessionId: 12 }, { ...relation, profile: null }, { ...relation, description: {} }, { ...relation, status: "running" }]) {
    value.metadata.subagent = invalid;
    persistSessionIndex(filePath, "projection-2", entries);
    assert.equal(loadSessionIndex(filePath, "projection-2"), null);
  }
});

test("persistent index rejects entry-count overflow instead of truncating", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "pi-web-index-store-limit-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const filePath = join(directory, "index.json");
  const entries = new Map();
  const shared = entry("/sessions/shared.jsonl");
  for (let index = 0; index <= SESSION_INDEX_MAX_ENTRIES; index += 1) {
    entries.set(`/sessions/${index}.jsonl`, shared);
  }
  assert.throws(
    () => persistSessionIndex(filePath, "projection-1", entries),
    /exceeds .* entries/,
  );
  assert.equal(loadSessionIndex(filePath, "projection-1"), null);
});
