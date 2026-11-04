import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  getExtensionWindowTitle,
  setExtensionWindowTitle,
  subscribeExtensionWindowTitles,
} = await jiti.import("./extension-window-title.ts");

// What useSyncExternalStore does with the hook's snapshot: on each store change it reads
// the snapshot again and renders only when it differs (Object.is).
function watch(sessionId) {
  let snapshot = getExtensionWindowTitle(sessionId);
  let renders = 0;
  const unsubscribe = subscribeExtensionWindowTitles(() => {
    const next = getExtensionWindowTitle(sessionId);
    if (!Object.is(next, snapshot)) renders += 1;
    snapshot = next;
  });
  return { get renders() { return renders; }, get title() { return snapshot; }, unsubscribe };
}

test("another session's title, or the same one again, does not render the selected session's", (t) => {
  const selected = watch("title-selected");
  t.after(() => selected.unsubscribe());

  // pi's titlebar-spinner sets a new frame every 80 ms: a side chat running one changes nothing here.
  for (const frame of ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴"]) setExtensionWindowTitle("title-side", `${frame} side`);
  assert.equal(selected.renders, 0);
  assert.equal(selected.title, null);

  setExtensionWindowTitle("title-selected", "⠋ main");
  setExtensionWindowTitle("title-selected", "⠋ main");
  assert.equal(selected.renders, 1);
  assert.equal(selected.title, "⠋ main");

  setExtensionWindowTitle("title-selected", "⠙ main");
  assert.equal(selected.renders, 2);
  assert.equal(getExtensionWindowTitle("title-side"), "⠴ side");
});

test("null clears a session's title, and no session has none", (t) => {
  const selected = watch("title-cleared");
  t.after(() => selected.unsubscribe());

  setExtensionWindowTitle("title-cleared", "Building");
  setExtensionWindowTitle("title-cleared", null);
  assert.equal(selected.title, null);
  assert.equal(selected.renders, 2);
  // Clearing a title that is already gone tells nobody.
  let notified = 0;
  const unsubscribe = subscribeExtensionWindowTitles(() => { notified += 1; });
  setExtensionWindowTitle("title-cleared", null);
  unsubscribe();
  assert.equal(notified, 0);
  assert.equal(getExtensionWindowTitle(null), null);
});
