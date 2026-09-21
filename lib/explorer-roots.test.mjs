import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  buildExplorerRoots,
  readExplorerSectionExpanded,
  writeExplorerSectionExpanded,
} = await jiti.import("./explorer-roots.ts");

// Same StorageLike wrapper shape as lib/pinned-projects.test.mjs.
function createStorage(values = new Map()) {
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

const A = { key: "/a", root: "/a" };
const B = { key: "/b", root: "/b" };
const C = { key: "/c", root: "/c" };

test("pinned roots keep pin order with the selected project as the trailing section", () => {
  // Pinned entries arrive most-recently-pinned first, exactly as
  // getPinnedProjects() yields them.
  assert.deepEqual(buildExplorerRoots([A, B], C), [
    { key: "/a", root: "/a" },
    { key: "/b", root: "/b" },
    { key: "/c", root: "/c" },
  ]);
});

test("a selected project that is already pinned never duplicates its section", () => {
  assert.deepEqual(buildExplorerRoots([A, B], A), [A, B]);
  // Dedupe is by stable key: a worktree cwd selection whose project root is
  // pinned also collapses into the existing section.
  assert.deepEqual(
    buildExplorerRoots([A, B], { key: "/a", root: "/a-worktree" }),
    [A, B],
  );
});

test("empty inputs produce an empty root set", () => {
  assert.deepEqual(buildExplorerRoots([], null), []);
  assert.deepEqual(buildExplorerRoots([], undefined), []);
});

test("malformed pinned entries are skipped, not thrown on", () => {
  const malformed = [{ key: "", root: "/x" }, null, A];
  assert.deepEqual(buildExplorerRoots(malformed, C), [A, C]);
});

test("section expansion persists under the dedicated storage key", () => {
  const storage = createStorage();
  assert.deepEqual(readExplorerSectionExpanded(storage), new Set());
  writeExplorerSectionExpanded(new Set(["/a", "/c"]), storage);
  assert.deepEqual(readExplorerSectionExpanded(storage), new Set(["/a", "/c"]));
  // Empty state removes the key rather than storing "[]".
  writeExplorerSectionExpanded(new Set(), storage);
  assert.equal(storage.values.has("pi-web:file-explorer:section-expanded"), false);
  assert.deepEqual(readExplorerSectionExpanded(storage), new Set());
});

test("corrupt or absent expansion storage reads as the empty set", () => {
  assert.deepEqual(readExplorerSectionExpanded(null), new Set());
  const corrupt = createStorage(new Map([
    ["pi-web:file-explorer:section-expanded", "{not json"],
  ]));
  assert.deepEqual(readExplorerSectionExpanded(corrupt), new Set());
  const wrongShape = createStorage(new Map([
    ["pi-web:file-explorer:section-expanded", "{\"a\":1}"],
  ]));
  assert.deepEqual(readExplorerSectionExpanded(wrongShape), new Set());
  const junkEntries = createStorage(new Map([
    ["pi-web:file-explorer:section-expanded", "[\"/a\", 5, null, \"/b\"]"],
  ]));
  assert.deepEqual(readExplorerSectionExpanded(junkEntries), new Set(["/a", "/b"]));
});

test("failed expansion writes are swallowed, never thrown", () => {
  const broken = {
    getItem() { return null; },
    setItem() { throw new Error("quota exceeded"); },
    removeItem() { throw new Error("quota exceeded"); },
  };
  assert.doesNotThrow(() => writeExplorerSectionExpanded(new Set(["/a"]), broken));
  assert.doesNotThrow(() => writeExplorerSectionExpanded(new Set(), broken));
});
