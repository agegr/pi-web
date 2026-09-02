import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { archiveSession, listArchivedSessions, unarchiveSession } = await jiti.import("./session-archive.ts");
const { invalidateSessionListCache, invalidateSessionPathCache } = await jiti.import("./session-reader.ts");

function resetCaches() {
  globalThis.__piSessionListCache = undefined;
  globalThis.__piSessionListPromise = undefined;
  globalThis.__piSessionListPromiseGeneration = undefined;
  globalThis.__piSessionListGeneration = 0;
  globalThis.__piSessionPathCache = undefined;
  globalThis.__piPathToSessionIdCache = undefined;
}

function setTestAgentDir(t, agentDir) {
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  resetCaches();
  t.after(() => {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    resetCaches();
    rmSync(agentDir, { recursive: true, force: true });
  });
}

function writeSession(dir, id, { cwd = "/tmp/proj", parentSession, firstMessage = "hello" } = {}) {
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `2026-01-01T00-00-00-000Z_${id}.jsonl`);
  const header = {
    type: "session",
    version: 3,
    id,
    timestamp: "2026-01-01T00:00:00.000Z",
    cwd,
    ...(parentSession ? { parentSession } : {}),
  };
  const message = {
    type: "message",
    id: `${id}-msg`,
    parentId: null,
    timestamp: "2026-01-01T00:00:01.000Z",
    message: { role: "user", content: firstMessage },
  };
  writeFileSync(filePath, `${JSON.stringify(header)}\n${JSON.stringify(message)}\n`);
  return filePath;
}

test("archives a session into the project archive/ directory and restores it", async (t) => {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-web-archive-"));
  setTestAgentDir(t, agentDir);
  const projectDir = join(agentDir, "sessions", "proj-a");
  writeSession(projectDir, "sess-a", { firstMessage: "archive me" });
  invalidateSessionListCache();
  invalidateSessionPathCache("sess-a");

  const archived = await archiveSession("sess-a");
  assert.deepEqual(archived, { ok: true });
  assert.deepEqual(readdirSync(projectDir).filter((name) => name.endsWith(".jsonl")), []);
  assert.ok(readdirSync(join(projectDir, "archive")).some((name) => name.endsWith("_sess-a.jsonl")));

  const listed = await listArchivedSessions();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, "sess-a");
  assert.equal(listed[0].archived, true);
  assert.match(listed[0].firstMessage, /archive me/);

  const restored = await unarchiveSession("sess-a");
  assert.deepEqual(restored, { ok: true });
  assert.ok(readdirSync(projectDir).some((name) => name.endsWith("_sess-a.jsonl")));
  assert.equal((await listArchivedSessions()).length, 0);
});

test("archives direct child sessions with the parent", async (t) => {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-web-archive-child-"));
  setTestAgentDir(t, agentDir);
  const projectDir = join(agentDir, "sessions", "proj-b");
  const parentPath = writeSession(projectDir, "parent-b");
  writeSession(projectDir, "child-b", { parentSession: parentPath });
  invalidateSessionListCache();
  invalidateSessionPathCache("parent-b");
  invalidateSessionPathCache("child-b");

  const archived = await archiveSession("parent-b");
  assert.deepEqual(archived, { ok: true });
  const archiveNames = readdirSync(join(projectDir, "archive")).sort();
  assert.ok(archiveNames.some((name) => name.endsWith("_parent-b.jsonl")));
  assert.ok(archiveNames.some((name) => name.endsWith("_child-b.jsonl")));
  assert.equal(readdirSync(projectDir).filter((name) => name.endsWith(".jsonl")).length, 0);
});

test("can archive a session whose encoded project directory is named archive", async (t) => {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-web-archive-named-"));
  setTestAgentDir(t, agentDir);
  const projectDir = join(agentDir, "sessions", "archive");
  writeSession(projectDir, "looks-archived", { cwd: "/tmp/archive" });
  invalidateSessionListCache();
  invalidateSessionPathCache("looks-archived");

  const result = await archiveSession("looks-archived");
  assert.deepEqual(result, { ok: true });
  assert.ok(readdirSync(join(projectDir, "archive")).some((name) => name.endsWith("_looks-archived.jsonl")));
  const listed = await listArchivedSessions();
  assert.ok(listed.some((session) => session.id === "looks-archived"));
});

test("returns not found for unknown sessions", async (t) => {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-web-archive-missing-"));
  setTestAgentDir(t, agentDir);
  assert.deepEqual(await archiveSession("missing-id"), { ok: false, error: "Session not found" });
  assert.deepEqual(await unarchiveSession("missing-id"), { ok: false, error: "Session not found" });
});
