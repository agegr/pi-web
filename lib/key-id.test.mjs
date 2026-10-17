import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { keyIdOf, matchesKeyId, formatKeyId, normalizeKeyId, parseKeyId, bindingKeys } = await jiti.import("@/lib/key-id.ts");
const { bindingKeysFor, sanitizeKeybindingsConfig, WEB_KEYBINDINGS } = await jiti.import("@/lib/keybindings-config.ts");

const key = (overrides) => ({
  code: "",
  key: "",
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...overrides,
});

test("a keydown becomes the key id pi's keybindings.json uses", () => {
  assert.equal(keyIdOf(key({ code: "Enter", key: "Enter", ctrlKey: true })), "ctrl+enter");
  assert.equal(keyIdOf(key({ code: "Enter", key: "Enter", altKey: true })), "alt+enter");
  assert.equal(keyIdOf(key({ code: "Enter", key: "Enter", shiftKey: true })), "shift+enter");
  assert.equal(keyIdOf(key({ code: "KeyN", key: "n", ctrlKey: true, altKey: true })), "ctrl+alt+n");
  assert.equal(keyIdOf(key({ code: "KeyK", key: "k", metaKey: true })), "super+k");
  assert.equal(keyIdOf(key({ code: "Escape", key: "Escape" })), "escape");
  assert.equal(keyIdOf(key({ code: "PageUp", key: "PageUp" })), "pageUp");
  // A bare modifier press has no id: nothing to bind.
  assert.equal(keyIdOf(key({ code: "ShiftLeft", key: "Shift", shiftKey: true })), null);
});

test("the base key follows the physical key, not the layout's character", () => {
  // A Dvorak/Colemak user still presses the same key; pi reads KeyN, not "n".
  assert.equal(keyIdOf(key({ code: "KeyN", key: "b", ctrlKey: true })), "ctrl+n");
  // Punctuation uses the character, which is what a user writes in the file.
  assert.equal(keyIdOf(key({ code: "Semicolon", key: ";", ctrlKey: true })), "ctrl+;");
});

test("matching accepts one key id or a list, as the file allows both", () => {
  const ctrlEnter = key({ code: "Enter", key: "Enter", ctrlKey: true });
  assert.equal(matchesKeyId(ctrlEnter, "ctrl+enter"), true);
  assert.equal(matchesKeyId(ctrlEnter, ["alt+enter", "ctrl+enter"]), true);
  assert.equal(matchesKeyId(ctrlEnter, "alt+enter"), false);
  assert.equal(matchesKeyId(ctrlEnter, []), false);
  assert.equal(matchesKeyId(ctrlEnter, undefined), false);
  // Spelling in the file does not matter.
  assert.equal(matchesKeyId(ctrlEnter, "Ctrl+Enter"), true);
});

test("formatting names a key the way its platform does", () => {
  assert.equal(formatKeyId("ctrl+enter"), "Ctrl+Enter");
  assert.equal(formatKeyId("alt+enter", "apple"), "Option+Enter");
  assert.equal(formatKeyId("alt+enter", "other"), "Alt+Enter");
  assert.equal(formatKeyId("super+k", "apple"), "⌘+K");
  assert.equal(formatKeyId("super+k", "other"), "Win+K");
});

test("normalizing makes two spellings of one key compare equal", () => {
  assert.equal(normalizeKeyId("Ctrl+Enter"), "ctrl+enter");
  assert.equal(normalizeKeyId("cmd+K"), "super+k");
  assert.equal(normalizeKeyId("meta+K"), "super+k");
  assert.deepEqual(parseKeyId("ctrl++"), { modifiers: ["ctrl"], base: "+" });
  // A base key pi knows and this module does not still parses: the file may
  // name a key the browser mapping never produces, and it must compare as written.
  assert.deepEqual(parseKeyId("ctrl+f13"), { modifiers: ["ctrl"], base: "f13" });
  // A modifier that is not one of pi's four does not parse.
  assert.equal(parseKeyId("hyper+k"), null);
  assert.deepEqual(bindingKeys(["alt+enter", 7, "ctrl+enter"]), ["alt+enter", "ctrl+enter"]);
});

test("a binding reads the file's keys, its default, or nothing when turned off", () => {
  // Absent from the file: pi's default (Pi Web's own for a new session).
  assert.deepEqual(bindingKeysFor({}, WEB_KEYBINDINGS.followUp), ["alt+enter"]);
  assert.deepEqual(bindingKeysFor({}, WEB_KEYBINDINGS.newSession), ["ctrl+alt+n"]);
  // Named by the file: the user's keys win.
  assert.deepEqual(
    bindingKeysFor({ "app.message.followUp": ["alt+enter", "ctrl+enter"] }, WEB_KEYBINDINGS.followUp),
    ["alt+enter", "ctrl+enter"],
  );
  assert.deepEqual(
    bindingKeysFor({ "app.session.new": "ctrl+n" }, WEB_KEYBINDINGS.newSession),
    ["ctrl+n"],
  );
  // Turned off: the app offers no key, rather than falling back to a default.
  assert.deepEqual(bindingKeysFor({ "app.message.followUp": [] }, WEB_KEYBINDINGS.followUp), []);
  assert.deepEqual(bindingKeysFor({ "app.message.followUp": "none" }, WEB_KEYBINDINGS.followUp), []);
});

test("only key ids and lists of them survive reading the file", () => {
  assert.deepEqual(
    sanitizeKeybindingsConfig({
      "app.session.new": "ctrl+n",
      "app.message.followUp": ["alt+enter", 7, "ctrl+enter"],
      "app.message.dequeue": { key: "alt+q" },
      "app.other": [],
    }),
    {
      "app.session.new": "ctrl+n",
      "app.message.followUp": ["alt+enter", "ctrl+enter"],
    },
  );
  assert.deepEqual(sanitizeKeybindingsConfig(null), {});
  assert.deepEqual(sanitizeKeybindingsConfig(["ctrl+n"]), {});
});
