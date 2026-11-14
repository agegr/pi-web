import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { claimDoneChime, DONE_CHIME_STORAGE_KEY, DONE_CHIME_RECORD_MS } = await jiti.import("./done-chime.ts");

function memoryStorage() {
  const store = new Map();
  return {
    store,
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
  };
}

test("one completion chimes once across pages: the event, then another page's poll", () => {
  const storage = memoryStorage();
  // The page showing A gets its agent_end at 10_000.
  assert.equal(claimDoneChime(["A"], 10_000 - 3_000, 10_000, storage), true);
  // A second page showing A gets the same event a moment later.
  assert.equal(claimDoneChime(["A"], 10_050 - 3_000, 10_050, storage), false);
  // Another page's poll last saw A running at 8_000, and sees it done at 11_500.
  assert.equal(claimDoneChime(["A"], 8_000, 11_500, storage), false);
});

test("a later run of the same session chimes again", () => {
  const storage = memoryStorage();
  assert.equal(claimDoneChime(["A"], 0, 10_000, storage), true);
  // A poll saw A running again at 20_000: a chime before then was for the earlier run.
  assert.equal(claimDoneChime(["A"], 20_000, 25_000, storage), true);
});

test("a page back from hidden skips a completion the session's page chimed for", () => {
  const storage = memoryStorage();
  assert.equal(claimDoneChime(["A"], 60_000 - 3_000, 60_000, storage), true);
  // Hidden since 5_000, the page's last poll saw A running then.
  assert.equal(claimDoneChime(["A"], 5_000, 600_000, storage), false);
});

test("a poll's batch chimes when one of its sessions is unclaimed, and claims only that one", () => {
  const storage = memoryStorage();
  claimDoneChime(["A"], 0, 10_000, storage);
  assert.equal(claimDoneChime(["A", "B"], 8_000, 11_000, storage), true);
  const record = JSON.parse(storage.store.get(DONE_CHIME_STORAGE_KEY));
  assert.deepEqual(record, { A: 10_000, B: 11_000 });
  assert.equal(claimDoneChime(["A", "B"], 8_000, 11_100, storage), false);
});

test("old claims are dropped when the record is written", () => {
  const storage = memoryStorage();
  claimDoneChime(["old"], 0, 1_000, storage);
  claimDoneChime(["new"], 0, 1_000 + DONE_CHIME_RECORD_MS + 1, storage);
  assert.deepEqual(Object.keys(JSON.parse(storage.store.get(DONE_CHIME_STORAGE_KEY))), ["new"]);
});

test("without working storage every completion chimes, as before", () => {
  assert.equal(claimDoneChime(["A"], 0, 1, null), true);
  const throwing = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); } };
  assert.equal(claimDoneChime(["A"], 0, 1, throwing), true);
  assert.equal(claimDoneChime(["A"], 0, 2, throwing), true);
  const corrupt = memoryStorage();
  corrupt.setItem(DONE_CHIME_STORAGE_KEY, "{not json");
  assert.equal(claimDoneChime(["A"], 0, 1, corrupt), true);
  assert.equal(claimDoneChime([], 0, 1, corrupt), false);
});
