import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  buildExplorerRoots,
  readExplorerSectionExpanded,
  writeExplorerSectionExpanded,
} = await jiti.import("./explorer-roots.ts");
const {
  addCustomDirectory,
  customDirectoryIdentity,
  listCustomDirectories,
  removeCustomDirectory,
} = await jiti.import("./custom-directories.ts");

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

test("directory roots keep list order with the selected project as the trailing section", () => {
  // Custom-directory entries arrive most-recently-added first, exactly as
  // listCustomDirectories() yields them.
  assert.deepEqual(buildExplorerRoots([A, B], C), [
    { key: "/a", root: "/a" },
    { key: "/b", root: "/b" },
    { key: "/c", root: "/c" },
  ]);
});

test("a selected project that is already listed never duplicates its section", () => {
  assert.deepEqual(buildExplorerRoots([A, B], A), [A, B]);
  // Dedupe is by key: a worktree cwd selection whose project root is
  // listed also collapses into the existing section.
  assert.deepEqual(
    buildExplorerRoots([A, B], { key: "/a", root: "/a-worktree" }),
    [A, B],
  );
});

test("empty inputs produce an empty root set", () => {
  assert.deepEqual(buildExplorerRoots([], null), []);
  assert.deepEqual(buildExplorerRoots([], undefined), []);
});

test("malformed directory entries are skipped, not thrown on", () => {
  const malformed = [{ key: "", root: "/x" }, null, A];
  assert.deepEqual(buildExplorerRoots(malformed, C), [A, C]);
});

test("the section set mirrors the custom directory store (mock storage)", () => {
  // Feed entries exactly as the sidebar call site derives them from
  // lib/custom-directories.ts: { key: normalized entry path, root: entry.path }.
  const storage = createStorage();
  addCustomDirectory("/first", storage);
  addCustomDirectory("/second", storage);
  const entries = listCustomDirectories(storage).map((entry) => ({
    key: customDirectoryIdentity(entry.path),
    root: entry.path,
  }));
  // List order is mirrored: most-recently-added first.
  assert.deepEqual(
    buildExplorerRoots(entries, null),
    [{ key: "/second", root: "/second" }, { key: "/first", root: "/first" }],
  );
  // Identity dedupe: a selection that resolves into a listed entry (the
  // call site maps it onto the entry's key) adds no second section.
  assert.deepEqual(
    buildExplorerRoots(entries, { key: "/first", root: "/first" }),
    [{ key: "/second", root: "/second" }, { key: "/first", root: "/first" }],
  );
  // Removing an entry removes its section.
  removeCustomDirectory("/second", storage);
  const remaining = listCustomDirectories(storage).map((entry) => ({
    key: customDirectoryIdentity(entry.path),
    root: entry.path,
  }));
  assert.deepEqual(buildExplorerRoots(remaining, null), [{ key: "/first", root: "/first" }]);
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

test("buildExplorerRoots carries the entry's displayName through to the section headers (pi#45 review blocker 1)", () => {
  const roots = buildExplorerRoots(
    [
      { key: "k1", root: "/data/Notes", displayName: "Notes" },
      { key: "k2", root: "/data/plain" },
    ],
    null,
  );
  assert.equal(roots[0].displayName, "Notes");
  assert.equal(roots[1].displayName, undefined);
  // Entries without a displayName deep-equal the legacy shape (no extra key).
  assert.deepEqual(roots[1], { key: "k2", root: "/data/plain" });
  // The selected fallback keeps its displayName too.
  const withSel = buildExplorerRoots([{ key: "k1", root: "/data/Notes" }], { key: "k2", root: "/x", displayName: "X" });
  assert.equal(withSel.find((r) => r.key === "k2")?.displayName, "X");
});
