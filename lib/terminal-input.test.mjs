import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./terminal-input.ts");
}

function key(keyValue, modifiers = {}) {
  return {
    key: keyValue,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...modifiers,
  };
}

test("maps navigation and editing keys to terminal sequences", async () => {
  const { toTerminalKeyData } = await loadSubject();

  assert.equal(toTerminalKeyData(key("ArrowDown")), "\x1b[B");
  assert.equal(toTerminalKeyData(key("Home")), "\x1b[H");
  assert.equal(toTerminalKeyData(key("Delete")), "\x1b[3~");
  assert.equal(toTerminalKeyData(key("Tab", { shiftKey: true })), "\x1b[Z");
  assert.equal(toTerminalKeyData(key("Enter", { shiftKey: true })), "\n");
});

test("maps legacy control and alt keys used by pi-tui", async () => {
  const { toTerminalKeyData } = await loadSubject();

  assert.equal(toTerminalKeyData(key("c", { ctrlKey: true })), "\x03");
  assert.equal(toTerminalKeyData(key("]", { ctrlKey: true })), "\x1d");
  assert.equal(toTerminalKeyData(key("ArrowLeft", { altKey: true })), "\x1bb");
  assert.equal(toTerminalKeyData(key("x", { altKey: true })), "\x1bx");
  assert.equal(toTerminalKeyData(key("v", { ctrlKey: true })), null);
  assert.equal(toTerminalKeyData(key("x", { metaKey: true })), null);
});

test("leaves printable text to the text input and wraps pasted text", async () => {
  const { asBracketedPaste, toTerminalKeyData } = await loadSubject();

  assert.equal(toTerminalKeyData(key("a")), null);
  assert.equal(toTerminalKeyData(key(" ")), null);
  assert.equal(asBracketedPaste("first\nsecond"), "\x1b[200~first\nsecond\x1b[201~");
});

test("a paste marker inside pasted text cannot cut the paste short", async () => {
  const { asBracketedPaste } = await loadSubject();
  const { Input } = await import("@earendil-works/pi-tui");

  for (const text of [
    "name\x1b[201~tail",
    // Removing the inner marker joins the text around it into another one.
    "name\x1b[20\x1b[201~1~tail",
    "name\x1b[200~tail",
  ]) {
    const input = new Input();
    input.handleInput(asBracketedPaste(text));
    assert.equal(input.getValue(), "nametail", JSON.stringify(text));
  }
  assert.equal(asBracketedPaste("a\x1b[201~b"), "\x1b[200~ab\x1b[201~");
});

test("modified navigation reaches pi-tui without losing modifiers", async () => {
  const { toTerminalKeyData } = await loadSubject();
  const { parseKey } = await import("@earendil-works/pi-tui");
  for (const [name, modifiers, expected] of [
    ["ArrowLeft", { ctrlKey: true }, "ctrl+left"],
    ["ArrowRight", { shiftKey: true }, "shift+right"],
    ["ArrowUp", { ctrlKey: true, shiftKey: true }, "shift+ctrl+up"],
    ["Home", { ctrlKey: true }, "ctrl+home"],
    ["End", { shiftKey: true }, "shift+end"],
    ["Delete", { ctrlKey: true }, "ctrl+delete"],
    ["PageDown", { altKey: true }, "alt+pageDown"],
  ]) assert.equal(parseKey(toTerminalKeyData(key(name, modifiers))), expected);
});
