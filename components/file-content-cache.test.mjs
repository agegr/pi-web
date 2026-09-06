import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() } });
const { TextFileContentCache, textFileCacheKey } = await jiti.import("./file-content-cache.ts");

function data(content, etag) {
  return {
    content,
    language: "text",
    size: content.length,
    version: {
      exists: true,
      size: content.length,
      mtimeMs: 1,
      ctimeMs: 1,
      ino: 1,
      etag,
      lastModified: "Thu, 01 Jan 1970 00:00:00 GMT",
    },
  };
}

test("cache keys isolate path and source-session authorization context", () => {
  assert.notEqual(textFileCacheKey("/repo/a.ts", null), textFileCacheKey("/repo/a.ts", "session-1"));
  assert.notEqual(textFileCacheKey("/repo/a.ts", "session-1"), textFileCacheKey("/repo/a.ts", "session-2"));
  assert.equal(textFileCacheKey("C:\\repo\\a.ts", null), textFileCacheKey("C:/repo/a.ts", undefined));
});

test("LRU enforces entry count and refreshes recency on get", () => {
  const cache = new TextFileContentCache(2, 10_000);
  cache.set("a", data("a", '"a"'));
  cache.set("b", data("b", '"b"'));
  assert.equal(cache.get("a")?.content, "a");
  cache.set("c", data("c", '"c"'));
  assert.equal(cache.get("b"), undefined);
  assert.equal(cache.get("a")?.content, "a");
  assert.equal(cache.get("c")?.content, "c");
});

test("LRU enforces byte limits and skips oversized entries", () => {
  const cache = new TextFileContentCache(10, 270);
  cache.set("a", data("12345", '"a"'));
  assert.equal(cache.stats().entries, 1);
  cache.set("b", data("67890", '"b"'));
  assert.equal(cache.get("a"), undefined);
  assert.equal(cache.get("b")?.content, "67890");
  cache.set("huge", data("x".repeat(20), '"huge"'));
  assert.equal(cache.get("huge"), undefined);
});

test("replacing and deleting entries keeps byte accounting bounded", () => {
  const cache = new TextFileContentCache(2, 1_000);
  cache.set("a", data("a", '"a1"'));
  const firstBytes = cache.stats().bytes;
  cache.set("a", data("abcdef", '"a2"'));
  assert.equal(cache.stats().entries, 1);
  assert.ok(cache.stats().bytes > firstBytes);
  cache.delete("a");
  assert.deepEqual(cache.stats(), { entries: 0, bytes: 0 });
});
