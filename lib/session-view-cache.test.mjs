import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  clearSessionViewCache,
  deleteSessionViewSnapshot,
  getSessionViewSnapshot,
  resetSessionViewCacheForTests,
  setSessionViewSnapshot,
  snapshotCoversLoadedEntries,
} = await jiti.import("./session-view-cache.ts");

function snapshot(overrides = {}) {
  return {
    sessionId: "s1",
    revision: "rev-1",
    messages: [{ role: "user", content: "hello" }],
    entryIds: ["e1"],
    leafId: "e1",
    oldestEntryId: "e1",
    hasMore: false,
    thinkingLevel: "off",
    model: null,
    loadedEntryIds: ["e1"],
    ...overrides,
  };
}

test("stores, reads, and deletes one snapshot with LRU touch", () => {
  resetSessionViewCacheForTests();
  assert.equal(setSessionViewSnapshot(snapshot()), true);
  assert.equal(getSessionViewSnapshot("s1")?.revision, "rev-1");
  assert.equal(getSessionViewSnapshot("missing"), null);
  deleteSessionViewSnapshot("s1");
  assert.equal(getSessionViewSnapshot("s1"), null);
});

test("refuses snapshots without a session id or revision", () => {
  resetSessionViewCacheForTests();
  assert.equal(setSessionViewSnapshot(snapshot({ sessionId: "" })), false);
  assert.equal(setSessionViewSnapshot(snapshot({ revision: "" })), false);
  assert.equal(getSessionViewSnapshot("s1"), null);
});

test("evicts least-recently-used sessions beyond the session cap", () => {
  resetSessionViewCacheForTests();
  for (let i = 0; i < 9; i++) {
    setSessionViewSnapshot(snapshot({ sessionId: `s${i}`, revision: `rev-${i}` }));
  }
  assert.equal(getSessionViewSnapshot("s0"), null, "oldest session evicted");
  assert.equal(getSessionViewSnapshot("s8")?.revision, "rev-8");
});

test("reading a snapshot refreshes its recency", () => {
  resetSessionViewCacheForTests();
  for (let i = 0; i < 8; i++) {
    setSessionViewSnapshot(snapshot({ sessionId: `s${i}`, revision: `rev-${i}` }));
  }
  // Touch s0 so it becomes most-recently used.
  assert.ok(getSessionViewSnapshot("s0"));
  setSessionViewSnapshot(snapshot({ sessionId: "s8", revision: "rev-8" }));
  assert.ok(getSessionViewSnapshot("s0"), "touched session survives eviction");
  assert.equal(getSessionViewSnapshot("s1"), null, "untouched oldest is evicted");
});

test("clearSessionViewCache drops every entry (logout path)", () => {
  resetSessionViewCacheForTests();
  setSessionViewSnapshot(snapshot({ sessionId: "a" }));
  setSessionViewSnapshot(snapshot({ sessionId: "b" }));
  clearSessionViewCache();
  assert.equal(getSessionViewSnapshot("a"), null);
  assert.equal(getSessionViewSnapshot("b"), null);
});

test("coverage check treats paged-in entries as covered only when recorded", () => {
  const base = snapshot({ entryIds: ["e1", "e2"] });
  assert.equal(snapshotCoversLoadedEntries(base, []), true);
  assert.equal(snapshotCoversLoadedEntries(base, ["e1"]), true);
  assert.equal(snapshotCoversLoadedEntries(base, ["e9"]), false);
  assert.equal(
    snapshotCoversLoadedEntries({ ...base, loadedEntryIds: ["e1", "e2", "e3", "e4"] }, ["e3", "e4"]),
    true,
  );
});
