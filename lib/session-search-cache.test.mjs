import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const {
  searchSessionContents,
  clearSessionSearchCache,
  sessionSearchCacheSize,
  sessionSearchCacheBytes,
} = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./session-search.ts");

const dir = mkdtempSync(join(tmpdir(), "pi-web-search-cache-"));

function entry(id, role, text) {
  return JSON.stringify({ type: "message", id, message: { role, content: [{ type: "text", text }] } });
}

function sessionFile(name, lines) {
  const path = join(dir, `${name}.jsonl`);
  writeFileSync(path, `${lines.join("\n")}\n`);
  return path;
}

function session(path, id, overrides = {}) {
  return {
    path,
    id,
    cwd: "/tmp",
    created: "2026-01-01T00:00:00.000Z",
    modified: "2026-01-02T00:00:00.000Z",
    messageCount: 1,
    firstMessage: "hello",
    name: "",
    ...overrides,
  };
}

test("cached and uncached scans return the same results", async () => {
  clearSessionSearchCache();
  const one = session(sessionFile("same-one", [entry("a1", "user", "deploy the cache layer"), entry("a2", "assistant", "cache layer deployed")]), "same-one");
  const two = session(sessionFile("same-two", [entry("b1", "user", "unrelated transcript")]), "same-two");

  const cold = await searchSessionContents([one, two], "cache layer");
  assert.equal(sessionSearchCacheSize(), 2, "a complete scan caches the files it read");
  const warm = await searchSessionContents([one, two], "cache layer");

  assert.deepEqual(warm, cold);
  assert.equal(warm.results.length, 1);
  assert.equal(warm.truncated, false);
});

test("a session that grew is read again instead of served from cache", async () => {
  clearSessionSearchCache();
  const path = sessionFile("growing", [entry("g1", "user", "first question about widgets")]);
  const info = session(path, "growing");

  assert.equal((await searchSessionContents([info], "widgets")).results.length, 1);
  assert.equal(sessionSearchCacheSize(), 1);

  appendFileSync(path, `${entry("g2", "assistant", "second answer about sprockets")}\n`);
  const after = await searchSessionContents([info], "sprockets");
  assert.equal(after.results.length, 1, "the appended text is searched");
  assert.equal(after.results[0].entryId, "g2");
});

test("an interrupted read is not cached", async () => {
  clearSessionSearchCache();
  const path = sessionFile("aborted", [entry("x1", "user", "something to find")]);
  const controller = new AbortController();
  controller.abort();

  await searchSessionContents([session(path, "aborted")], "something", controller.signal);
  assert.equal(sessionSearchCacheSize(), 0, "only complete reads are cached");
});

test("the cache is bounded and pruned to the listing it was asked about", async () => {
  clearSessionSearchCache();
  const sessions = [];
  for (let index = 0; index < 70; index += 1) {
    const path = sessionFile(`many-${index}`, [entry(`m${index}`, "user", `filler ${index}`)]);
    sessions.push(session(path, `many-${index}`, { modified: `2026-01-01T00:00:${String(index).padStart(2, "0")}.000Z` }));
  }

  // Nothing matches, so the scan reads every candidate rather than stopping at MAX_RESULTS.
  const none = await searchSessionContents(sessions, "zzzznotexist");
  assert.equal(none.results.length, 0);
  assert.equal(sessionSearchCacheSize(), 70, "every fully read session is cached");
  assert.ok(sessionSearchCacheBytes() > 0, "the byte budget is accounted for");

  // Narrowing the listing evicts the sessions that are no longer candidates.
  await searchSessionContents([sessions[0]], "zzzznotexist");
  assert.equal(sessionSearchCacheSize(), 1);
});

test("an oversized file is not cached", async () => {
  clearSessionSearchCache();
  const path = join(dir, "oversized.jsonl");
  writeFileSync(path, `${entry("h1", "user", "filler")}\n`);
  truncateSync(path, 16 * 1024 * 1024 + 1024);

  const result = await searchSessionContents([session(path, "oversized")], "zzzznotexist");
  assert.equal(result.truncated, true, "a read that stopped at the byte cap is reported as truncated");
  assert.equal(sessionSearchCacheSize(), 0, "a partial read is never cached");
});
