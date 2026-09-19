import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./DirectoryPicker.tsx", import.meta.url), "utf8");

test("offers directory creation from the picker footer", () => {
  assert.match(source, /directoryPicker\.newDirectory/);
  assert.match(source, /disabled=\{!canCreate\}/);
  assert.match(source, /method: "POST"/);
  assert.match(source, /body: JSON\.stringify\(\{ path: parentPath, name \}\)/);
});

test("orders create-and-select, create, and cancel actions", () => {
  const confirmAndSelect = source.indexOf('t("directoryPicker.confirmAndSelect")');
  const confirm = source.indexOf('t("directoryPicker.confirm")', confirmAndSelect);
  const cancel = source.indexOf('t("i18n.cancel")', confirm);

  assert.ok(confirmAndSelect >= 0);
  assert.ok(confirm > confirmAndSelect);
  assert.ok(cancel > confirm);
  assert.match(source, /handleCreateDirectory\(true\)/);
  assert.match(source, /handleCreateDirectory\(false\)/);
});

test("selects the created directory or refreshes the current listing", () => {
  assert.match(source, /if \(selectAfterCreate\) \{[\s\S]*?onSelect\(createdPath\)/);
  assert.match(source, /else \{[\s\S]*?await navigateTo\(currentPath\)/);
});
