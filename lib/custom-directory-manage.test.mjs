import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  createRowDeleteHandler,
  createRowPathRenameHandler,
} = await jiti.import("./custom-directory-manage.ts");
const {
  addCustomDirectory,
  customDirectoryIdentity,
  listCustomDirectories,
  removeCustomDirectory,
  renameCustomDirectory,
  renameCustomDirectoryPath,
} = await jiti.import("./custom-directories.ts");
const {
  readExpandedGroupKeys,
  writeExpandedGroupKeys,
  discardExpandedGroupKey,
} = await jiti.import("./pinned-expansion.ts");

function memoryStorage(initial = new Map()) {
  return {
    getItem: (key) => (initial.has(key) ? initial.get(key) : null),
    setItem: (key, value) => { initial.set(key, String(value)); },
    removeItem: (key) => { initial.delete(key); },
  };
}

/**
 * The seams are wired exactly like the sidebar wires them: the REAL store
 * and the REAL expansion persistence, both over in-memory storage and both
 * injected. The tests drive the behavioral rules — the last-entry guard,
 * the expansion-key discard and the typed rename refusals — with no DOM.
 */
function createHarness() {
  const storage = memoryStorage();
  const expansionStorage = memoryStorage();
  const errors = [];
  const discarded = [];

  const deleteHandler = createRowDeleteHandler({
    list: () => listCustomDirectories(storage),
    remove: (path) => removeCustomDirectory(path, storage),
    discardExpandedKey: (key) => {
      discarded.push(key);
      // The real persistence seam. (The sidebar additionally mirrors the
      // discard into its in-memory accordion state; that is React state,
      // not seam logic.)
      discardExpandedGroupKey(key, expansionStorage);
    },
    onError: (reason) => errors.push(reason),
  });
  const renameHandler = createRowPathRenameHandler({
    renamePath: (currentPath, nextPath) =>
      renameCustomDirectoryPath(currentPath, nextPath, storage),
    onError: (reason) => errors.push(reason),
  });

  return {
    storage,
    // Exposed so tests can seed the REAL persistence seam (review r1
    // nonblocking, wi pi#51): without it the cleanup test seeded a dead
    // reference and its empty-set assertion was vacuous.
    expansionStorage,
    errors,
    discarded,
    deleteHandler,
    renameHandler,
    list: () => listCustomDirectories(storage),
    expansion: () => readExpandedGroupKeys(expansionStorage),
  };
}

test("delete refuses on the last remaining entry: typed reason, zero store mutation, nothing discarded", () => {
  const h = createHarness();
  addCustomDirectory("/only", h.storage);
  const before = JSON.stringify(h.list());

  const outcome = h.deleteHandler("/only");
  assert.deepEqual(outcome, { ok: false, reason: "lastEntry" });
  assert.deepEqual(h.errors, ["lastEntry"], "onError fires with the typed reason");
  assert.equal(JSON.stringify(h.list()), before, "the store is NOT mutated on refusal");
  assert.deepEqual(h.discarded, [], "no expansion key is discarded on refusal");
});

test("delete with more than one entry removes it and discards its expansion key", () => {
  const h = createHarness();
  addCustomDirectory("/a", h.storage);
  addCustomDirectory("/b", h.storage);
  writeExpandedGroupKeys(new Set([customDirectoryIdentity("/a")]), h.expansionStorage);
  // Non-vacuous guard (review r1 nonblocking, wi pi#51): the seed MUST
  // actually land in the harness's real expansion store before the
  // discard assertion below can mean anything.
  assert.equal(h.expansion().size, 1, "the expanded key exists before deletion");

  const outcome = h.deleteHandler("/a/");
  assert.deepEqual(outcome, { ok: true });
  assert.deepEqual(h.errors, [], "no refusal was reported");
  assert.deepEqual(h.list().map((entry) => entry.path), ["/b"]);
  // The discard used the store's real identity key, and the persisted
  // expansion set no longer references the deleted group.
  assert.deepEqual(h.discarded, [customDirectoryIdentity("/a")]);
  assert.deepEqual(h.expansion(), new Set());
});

test("delete of the LAST-but-one entry is allowed; only the true last entry is guarded", () => {
  const h = createHarness();
  addCustomDirectory("/a", h.storage);
  addCustomDirectory("/b", h.storage);
  addCustomDirectory("/c", h.storage);
  assert.deepEqual(h.deleteHandler("/a"), { ok: true });
  assert.deepEqual(h.deleteHandler("/b"), { ok: true });
  assert.deepEqual(h.list().map((entry) => entry.path), ["/c"]);
  // Now the guard fires — and never mutates.
  assert.deepEqual(h.deleteHandler("/c"), { ok: false, reason: "lastEntry" });
  assert.deepEqual(h.list().map((entry) => entry.path), ["/c"]);
});

test("rename maps the store primitive's refusals to typed reasons without writing", () => {
  const h = createHarness();
  addCustomDirectory("/a", h.storage);
  addCustomDirectory("/b", h.storage);
  const before = JSON.stringify(h.list());

  // Empty next path → "empty".
  assert.deepEqual(h.renameHandler("/a", "   "), { ok: false, reason: "empty" });
  // Identity collision with ANOTHER entry → "duplicate".
  assert.deepEqual(h.renameHandler("/a", "/b"), { ok: false, reason: "duplicate" });
  assert.deepEqual(h.renameHandler("/a", "/b/"), { ok: false, reason: "duplicate" });
  assert.deepEqual(h.errors, ["empty", "duplicate", "duplicate"]);
  assert.equal(JSON.stringify(h.list()), before, "refusals never write");
});

test("rename of the same identity is silent success (no-op close, no write)", () => {
  const h = createHarness();
  addCustomDirectory("/a", h.storage);
  const before = JSON.stringify(h.list());
  assert.deepEqual(h.renameHandler("/a", "/a"), { ok: true });
  assert.deepEqual(h.renameHandler("/a", "/a/"), { ok: true });
  assert.deepEqual(h.errors, []);
  assert.equal(JSON.stringify(h.list()), before, "a no-op rename never writes");
});

test("a valid rename succeeds and preserves the entry's extras", () => {
  const h = createHarness();
  addCustomDirectory("/a", h.storage);
  addCustomDirectory("/b", h.storage);
  renameCustomDirectory("/a", "Alpha", h.storage);

  assert.deepEqual(h.renameHandler("/a", "/work/alpha"), { ok: true });
  assert.deepEqual(h.errors, []);
  const entries = h.list();
  // Position preserved: "/a" was added before "/b", so it stays second.
  assert.deepEqual(entries.map((entry) => entry.path), ["/b", "/work/alpha"]);
  assert.deepEqual(entries.map((entry) => entry.displayName), [undefined, "Alpha"]);
});

test("the seams carry no production default writes (the sidebar owns the store)", async () => {
  const source = await readFile(new URL("./custom-directory-manage.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\?\?/, "no default fallbacks: every accessor is injected");
  assert.doesNotMatch(
    source,
    /listCustomDirectories\(|removeCustomDirectory\(|addCustomDirectory\(|renameCustomDirectoryPath\(/,
    "the seam calls no store accessors of its own; customDirectoryIdentity (a pure read helper) is the only store symbol it uses",
  );
});
