import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() } });
const { DocumentPreviewCache, documentPreviewCacheKey } = await jiti.import("./document-preview-cache.ts");

test("document preview keys include both path and file version", () => {
  assert.notEqual(
    documentPreviewCacheKey("/repo/a.docx", '"v1"'),
    documentPreviewCacheKey("/repo/b.docx", '"v1"'),
  );
  assert.notEqual(
    documentPreviewCacheKey("/repo/a.docx", '"v1"'),
    documentPreviewCacheKey("/repo/a.docx", '"v2"'),
  );
});

test("document previews merge concurrent conversion and reuse the completed value", async () => {
  const cache = new DocumentPreviewCache(4, 1_000);
  let conversions = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const create = async () => {
    conversions += 1;
    await gate;
    return "<p>preview</p>";
  };

  const first = cache.getOrCreate("key", create);
  const second = cache.getOrCreate("key", create);
  assert.equal(conversions, 1);
  assert.equal(cache.stats().inFlight, 1);
  release();
  assert.equal(await first, "<p>preview</p>");
  assert.equal(await second, "<p>preview</p>");
  assert.equal(await cache.getOrCreate("key", create), "<p>preview</p>");
  assert.equal(conversions, 1);
  assert.deepEqual(cache.stats(), { entries: 1, bytes: 14, inFlight: 0 });
});

test("failed conversions are neither cached nor left in flight", async () => {
  const cache = new DocumentPreviewCache(2, 1_000);
  await assert.rejects(cache.getOrCreate("key", async () => {
    throw new Error("conversion failed");
  }), /conversion failed/);
  assert.deepEqual(cache.stats(), { entries: 0, bytes: 0, inFlight: 0 });
  assert.equal(await cache.getOrCreate("key", async () => "recovered"), "recovered");
});

test("document preview LRU enforces entry and byte bounds", () => {
  const cache = new DocumentPreviewCache(2, 8);
  cache.set("a", "aaaa");
  cache.set("b", "bbbb");
  assert.equal(cache.get("a"), "aaaa");
  cache.set("c", "cccc");
  assert.equal(cache.get("b"), undefined);
  assert.equal(cache.get("c"), "cccc");
  cache.set("oversized", "123456789");
  assert.equal(cache.get("oversized"), undefined);
  assert.ok(cache.stats().entries <= 2);
  assert.ok(cache.stats().bytes <= 8);
});
