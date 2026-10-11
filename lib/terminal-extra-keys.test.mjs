import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  applyTerminalModifiers,
  NO_TERMINAL_MODIFIERS,
  terminalExtraKeySequence,
} = await jiti.import("./terminal-extra-keys.ts");

const ctrl = { ctrl: true, alt: false };
const alt = { ctrl: false, alt: true };
const both = { ctrl: true, alt: true };

test("cursor keys follow xterm's normal and application cursor modes", () => {
  assert.equal(terminalExtraKeySequence("ArrowUp", NO_TERMINAL_MODIFIERS, false), "\x1b[A");
  assert.equal(terminalExtraKeySequence("ArrowLeft", NO_TERMINAL_MODIFIERS, false), "\x1b[D");
  assert.equal(terminalExtraKeySequence("Home", NO_TERMINAL_MODIFIERS, false), "\x1b[H");
  assert.equal(terminalExtraKeySequence("ArrowDown", NO_TERMINAL_MODIFIERS, true), "\x1bOB");
  assert.equal(terminalExtraKeySequence("End", NO_TERMINAL_MODIFIERS, true), "\x1bOF");
});

test("modified cursor and page keys carry xterm's modifier parameter", () => {
  assert.equal(terminalExtraKeySequence("ArrowRight", ctrl, true), "\x1b[1;5C");
  assert.equal(terminalExtraKeySequence("ArrowUp", alt, false), "\x1b[1;3A");
  assert.equal(terminalExtraKeySequence("Home", both, false), "\x1b[1;7H");
  assert.equal(terminalExtraKeySequence("PageUp", NO_TERMINAL_MODIFIERS, false), "\x1b[5~");
  assert.equal(terminalExtraKeySequence("PageDown", ctrl, false), "\x1b[6;5~");
});

test("Escape, Tab and the character keys take ALT as an ESC prefix", () => {
  assert.equal(terminalExtraKeySequence("Escape", NO_TERMINAL_MODIFIERS, false), "\x1b");
  assert.equal(terminalExtraKeySequence("Escape", alt, false), "\x1b\x1b");
  assert.equal(terminalExtraKeySequence("Tab", NO_TERMINAL_MODIFIERS, false), "\t");
  assert.equal(terminalExtraKeySequence("Tab", alt, false), "\x1b\t");
  assert.equal(terminalExtraKeySequence("/", NO_TERMINAL_MODIFIERS, false), "/");
  assert.equal(terminalExtraKeySequence("-", alt, false), "\x1b-");
  assert.equal(terminalExtraKeySequence("/", ctrl, false), "\x1f");
});

test("a one-shot modifier changes one typed character only", () => {
  assert.equal(applyTerminalModifiers("c", ctrl), "\x03");
  assert.equal(applyTerminalModifiers("C", ctrl), "\x03");
  assert.equal(applyTerminalModifiers("[", ctrl), "\x1b");
  assert.equal(applyTerminalModifiers(" ", ctrl), "\x00");
  assert.equal(applyTerminalModifiers("x", alt), "\x1bx");
  assert.equal(applyTerminalModifiers("x", both), "\x1b\x18");
  assert.equal(applyTerminalModifiers("ab", ctrl), "ab");
  assert.equal(applyTerminalModifiers("é", alt), "\x1bé");
  assert.equal(applyTerminalModifiers("c", NO_TERMINAL_MODIFIERS), "c");
});
