import assert from "node:assert/strict";
import test from "node:test";
import { toTerminalKeyData } from "./terminal-input.ts";
import { applyTerminalModifiers } from "./terminal-extra-keys.ts";
import { parseKey } from "@earendil-works/pi-tui";

test("custom panels receive the same control characters as terminal extra keys", () => {
  for (const key of [" ", "/", "-"]) {
    const sequence = toTerminalKeyData({ key, ctrlKey: true, altKey: false, metaKey: false, shiftKey: false });
    assert.equal(sequence, applyTerminalModifiers(key, { ctrl: true, alt: false }));
    assert.equal(typeof sequence, "string");
  }
  assert.equal(parseKey(toTerminalKeyData({ key: " ", ctrlKey: true, altKey: false, metaKey: false, shiftKey: false })), "ctrl+space");
});
