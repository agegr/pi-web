import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");

test("extension input dialogs send one session notification per request", () => {
  assert.match(source, /notifiedExtensionDialogIdRef\.current === extensionDialog\.id/);
  assert.match(source, /notifySessionRef\.current\(/);
  assert.match(source, /extensionDialog\.method === "confirm"/);
});

test("custom ask dialogs also send one session notification per request", () => {
  assert.match(source, /notifiedExtensionCustomUiIdRef\.current === extensionCustomUi\.id/);
  assert.match(source, /extensionCustomUi\.closed/);
});
