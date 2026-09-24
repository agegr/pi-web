import assert from "node:assert/strict";
import test from "node:test";

const { matchGlobalShortcut, formatShortcutHint, formatShortcutKeys, isApplePlatform } = await import("./global-shortcuts.ts");

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

/** Windows and Linux: the primary modifier is Control. */
function options(overrides = {}) {
  return {
    hasAbortHandler: false,
    hasSessionSearchHandler: false,
    hasWorkspaceSelectorHandler: false,
    activeCwd: CWD,
    applePlatform: false,
    ...overrides,
  };
}

/** macOS and iOS: the primary modifier is Command. */
function mac(overrides = {}) {
  return options({ applePlatform: true, ...overrides });
}

test("Command starts a new session on Apple platforms and Control does not", () => {
  assert.equal(matchGlobalShortcut(key({ key: "j", metaKey: true }), mac()), "newSession");
  assert.equal(matchGlobalShortcut(key({ key: "J", metaKey: true }), mac()), "newSession");
  // Control belongs to the system's Emacs-style editing, so it stays unclaimed.
  assert.equal(matchGlobalShortcut(key({ key: "j", ctrlKey: true }), mac()), null);
  assert.equal(matchGlobalShortcut(key({ key: "j", ctrlKey: true, shiftKey: true }), mac({ hasWorkspaceSelectorHandler: true })), null);
});

test("Control starts a new session elsewhere and Command does not", () => {
  assert.equal(matchGlobalShortcut(key({ key: "j", ctrlKey: true }), options()), "newSession");
  assert.equal(matchGlobalShortcut(key({ key: "J", ctrlKey: true }), options()), "newSession");
  assert.equal(matchGlobalShortcut(key({ key: "j", metaKey: true }), options()), null);
});

test("a new session needs an active project and ignores key repeats", () => {
  assert.equal(matchGlobalShortcut(key({ key: "j", metaKey: true }), mac({ activeCwd: null })), null);
  assert.equal(matchGlobalShortcut(key({ key: "j", metaKey: true }), mac({ activeCwd: "" })), null);
  assert.equal(matchGlobalShortcut(key({ key: "j", metaKey: true, repeat: true }), mac()), null);
  assert.equal(matchGlobalShortcut(key({ key: "j", ctrlKey: true, repeat: true }), options()), null);
});

test("the primary modifier toggles the session search only when a toggle is registered", () => {
  assert.equal(matchGlobalShortcut(key({ key: "k", metaKey: true }), mac({ hasSessionSearchHandler: true })), "toggleSessionSearch");
  assert.equal(matchGlobalShortcut(key({ key: "k", ctrlKey: true }), options({ hasSessionSearchHandler: true })), "toggleSessionSearch");
  assert.equal(matchGlobalShortcut(key({ key: "k", metaKey: true }), mac()), null);
  // The platform's secondary modifier must not fire it either.
  assert.equal(matchGlobalShortcut(key({ key: "k", ctrlKey: true }), mac({ hasSessionSearchHandler: true })), null);
  assert.equal(matchGlobalShortcut(key({ key: "k", metaKey: true }), options({ hasSessionSearchHandler: true })), null);
});

test("the primary modifier plus Shift opens the workspace selector", () => {
  assert.equal(matchGlobalShortcut(key({ key: "p", metaKey: true, shiftKey: true }), mac({ hasWorkspaceSelectorHandler: true })), "openWorkspaceSelector");
  assert.equal(matchGlobalShortcut(key({ key: "P", ctrlKey: true, shiftKey: true }), options({ hasWorkspaceSelectorHandler: true })), "openWorkspaceSelector");
  // Needs no active project: the point of the selector is to pick one.
  assert.equal(
    matchGlobalShortcut(key({ key: "p", metaKey: true, shiftKey: true }), mac({ hasWorkspaceSelectorHandler: true, activeCwd: null })),
    "openWorkspaceSelector",
  );
  assert.equal(matchGlobalShortcut(key({ key: "p", metaKey: true, shiftKey: true }), mac()), null);
  assert.equal(matchGlobalShortcut(key({ key: "p", metaKey: true, shiftKey: true, repeat: true }), mac({ hasWorkspaceSelectorHandler: true })), null);
  assert.equal(matchGlobalShortcut(key({ key: "p", ctrlKey: true, shiftKey: true }), mac({ hasWorkspaceSelectorHandler: true })), null);
});

// Chrome binds Cmd+Shift+J to "Open the Downloads page" on macOS and
// Ctrl+Shift+J to the DevTools console, and a page cannot count on winning
// either. Keep the selector off that key. See
// https://support.google.com/chrome/answer/157179
test("Cmd/Ctrl+Shift+J stays unclaimed because Chrome owns it", () => {
  assert.equal(matchGlobalShortcut(key({ key: "j", metaKey: true, shiftKey: true }), mac({ hasWorkspaceSelectorHandler: true })), null);
  assert.equal(matchGlobalShortcut(key({ key: "j", ctrlKey: true, shiftKey: true }), options({ hasWorkspaceSelectorHandler: true })), null);
});

test("the plain chords require the primary modifier alone", () => {
  assert.equal(matchGlobalShortcut(key({ key: "j" }), mac()), null);
  assert.equal(matchGlobalShortcut(key({ key: "k" }), options({ hasSessionSearchHandler: true })), null);
  assert.equal(matchGlobalShortcut(key({ key: "j", metaKey: true, shiftKey: true }), mac()), null);
  assert.equal(matchGlobalShortcut(key({ key: "k", metaKey: true, altKey: true }), mac({ hasSessionSearchHandler: true })), null);
  assert.equal(matchGlobalShortcut(key({ key: "j", ctrlKey: true, altKey: true }), options()), null);
});

test("the terminal keeps Ctrl+J and Ctrl+K for readline", () => {
  const inTerminal = { closest: (selector) => (selector === ".xterm" ? {} : null) };
  assert.equal(matchGlobalShortcut(key({ key: "j", ctrlKey: true, target: inTerminal }), options()), null);
  assert.equal(matchGlobalShortcut(key({ key: "k", ctrlKey: true, target: inTerminal }), options({ hasSessionSearchHandler: true })), null);

  const outside = { closest: () => null };
  assert.equal(matchGlobalShortcut(key({ key: "j", ctrlKey: true, target: outside }), options()), "newSession");
});

test("Ctrl+Alt+N still starts a new session when a project is active", () => {
  assert.equal(matchGlobalShortcut(key({ key: "n", ctrlKey: true, altKey: true }), options()), "newSession");
  assert.equal(matchGlobalShortcut(key({ key: "n", ctrlKey: true, altKey: true }), mac()), "newSession");
  assert.equal(matchGlobalShortcut(key({ key: "n", ctrlKey: true, altKey: true }), options({ activeCwd: null })), null);
});

test("Esc aborts outside text fields and stays unclaimed inside them", () => {
  const withHandler = options({ hasAbortHandler: true });
  assert.equal(matchGlobalShortcut(key({ key: "Escape" }), withHandler), "abort");
  assert.equal(matchGlobalShortcut(key({ key: "Escape", target: { tagName: "TEXTAREA" } }), withHandler), null);
  assert.equal(matchGlobalShortcut(key({ key: "Escape", target: { tagName: "INPUT" } }), withHandler), null);
  assert.equal(matchGlobalShortcut(key({ key: "Escape" }), options()), null);
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

test("aria-keyshortcuts names the modifier the platform actually binds", () => {
  assert.equal(formatShortcutKeys("j", "MacIntel"), "Meta+J");
  assert.equal(formatShortcutKeys("j", "Win32"), "Control+J");
  assert.equal(formatShortcutKeys("p", "MacIntel", { shift: true }), "Meta+Shift+P");
  assert.equal(formatShortcutKeys("p", "Linux x86_64", { shift: true }), "Control+Shift+P");
});

test("Apple platform detection covers macOS, iOS, and iPadOS", () => {
  assert.equal(isApplePlatform("MacIntel"), true);
  assert.equal(isApplePlatform("iPhone"), true);
  assert.equal(isApplePlatform("iPad"), true);
  assert.equal(isApplePlatform("Macintosh; Intel Mac OS X 10_15_7"), true);
  assert.equal(isApplePlatform("Win32"), false);
  assert.equal(isApplePlatform("Linux x86_64"), false);
  assert.equal(isApplePlatform(""), false);
});
