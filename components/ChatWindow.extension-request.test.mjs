import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const dialogSource = source.slice(source.indexOf("function ExtensionDialog"));
const customSource = source.slice(source.indexOf("function ExtensionCustomPanel"));

test("confines extension overlays to the content region above the composer", () => {
  assert.doesNotMatch(source, /function ExtensionRequestSheet/);
  assert.match(
    source,
    /className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden"[\s\S]*?<ExtensionDialog[\s\S]*?<ExtensionCustomPanel[\s\S]*?className="relative shrink-0"[\s\S]*?{chatInputElement}/,
  );
  assert.match(dialogSource, /position: "absolute"[\s\S]*?inset: 0/);
  assert.match(dialogSource, /pointerEvents: "none"/);
  assert.match(dialogSource, /pointerEvents: "auto"/);
  assert.match(customSource, /position: "absolute"[\s\S]*?inset: 0/);
  assert.match(customSource, /pointerEvents: "none"/);
  assert.doesNotMatch(source, /z-\[100\]|zIndex: 100/);
  assert.match(customSource, /maxHeight: "min\(760px, 100%\)"/);
});

test("adds collapse without replacing cancel", () => {
  assert.match(dialogSource, /setCollapsed\(true\)/);
  assert.match(dialogSource, /chat\.extensionCollapse/);
  assert.match(dialogSource, /chat\.cancel/);
  assert.doesNotMatch(dialogSource, /chat\.extensionSkip/);
});

test("resets collapse state when a new extension request arrives", () => {
  assert.match(source, /<ExtensionDialog key=\{extensionDialog.id\}/);
  assert.match(source, /<ExtensionCustomPanel key=\{extensionCustomUi.id\}/);
  assert.match(customSource, /if \(!collapsed\) inputRef.current\?\.focus\(\);\s*}, \[collapsed\]\)/);
});

test("docks extension overlays to the bottom so the chat stays scrollable", () => {
  assert.match(dialogSource, /alignItems: collapsed \? "flex-start" : "flex-end"/);
  assert.match(customSource, /alignItems: collapsed \? "flex-start" : "flex-end"/);
  assert.doesNotMatch(dialogSource, /alignItems: collapsed \? "flex-start" : "center"/);
  assert.doesNotMatch(customSource, /alignItems: collapsed \? "flex-start" : "center"/);
});

test("debounces the completion sound across chained dialogs", () => {
  assert.match(source, /EXTENSION_DIALOG_SOUND_MIN_GAP_MS = \d+/);
  assert.match(source, /now - extensionDialogLastSoundAtRef\.current < EXTENSION_DIALOG_SOUND_MIN_GAP_MS/);
});

test("splits folded context out of the dialog title into the body", () => {
  assert.match(dialogSource, /request\.title\.split\(\/\\n\{2,\}\/\)/);
  assert.match(dialogSource, /\{headerTitle\}/);
  assert.match(dialogSource, /\{bodyTitle\}/);
});
