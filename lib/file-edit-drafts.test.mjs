import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  getDirtyFilePaths,
  getFileEditDraft,
  hasFileEditDrafts,
  setFileEditDraft,
  subscribeFileEditDrafts,
} = await jiti.import("./file-edit-drafts.ts");

test("notifies only when the set of files with unsaved edits changes", () => {
  let notified = 0;
  const unsubscribe = subscribeFileEditDrafts(() => notified++);
  const before = getDirtyFilePaths();

  setFileEditDraft("/p/a.txt", { content: null, baseHash: "h1" });
  assert.equal(notified, 1);
  assert.ok(getDirtyFilePaths().has("/p/a.txt"));
  assert.notEqual(getDirtyFilePaths(), before);

  // Parking the text on unmount keeps the same paths: same snapshot.
  const snapshot = getDirtyFilePaths();
  setFileEditDraft("/p/a.txt", { content: "edited", baseHash: "h1" });
  assert.equal(notified, 1);
  assert.equal(getDirtyFilePaths(), snapshot);
  assert.deepEqual(getFileEditDraft("/p/a.txt"), { content: "edited", baseHash: "h1" });
  assert.equal(hasFileEditDrafts(), true);

  setFileEditDraft("/p/a.txt", null);
  assert.equal(notified, 2);
  assert.equal(hasFileEditDrafts(), false);
  assert.equal(getFileEditDraft("/p/a.txt"), undefined);

  unsubscribe();
  setFileEditDraft("/p/b.txt", { content: null, baseHash: "h2" });
  assert.equal(notified, 2);
  setFileEditDraft("/p/b.txt", null);
});
