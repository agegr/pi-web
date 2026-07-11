import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { getCachedEntries, setCachedEntries, invalidateSessionEntriesCache } =
  await jiti.import("./session-cache.ts");

test("getCachedEntries returns undefined on first miss", () => {
  invalidateSessionEntriesCache("no_such_session");
  assert.equal(getCachedEntries("no_such_session", 1234), undefined);
});

test("setCachedEntries then getCachedEntries with matching mtime returns entries", () => {
  const id = "test_match_" + Math.random().toString(36).slice(2);
  const entries = [{ id: "e1" }, { id: "e2" }];
  setCachedEntries(id, entries, 100);
  assert.equal(getCachedEntries(id, 100), entries);
  invalidateSessionEntriesCache(id);
});

test("getCachedEntries invalidates when file mtime changes", () => {
  const id = "test_mtime_" + Math.random().toString(36).slice(2);
  const entries = [{ id: "e1" }];
  setCachedEntries(id, entries, 100);
  // Same mtime → hit
  assert.equal(getCachedEntries(id, 100), entries);
  // Different mtime → miss (drop the stale entry)
  assert.equal(getCachedEntries(id, 200), undefined);
  // A subsequent setCachedEntries with the new mtime replenishes the cache.
  setCachedEntries(id, entries, 200);
  assert.equal(getCachedEntries(id, 200), entries);
  invalidateSessionEntriesCache(id);
});

test("invalidateSessionEntriesCache removes the entry", () => {
  const id = "test_inval_" + Math.random().toString(36).slice(2);
  setCachedEntries(id, [{ id: "e1" }], 1);
  invalidateSessionEntriesCache(id);
  // After explicit invalidation, even with the same mtime we miss.
  assert.equal(getCachedEntries(id, 1), undefined);
});