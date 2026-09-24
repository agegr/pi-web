import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  OPEN_PANE_TABS_KEY,
  parseOpenPaneTabs,
  serializeOpenPaneTabs,
  readOpenPaneTabs,
  writeOpenPaneTabs,
} = await jiti.import("./pane-tab-state.ts");
const { NEW_SESSION_TAB_ID } = await jiti.import("./pane-state.ts");

function createStorage(initial = new Map()) {
  const values = initial;
  return {
    values,
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

function pane(sessionId, label = `label-${sessionId}`, projectName = "proj") {
  return { sessionId, label, projectName, hasBadge: false };
}

test("storage key is schema-named and stable", () => {
  assert.equal(OPEN_PANE_TABS_KEY, "pi-web:open-pane-tabs");
});

test("serialize/parse round-trips tabs in order with focus", () => {
  const tabs = [pane("s1"), pane("s2"), pane("s3")];
  const raw = serializeOpenPaneTabs(tabs, "s2");
  const record = parseOpenPaneTabs(raw);
  assert.deepEqual(record, {
    version: 1,
    tabs: [
      { sessionId: "s1", label: "label-s1", projectName: "proj" },
      { sessionId: "s2", label: "label-s2", projectName: "proj" },
      { sessionId: "s3", label: "label-s3", projectName: "proj" },
    ],
    focusedPaneId: "s2",
  });
});

test("the sentinel new-session tab and hasBadge are never stored", () => {
  const tabs = [pane(NEW_SESSION_TAB_ID, "New", "proj"), pane("s1")];
  const record = parseOpenPaneTabs(serializeOpenPaneTabs(tabs, NEW_SESSION_TAB_ID));
  assert.deepEqual(record.tabs, [{ sessionId: "s1", label: "label-s1", projectName: "proj" }]);
  // A focused sentinel does not survive as the focused pane either.
  assert.equal(record.focusedPaneId, null);
});

test("duplicate session ids keep the first occurrence", () => {
  const raw = JSON.stringify({
    version: 1,
    tabs: [
      { sessionId: "s1", label: "first", projectName: "proj-a" },
      { sessionId: "s2", label: "keep", projectName: "proj-b" },
      { sessionId: "s1", label: "second", projectName: "proj-c" },
    ],
    focusedPaneId: "s2",
  });
  const record = parseOpenPaneTabs(raw);
  assert.deepEqual(record.tabs, [
    { sessionId: "s1", label: "first", projectName: "proj-a" },
    { sessionId: "s2", label: "keep", projectName: "proj-b" },
  ]);
  assert.equal(record.focusedPaneId, "s2");
});

test("corrupt and partial records degrade to the largest valid subset", () => {
  const raw = JSON.stringify({
    version: 1,
    tabs: [
      { sessionId: "s1", label: "good", projectName: "proj" },
      null,
      "junk",
      { sessionId: "" },
      { sessionId: "s2", projectName: "missing-label" },
      { sessionId: "s3", label: "ok", projectName: "proj" },
      [ "array entry" ],
    ],
    focusedPaneId: "s3",
  });
  const record = parseOpenPaneTabs(raw);
  assert.deepEqual(record.tabs, [
    { sessionId: "s1", label: "good", projectName: "proj" },
    { sessionId: "s3", label: "ok", projectName: "proj" },
  ]);
  assert.equal(record.focusedPaneId, "s3");
});

test("unknown record versions are unparseable", () => {
  for (const version of [0, 2, "1", null]) {
    const raw = JSON.stringify({ version, tabs: [{ sessionId: "s1", label: "l", projectName: "p" }], focusedPaneId: "s1" });
    assert.equal(parseOpenPaneTabs(raw), null, `version ${String(version)}`);
  }
});

test("non-records are unparseable", () => {
  assert.equal(parseOpenPaneTabs(null), null);
  assert.equal(parseOpenPaneTabs("null"), null);
  assert.equal(parseOpenPaneTabs("42"), null);
  assert.equal(parseOpenPaneTabs('"text"'), null);
  assert.equal(parseOpenPaneTabs("[1,2,3]"), null);
  assert.equal(parseOpenPaneTabs("not json {"), null);
  assert.equal(parseOpenPaneTabs(JSON.stringify({ tabs: [{ sessionId: "s1", label: "l", projectName: "p" }] })), null);
});

test("missing or non-array tabs degrade to an empty tab list", () => {
  assert.deepEqual(parseOpenPaneTabs(JSON.stringify({ version: 1 })), { version: 1, tabs: [], focusedPaneId: null });
  assert.deepEqual(
    parseOpenPaneTabs(JSON.stringify({ version: 1, tabs: "nope" })),
    { version: 1, tabs: [], focusedPaneId: null },
  );
});

test("a focusedPaneId that matches no kept tab is dropped", () => {
  const raw = JSON.stringify({
    version: 1,
    tabs: [{ sessionId: "s1", label: "l", projectName: "p" }],
    focusedPaneId: "s2",
  });
  assert.equal(parseOpenPaneTabs(raw).focusedPaneId, null);
});

test("an empty strip serializes to an empty record (clears stale tabs)", () => {
  const record = parseOpenPaneTabs(serializeOpenPaneTabs([], null));
  assert.deepEqual(record, { version: 1, tabs: [], focusedPaneId: null });
});

test("closing the last pane REMOVES the storage key (spec R2: entry logic restarts)", () => {
  const storage = createStorage();
  writeOpenPaneTabs([pane("s1")], "s1", storage);
  assert.ok(storage.values.has(OPEN_PANE_TABS_KEY), "a real strip is persisted");
  // Only the sentinel new-session tab remains → nothing real to store → the
  // key is removed, not an empty record.
  writeOpenPaneTabs([{ sessionId: "__new-session__", label: "new", projectName: "p", hasBadge: false }], "__new-session__", storage);
  assert.ok(!storage.values.has(OPEN_PANE_TABS_KEY), "the sentinel alone removes the key");
  // Re-open, then close all: removed again.
  writeOpenPaneTabs([pane("s1"), pane("s2")], "s2", storage);
  assert.ok(storage.values.has(OPEN_PANE_TABS_KEY));
  writeOpenPaneTabs([], null, storage);
  assert.ok(!storage.values.has(OPEN_PANE_TABS_KEY), "an empty strip removes the key so the next reload starts from the entry logic");
});

test("read/write round-trip through storage", () => {
  const storage = createStorage();
  writeOpenPaneTabs([pane("s1"), pane("s2")], "s1", storage);
  assert.equal(storage.values.get(OPEN_PANE_TABS_KEY), serializeOpenPaneTabs([pane("s1"), pane("s2")], "s1"));
  const record = readOpenPaneTabs(storage);
  assert.deepEqual(record.tabs.map((t) => t.sessionId), ["s1", "s2"]);
  assert.equal(record.focusedPaneId, "s1");
});

test("read returns null for empty/absent/corrupt storage values", () => {
  const storage = createStorage();
  assert.equal(readOpenPaneTabs(storage), null);
  storage.values.set(OPEN_PANE_TABS_KEY, "");
  assert.equal(readOpenPaneTabs(storage), null);
  storage.values.set(OPEN_PANE_TABS_KEY, "{corrupt");
  assert.equal(readOpenPaneTabs(storage), null);
});

test("unavailable storage degrades to no persistence, never a crash", () => {
  assert.equal(readOpenPaneTabs(null), null);
  // write is a no-op against null storage
  writeOpenPaneTabs([pane("s1")], "s1", null);
});

test("throwing storage is swallowed on both read and write", () => {
  const throwing = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("quota");
    },
    removeItem() {
      throw new Error("blocked");
    },
  };
  assert.equal(readOpenPaneTabs(throwing), null);
  writeOpenPaneTabs([pane("s1")], "s1", throwing);
});
