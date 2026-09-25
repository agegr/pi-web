import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  PINNED_EXPANDED_STORAGE_KEY,
  readExpandedGroupKeys,
  writeExpandedGroupKeys,
  discardExpandedGroupKey,
} = await jiti.import("./pinned-expansion.ts");

// Same StorageLike wrapper shape as lib/custom-directories.test.mjs.
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

const KEY = PINNED_EXPANDED_STORAGE_KEY;

test("absent storage reads as the empty set and writes are dropped", () => {
  assert.deepEqual(readExpandedGroupKeys(null), new Set());
  assert.doesNotThrow(() => writeExpandedGroupKeys(new Set(["k"]), null));
  assert.doesNotThrow(() => discardExpandedGroupKey("k", null));
});

test("write persists the key set; read restores it (round-trip)", () => {
  const storage = createStorage();
  writeExpandedGroupKeys(new Set(["/repo/a"]), storage);
  assert.deepEqual(readExpandedGroupKeys(storage), new Set(["/repo/a"]));
  // An independent storage view (hot reload / second instance) sees the
  // same persisted state — accessors never cache.
  assert.deepEqual(readExpandedGroupKeys(createStorage(storage.values)), new Set(["/repo/a"]));
});

test("corrupt or non-array payloads degrade to the empty set", () => {
  assert.deepEqual(readExpandedGroupKeys(createStorage(new Map([[KEY, "{not json"]]))), new Set());
  assert.deepEqual(readExpandedGroupKeys(createStorage(new Map([[KEY, "{\"a\":1}"]]))), new Set());
  // Non-string members are filtered out.
  assert.deepEqual(
    readExpandedGroupKeys(createStorage(new Map([[KEY, JSON.stringify(["k", 3, null])]]))),
    new Set(["k"]),
  );
});

test("discard removes the key from the persisted set (the deleted group leaves no stale reference)", () => {
  const storage = createStorage();
  writeExpandedGroupKeys(new Set(["/repo/a"]), storage);
  discardExpandedGroupKey("/repo/a", storage);
  assert.deepEqual(readExpandedGroupKeys(storage), new Set(), "the accordion's single expanded key is dropped, leaving the empty set");
  // Discarding a key that is not present never writes.
  const before = storage.getItem(KEY);
  discardExpandedGroupKey("/repo/other", storage);
  assert.equal(storage.getItem(KEY), before);
});

test("discard keeps every OTHER key intact (legacy multi-key storage)", () => {
  const storage = createStorage(new Map([[KEY, JSON.stringify(["/a", "/b"])]]));
  discardExpandedGroupKey("/a", storage);
  assert.deepEqual(readExpandedGroupKeys(storage), new Set(["/b"]));
});

test("unavailable storage never throws on any accessor", () => {
  const broken = {
    getItem() { throw new Error("denied"); },
    setItem() { throw new Error("denied"); },
    removeItem() { throw new Error("denied"); },
  };
  assert.doesNotThrow(() => readExpandedGroupKeys(broken));
  assert.deepEqual(readExpandedGroupKeys(broken), new Set());
  assert.doesNotThrow(() => writeExpandedGroupKeys(new Set(["k"]), broken));
  assert.doesNotThrow(() => discardExpandedGroupKey("k", broken));
});
