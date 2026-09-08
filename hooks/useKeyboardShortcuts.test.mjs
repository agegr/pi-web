import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./useKeyboardShortcuts.ts", import.meta.url), "utf8");

test("global shortcuts include Command+Shift+O and slash editable guard", () => {
  assert.match(source, /e\.key\.toLowerCase\(\) === "o" && e\.metaKey && e\.shiftKey/);
  assert.match(source, /e\.key === "\/" && !e\.ctrlKey && !e\.altKey && !e\.metaKey/);
  assert.match(source, /isEditableTarget\(e\.target\)/);
  assert.match(source, /tagName === "INPUT"/);
  assert.match(source, /tagName === "TEXTAREA"/);
  assert.match(source, /isContentEditable === true/);
});
