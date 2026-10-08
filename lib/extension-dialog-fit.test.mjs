import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./extension-dialog-fit.ts");
}

test("leaves a dialog alone when nothing in it scrolls sideways", async () => {
  const { fitExtensionDialogWidth } = await loadSubject();
  assert.equal(fitExtensionDialogWidth(560, []), null);
  assert.equal(fitExtensionDialogWidth(560, [0, 0]), null);
  assert.equal(fitExtensionDialogWidth(560, [-30]), null);
});

test("ignores the one pixel sub-pixel rounding leaves behind", async () => {
  const { fitExtensionDialogWidth } = await loadSubject();
  assert.equal(fitExtensionDialogWidth(560, [1]), null);
  assert.equal(fitExtensionDialogWidth(560, [2]), 600);
});

test("grows by the widest overflow, rounded up to the next step", async () => {
  const { fitExtensionDialogWidth } = await loadSubject();
  // 560 + 180 = 740 -> 760
  assert.equal(fitExtensionDialogWidth(560, [40, 180, 95]), 760);
  // Already on a step boundary stays put.
  assert.equal(fitExtensionDialogWidth(560, [200]), 760);
  assert.equal(fitExtensionDialogWidth(560, [201]), 800);
});

test("measuring again at the fitted width finds nothing left to grow", async () => {
  const { fitExtensionDialogWidth } = await loadSubject();
  const first = fitExtensionDialogWidth(560, [313]);
  assert.equal(first, 880);
  // At 880px the block shows fully, so the next measurement reports no overflow.
  assert.equal(fitExtensionDialogWidth(first, [0]), null);
});
