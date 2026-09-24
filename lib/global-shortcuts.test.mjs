import assert from "node:assert/strict";
import test from "node:test";

const { matchGlobalShortcut, formatShortcutHint } = await import("./global-shortcuts.ts");

const CWD = "/tmp/project";

function key(overrides = {}) {
  return {
    key: "",
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    repeat: false,
    target: null,
    ...overrides,
  };
}

function options(overrides = {}) {
  return {
    hasAbortHandler: false,
    hasSessionSearchHandler: false,
    hasWorkspaceSelectorHandler: false,
    activeCwd: CWD,
    ...overrides,
  };
}

test("Cmd+J and Ctrl+J start a new session in the active project", () => {
  assert.equal(matchGlobalShortcut(key({ key: "j", metaKey: true }), options()), "newSession");
  assert.equal(matchGlobalShortcut(key({ key: "j", ctrlKey: true }), options()), "newSession");
  assert.equal(matchGlobalShortcut(key({ key: "J", metaKey: true }), options()), "newSession");
});

test("Cmd+J needs an active project and ignores key repeats", () => {
  assert.equal(matchGlobalShortcut(key({ key: "j", metaKey: true }), options({ activeCwd: null })), null);
  assert.equal(matchGlobalShortcut(key({ key: "j", metaKey: true }), options({ activeCwd: "" })), null);
  assert.equal(matchGlobalShortcut(key({ key: "j", metaKey: true, repeat: true }), options()), null);
});

test("Cmd+K toggles the session search only when a toggle is registered", () => {
  assert.equal(
    matchGlobalShortcut(key({ key: "k", metaKey: true }), options({ hasSessionSearchHandler: true })),
    "toggleSessionSearch",
  );
  assert.equal(
    matchGlobalShortcut(key({ key: "k", ctrlKey: true }), options({ hasSessionSearchHandler: true })),
    "toggleSessionSearch",
  );
  assert.equal(matchGlobalShortcut(key({ key: "k", metaKey: true }), options()), null);
});

test("Cmd/Ctrl+J and Cmd/Ctrl+K require the plain primary modifier", () => {
  assert.equal(matchGlobalShortcut(key({ key: "j" }), options()), null);
  assert.equal(matchGlobalShortcut(key({ key: "k" }), options({ hasSessionSearchHandler: true })), null);
  assert.equal(matchGlobalShortcut(key({ key: "j", metaKey: true, shiftKey: true }), options()), null);
  assert.equal(matchGlobalShortcut(key({ key: "k", metaKey: true, altKey: true }), options({ hasSessionSearchHandler: true })), null);
  assert.equal(matchGlobalShortcut(key({ key: "j", ctrlKey: true, altKey: true }), options()), null);
});

test("shortcut hints use the Apple glyph on Apple platforms and Ctrl elsewhere", () => {
  assert.equal(formatShortcutHint("k", "MacIntel"), "⌘K");
  assert.equal(formatShortcutHint("j", "iPhone"), "⌘J");
  assert.equal(formatShortcutHint("k", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"), "⌘K");
  assert.equal(formatShortcutHint("k", "Win32"), "Ctrl+K");
  assert.equal(formatShortcutHint("j", "Linux x86_64"), "Ctrl+J");
  assert.equal(formatShortcutHint("k", ""), "Ctrl+K");
  assert.equal(formatShortcutHint("j", "MacIntel", { shift: true }), "⌘⇧J");
  assert.equal(formatShortcutHint("j", "Win32", { shift: true }), "Ctrl+Shift+J");
});

test("Cmd/Ctrl+Shift+P opens the workspace selector without starting a session", () => {
  const withSelector = options({ hasWorkspaceSelectorHandler: true });
  assert.equal(matchGlobalShortcut(key({ key: "p", metaKey: true, shiftKey: true }), withSelector), "openWorkspaceSelector");
  assert.equal(matchGlobalShortcut(key({ key: "P", ctrlKey: true, shiftKey: true }), withSelector), "openWorkspaceSelector");
  // Needs no active project: the point of the selector is to pick one.
  assert.equal(
    matchGlobalShortcut(key({ key: "p", metaKey: true, shiftKey: true }), options({ hasWorkspaceSelectorHandler: true, activeCwd: null })),
    "openWorkspaceSelector",
  );
  assert.equal(matchGlobalShortcut(key({ key: "p", metaKey: true, shiftKey: true }), options()), null);
  assert.equal(
    matchGlobalShortcut(key({ key: "p", metaKey: true, shiftKey: true, repeat: true }), withSelector),
    null,
  );
});

// Chrome binds Cmd+Shift+J to "Open the Downloads page" on macOS and
// Ctrl+Shift+J to the DevTools console, and a page cannot count on winning
// either. Keep the selector off that key. See
// https://support.google.com/chrome/answer/157179
test("Cmd/Ctrl+Shift+J stays unclaimed because Chrome owns it", () => {
  const withSelector = options({ hasWorkspaceSelectorHandler: true });
  assert.equal(matchGlobalShortcut(key({ key: "j", metaKey: true, shiftKey: true }), withSelector), null);
  assert.equal(matchGlobalShortcut(key({ key: "j", ctrlKey: true, shiftKey: true }), withSelector), null);
});

test("the terminal keeps Ctrl+J and Ctrl+K for readline", () => {
  const inTerminal = { closest: (selector) => (selector === ".xterm" ? {} : null) };
  assert.equal(matchGlobalShortcut(key({ key: "j", ctrlKey: true, target: inTerminal }), options()), null);
  assert.equal(
    matchGlobalShortcut(key({ key: "k", ctrlKey: true, target: inTerminal }), options({ hasSessionSearchHandler: true })),
    null,
  );

  const outside = { closest: () => null };
  assert.equal(matchGlobalShortcut(key({ key: "j", ctrlKey: true, target: outside }), options()), "newSession");
});

test("Ctrl+Alt+N still starts a new session when a project is active", () => {
  assert.equal(matchGlobalShortcut(key({ key: "n", ctrlKey: true, altKey: true }), options()), "newSession");
  assert.equal(matchGlobalShortcut(key({ key: "n", ctrlKey: true, altKey: true }), options({ activeCwd: null })), null);
});

test("Esc aborts outside text fields and stays unclaimed inside them", () => {
  const withHandler = options({ hasAbortHandler: true });
  assert.equal(matchGlobalShortcut(key({ key: "Escape" }), withHandler), "abort");
  assert.equal(matchGlobalShortcut(key({ key: "Escape", target: { tagName: "TEXTAREA" } }), withHandler), null);
  assert.equal(matchGlobalShortcut(key({ key: "Escape", target: { tagName: "INPUT" } }), withHandler), null);
  assert.equal(matchGlobalShortcut(key({ key: "Escape" }), options()), null);
});
