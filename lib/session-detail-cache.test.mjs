import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() } });
const {
  getParsedSessionSnapshot,
  getSessionContextFromSnapshot,
  invalidateParsedSession,
  sessionDetailCacheStats,
} = await jiti.import("./session-detail-cache.ts");

function writeSession(filePath, id) {
  writeFileSync(filePath, [
    JSON.stringify({
      type: "session",
      version: 3,
      id,
      timestamp: "2026-01-01T00:00:00.000Z",
      cwd: "/tmp/project",
    }),
    JSON.stringify({
      type: "message",
      id: `${id}-user`,
      parentId: null,
      timestamp: "2026-01-01T00:00:01.000Z",
      message: { role: "user", content: "request" },
    }),
    "",
  ].join("\n"), { mode: 0o600 });
}

function resetCache() {
  globalThis.__piSessionDetailCache = undefined;
}

test("parsed session snapshots merge in-flight reads and reuse unchanged files", async (t) => {
  resetCache();
  const directory = mkdtempSync(join(tmpdir(), "pi-web-detail-cache-"));
  const filePath = join(directory, "session.jsonl");
  writeSession(filePath, "session");
  t.after(() => {
    resetCache();
    rmSync(directory, { recursive: true, force: true });
  });

  const [first, concurrent] = await Promise.all([
    getParsedSessionSnapshot(filePath),
    getParsedSessionSnapshot(filePath),
  ]);
  const cached = await getParsedSessionSnapshot(filePath);
  assert.equal(first, concurrent);
  assert.equal(first, cached);
  assert.equal(first.entries.length, 1);
  assert.equal(first.stats.totalMessages, 1);
  assert.equal(cached.stats, first.stats);
  let contextBuilds = 0;
  const buildContext = () => {
    contextBuilds += 1;
    return { messages: [], entryIds: [], thinkingLevel: "off", model: null };
  };
  const contextOptions = { deferThinking: true, deferToolResultImages: true };
  const firstContext = getSessionContextFromSnapshot(
    first,
    first.leafId ?? undefined,
    contextOptions,
    buildContext,
  );
  const cachedContext = getSessionContextFromSnapshot(
    first,
    first.leafId ?? undefined,
    contextOptions,
    buildContext,
  );
  assert.equal(firstContext, cachedContext);
  assert.equal(contextBuilds, 1);
  assert.deepEqual(sessionDetailCacheStats(), {
    entries: 1,
    bytes: sessionDetailCacheStats().bytes,
    contextEntries: 1,
    contextBytes: first.sourceBytes * 2,
    inFlight: 0,
  });

  appendFileSync(filePath, `${JSON.stringify({
    type: "message",
    id: "assistant",
    parentId: "session-user",
    timestamp: "2026-01-01T00:00:02.000Z",
    message: { role: "assistant", provider: "test", model: "test", content: "answer" },
  })}\n`);
  const changed = await getParsedSessionSnapshot(filePath);
  assert.notEqual(changed, first);
  assert.equal(changed.entries.length, 2);
  assert.equal(changed.stats.totalMessages, 2);
  assert.equal(first.stats.totalMessages, 1);
});

test("上下文缓存区分空叶节点、默认叶节点和惰性图片的会话身份", async (t) => {
  resetCache();
  const directory = mkdtempSync(join(tmpdir(), "pi-web-context-identity-"));
  t.after(() => { resetCache(); rmSync(directory, { recursive: true, force: true }); });
  const filePath = join(directory, "session.jsonl");
  writeSession(filePath, "session");
  const snapshot = await getParsedSessionSnapshot(filePath);
  const { buildSessionContext } = await jiti.import("./session-reader.ts");
  const options = { deferThinking: true, deferToolResultImages: true, sessionId: "one" };
  const full = getSessionContextFromSnapshot(snapshot, undefined, options, () => buildSessionContext(snapshot.entries));
  const empty = getSessionContextFromSnapshot(snapshot, null, options, () => buildSessionContext(snapshot.entries, null));
  assert.equal(full.messages.length, 1);
  assert.deepEqual(empty.messages, []);
  let rebuilt = false;
  getSessionContextFromSnapshot(snapshot, undefined, { ...options, sessionId: "two" }, () => { rebuilt = true; return buildSessionContext(snapshot.entries); });
  assert.equal(rebuilt, true);
  assert.equal(getSessionContextFromSnapshot(snapshot, undefined, options, () => { throw new Error("同一身份应命中缓存"); }), full);
});

test("context cache admits a 28MB session but rejects oversized projections", () => {
  resetCache();
  const snapshot = {
    entries: [],
    filePath: "/tmp/pi-web-context-capacity.jsonl",
    fingerprint: "v1",
    header: null,
    sourceBytes: 28 * 1024 * 1024,
    leafId: null,
    tree: [],
  };
  const build = () => ({ messages: [], entryIds: [], thinkingLevel: "off", model: null });
  getSessionContextFromSnapshot(
    snapshot,
    undefined,
    { deferThinking: true, deferToolResultImages: true },
    build,
  );
  assert.equal(sessionDetailCacheStats().contextEntries, 1);
  assert.equal(sessionDetailCacheStats().contextBytes, 56 * 1024 * 1024);

  getSessionContextFromSnapshot(
    { ...snapshot, fingerprint: "v2", sourceBytes: 33 * 1024 * 1024 },
    undefined,
    { deferThinking: true, deferToolResultImages: true },
    build,
  );
  assert.equal(sessionDetailCacheStats().contextEntries, 1);
  resetCache();
});

test("parsed session cache is entry bounded and supports precise invalidation", async (t) => {
  resetCache();
  const directory = mkdtempSync(join(tmpdir(), "pi-web-detail-cache-lru-"));
  t.after(() => {
    resetCache();
    rmSync(directory, { recursive: true, force: true });
  });

  const paths = [];
  for (let index = 0; index < 9; index += 1) {
    const filePath = join(directory, `${index}.jsonl`);
    writeSession(filePath, `session-${index}`);
    paths.push(filePath);
    await getParsedSessionSnapshot(filePath);
  }
  assert.equal(sessionDetailCacheStats().entries, 8);
  const latest = await getParsedSessionSnapshot(paths[8]);
  getSessionContextFromSnapshot(
    latest,
    latest.leafId ?? undefined,
    { deferThinking: false, deferToolResultImages: false },
    () => ({ messages: [], entryIds: [], thinkingLevel: "off", model: null }),
  );
  assert.equal(sessionDetailCacheStats().contextEntries, 1);
  invalidateParsedSession(paths[8]);
  assert.equal(sessionDetailCacheStats().entries, 7);
  assert.equal(sessionDetailCacheStats().contextEntries, 0);
});
