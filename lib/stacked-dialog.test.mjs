import assert from "node:assert/strict";
import test from "node:test";
import { handleGlobalEscape, registerAbortHandler } from "../hooks/useKeyboardShortcuts.ts";
import {
  focusAfterChange,
  focusIfLost,
  focusModalPanel,
  listenForPanelEscape,
  listenForStackedDialogEscape,
  openStackedDialog,
} from "./stacked-dialog.ts";

/**
 * A node of a minimal DOM tree: listeners keyed by type, function and capture
 * flag, as `EventTarget` keys them.
 */
class FakeNode {
  constructor(name, parent = null) {
    this.name = name;
    this.parent = parent;
    this.listeners = [];
    this.isConnected = true;
    this.focused = [];
  }

  addEventListener(type, listener, capture = false) {
    const flag = Boolean(capture);
    if (this.listeners.some((entry) => entry.type === type && entry.listener === listener && entry.capture === flag)) return;
    this.listeners.push({ type, listener, capture: flag });
  }

  removeEventListener(type, listener, capture = false) {
    const flag = Boolean(capture);
    this.listeners = this.listeners.filter((entry) => !(entry.type === type && entry.listener === listener && entry.capture === flag));
  }

  focus(options) {
    this.focused.push(options);
  }

  /** Inclusive, as `Node.contains()` is. */
  contains(other) {
    for (let node = other; node; node = node.parent) if (node === this) return true;
    return false;
  }
}

/**
 * Dispatches a keydown at `target` in the DOM's order: capture listeners from
 * the window down to the target's parent, the target's own capture then
 * bubble listeners, then bubble listeners back up to the window. After a node
 * whose listener called stopPropagation(), no further node is invoked.
 */
function press(target, key, init = {}) {
  const event = {
    type: "keydown",
    key,
    target,
    isComposing: false,
    ...init,
    defaultPrevented: false,
    propagationStopped: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.propagationStopped = true; },
  };
  const path = [];
  for (let node = target; node; node = node.parent) path.unshift(node);
  const ancestors = path.slice(0, -1);
  const invoke = (node, capture) => {
    for (const entry of [...node.listeners]) {
      if (entry.type === "keydown" && entry.capture === capture) entry.listener.call(node, event);
    }
    return event.propagationStopped;
  };
  for (const node of ancestors) if (invoke(node, true)) return event;
  if (invoke(target, true) || invoke(target, false)) return event;
  for (const node of ancestors.reverse()) if (invoke(node, false)) return event;
  return event;
}

/**
 * Settings open on the page over a running agent, the real window-level Stop
 * shortcut (useGlobalKeyboardShortcuts' handleGlobalEscape) listening, and
 * nothing above them yet.
 */
function page(t, { settingsOpen = true } = {}) {
  const window = new FakeNode("window");
  const document = new FakeNode("document", window);
  const body = new FakeNode("body", document);
  const settingsButton = new FakeNode("settings button", body);
  const dialog = new FakeNode("trust dialog", body);
  const dialogButton = new FakeNode("trust dialog button", dialog);
  document.activeElement = settingsButton;
  document.body = body;
  const calls = { settingsClosed: 0, dialogClosed: 0, agentStopped: 0 };
  registerAbortHandler(() => { calls.agentStopped += 1; });
  t.after(() => registerAbortHandler(null));
  window.addEventListener("keydown", handleGlobalEscape);
  const stopSettings = settingsOpen
    ? listenForPanelEscape(document, () => { calls.settingsClosed += 1; })
    : () => {};
  return { window, document, body, settingsButton, dialog, dialogButton, calls, stopSettings };
}

test("with nothing above it, Escape closes Settings and leaves a running agent alone", (t) => {
  const { settingsButton, calls } = page(t);
  const event = press(settingsButton, "Escape");
  assert.equal(calls.settingsClosed, 1);
  assert.equal(event.defaultPrevented, true);
  // Settings marked the key handled, so the window-level shortcut does not stop the run as well.
  assert.equal(calls.agentStopped, 0);
  press(settingsButton, "Enter");
  assert.equal(calls.settingsClosed, 1, "other keys are not Settings' business");
});

test("with Settings closed, an Escape nothing handled still stops the running agent", (t) => {
  const { settingsButton, body, calls } = page(t, { settingsOpen: false });
  press(settingsButton, "Escape");
  press(body, "Escape");
  assert.deepEqual([calls.settingsClosed, calls.agentStopped], [0, 2]);
});

test("Escape handled nearer (a menu inside Settings) does not close Settings", (t) => {
  const { settingsButton, calls } = page(t);
  settingsButton.addEventListener("keydown", (event) => {
    if (event.key === "Escape") event.preventDefault();
  });
  press(settingsButton, "Escape");
  assert.equal(calls.settingsClosed, 0);
});

test("while the trust dialog is open above Settings, Escape closes only the dialog", (t) => {
  const { document, body, dialog, dialogButton, settingsButton, calls } = page(t);
  const close = openStackedDialog(document, dialog, () => { calls.dialogClosed += 1; });

  // Focus is in the dialog, on it or on one of its buttons; or nowhere in particular.
  for (const target of [dialog, dialogButton, body]) {
    const event = press(target, "Escape");
    assert.equal(event.defaultPrevented, true);
    assert.equal(event.propagationStopped, true);
  }
  assert.equal(calls.dialogClosed, 3);
  assert.equal(calls.settingsClosed, 0, "Settings stays open under the dialog");
  assert.equal(calls.agentStopped, 0, "nor does the Escape stop a running agent");

  // Other keys pass through untouched.
  const enter = press(dialogButton, "Enter");
  assert.equal(enter.propagationStopped, false);
  assert.equal(calls.dialogClosed, 3);

  // Closed: the next Escape is Settings' again.
  close();
  press(settingsButton, "Escape");
  assert.equal(calls.dialogClosed, 3);
  assert.equal(calls.settingsClosed, 1);
});

test("the order the listeners were added in does not matter: the dialog's runs in the capture phase", (t) => {
  const { document, dialogButton, calls, stopSettings } = page(t);
  stopSettings();
  const close = openStackedDialog(document, null, () => { calls.dialogClosed += 1; });
  // Settings registered after the dialog, as when Settings remounts while the dialog is open.
  const stopAgain = listenForPanelEscape(document, () => { calls.settingsClosed += 1; });
  press(dialogButton, "Escape");
  assert.deepEqual([calls.dialogClosed, calls.settingsClosed], [1, 0]);
  close();
  stopAgain();
});

test("an Escape that cancels an IME composition closes nothing, the dialog included", (t) => {
  const { document, dialogButton, calls } = page(t);
  const close = openStackedDialog(document, null, () => { calls.dialogClosed += 1; });
  const event = press(dialogButton, "Escape", { isComposing: true });
  assert.equal(event.defaultPrevented, false, "the IME keeps the key");
  assert.deepEqual([calls.dialogClosed, calls.settingsClosed, calls.agentStopped], [0, 0, 0]);
  close();
});

test("an Escape that cancels an IME composition in a Settings text box leaves Settings open", (t) => {
  const { body, calls } = page(t);
  const box = new FakeNode("paste box", body);
  box.tagName = "TEXTAREA";
  // Chrome and Firefox mark it composing; Safari sends the IME's keyCode 229 instead.
  for (const init of [{ isComposing: true }, { keyCode: 229 }]) {
    const event = press(box, "Escape", init);
    assert.equal(event.defaultPrevented, false, `the IME keeps the key: ${JSON.stringify(init)}`);
  }
  assert.deepEqual([calls.settingsClosed, calls.agentStopped], [0, 0]);
  press(box, "Escape");
  assert.equal(calls.settingsClosed, 1, "a plain Escape still closes Settings");
});

test("Safari's composition Escape (keyCode 229) closes nothing above Settings either", (t) => {
  const { document, dialogButton, calls } = page(t);
  const close = openStackedDialog(document, null, () => { calls.dialogClosed += 1; });
  const event = press(dialogButton, "Escape", { keyCode: 229 });
  assert.equal(event.defaultPrevented, false);
  assert.equal(event.propagationStopped, true, "and nothing below the dialog sees it");
  assert.deepEqual([calls.dialogClosed, calls.settingsClosed, calls.agentStopped], [0, 0, 0]);
  close();
});

test("a busy dialog can ignore Escape, which still never reaches Settings", (t) => {
  const { document, dialogButton, calls } = page(t);
  let busy = true;
  const close = openStackedDialog(document, null, () => {
    if (!busy) calls.dialogClosed += 1;
  });
  press(dialogButton, "Escape");
  assert.deepEqual([calls.dialogClosed, calls.settingsClosed], [0, 0]);
  busy = false;
  press(dialogButton, "Escape");
  assert.deepEqual([calls.dialogClosed, calls.settingsClosed], [1, 0]);
  close();
});

test("focus moves into the dialog when it opens and back to the opener when it closes", (t) => {
  const { document, dialog, settingsButton } = page(t);
  const close = openStackedDialog(document, dialog, () => {});
  assert.deepEqual(dialog.focused, [{ preventScroll: true }]);
  assert.deepEqual(settingsButton.focused, []);
  close();
  assert.deepEqual(settingsButton.focused, [{ preventScroll: true }]);
  assert.equal(document.listeners.filter((entry) => entry.capture).length, 0, "the Escape listener is gone");
});

test("an opener that left the page meanwhile is not focused again", (t) => {
  const { document, dialog, settingsButton } = page(t);
  const close = openStackedDialog(document, dialog, () => {});
  // The restricted-mode banner of a project the dialog just trusted.
  settingsButton.isConnected = false;
  close();
  assert.deepEqual(settingsButton.focused, []);

  document.activeElement = null;
  const closeWithoutOpener = openStackedDialog(document, dialog, () => {});
  assert.doesNotThrow(closeWithoutOpener);

  // Something that cannot take focus is skipped rather than called.
  document.activeElement = { isConnected: true };
  const closeUnfocusable = openStackedDialog(document, dialog, () => {});
  assert.doesNotThrow(closeUnfocusable);
});

test("listeners are registered in the phases the stacking relies on, and removed by their cleanup", () => {
  const target = new FakeNode("document");
  const stopDialog = listenForStackedDialogEscape(target, () => {});
  const stopPanel = listenForPanelEscape(target, () => {});
  assert.deepEqual(target.listeners.map((entry) => [entry.type, entry.capture]), [["keydown", true], ["keydown", false]]);
  stopDialog();
  stopPanel();
  assert.deepEqual(target.listeners, []);
});

test("focus that fell to the page goes to the given element; focus anywhere else stays", (t) => {
  const { document, body, settingsButton, dialogButton } = page(t);
  // Trust… had focus and the reload removed it: the browser puts focus on body.
  document.activeElement = body;
  assert.equal(focusIfLost(document, settingsButton), true);
  assert.deepEqual(settingsButton.focused, [{ preventScroll: true }]);
  document.activeElement = null;
  assert.equal(focusIfLost(document, settingsButton), true);
  // The user had moved on: their focus stays.
  document.activeElement = dialogButton;
  assert.equal(focusIfLost(document, settingsButton), false);
  assert.equal(settingsButton.focused.length, 2);
  // Nothing to move it to.
  document.activeElement = body;
  assert.equal(focusIfLost(document, null), false);
});

test("after a change, focus goes back to the control it was started from, or to the fallback", (t) => {
  const { document, body, settingsButton, dialogButton } = page(t);
  const control = new FakeNode("switch", body);
  // The switch was disabled while the change ran, so the browser put focus on body.
  document.activeElement = body;
  assert.equal(focusAfterChange(document, control, settingsButton), true);
  assert.deepEqual(control.focused, [{ preventScroll: true }]);
  assert.deepEqual(settingsButton.focused, []);
  // Disabled still (a server that may not be turned on again), or gone with its pane: the fallback.
  control.disabled = true;
  assert.equal(focusAfterChange(document, control, settingsButton), true);
  control.disabled = false;
  control.isConnected = false;
  assert.equal(focusAfterChange(document, control, settingsButton), true);
  assert.equal(control.focused.length, 1);
  assert.equal(settingsButton.focused.length, 2);
  // Focus the user put elsewhere meanwhile stays.
  control.isConnected = true;
  document.activeElement = dialogButton;
  assert.equal(focusAfterChange(document, control, settingsButton), false);
  // Nothing had focus when the change started (a click that focuses nothing): nothing moves.
  document.activeElement = body;
  assert.equal(focusAfterChange(document, null, settingsButton), false);
  assert.equal(settingsButton.focused.length, 2);
});

/**
 * Settings opening over the page: the composer a bare /mcp was typed in (or
 * the sidebar's Settings button) has focus, and the panel is a fresh element.
 */
function modalPage({ opener = "composer" } = {}) {
  const document = new FakeNode("document");
  const body = new FakeNode("body", document);
  const composer = Object.assign(new FakeNode("composer", body), { tagName: "TEXTAREA" });
  const settingsButton = Object.assign(new FakeNode("settings button", body), { tagName: "BUTTON" });
  const panel = new FakeNode("settings", body);
  const search = Object.assign(new FakeNode("skills search", panel), { tagName: "INPUT", type: "search" });
  document.body = body;
  document.activeElement = opener === "composer" ? composer : settingsButton;
  return { document, body, composer, settingsButton, panel, search };
}

test("a modal panel takes focus from the composer as it opens, and hands it back as it closes", () => {
  const { document, composer, panel, search } = modalPage();
  const close = focusModalPanel(document, panel);
  assert.deepEqual(panel.focused, [{ preventScroll: true }]);
  // A section focuses its search box afterwards; that is still the panel's focus.
  document.activeElement = search;
  // A layout effect's cleanup runs while the panel is still on the page, focus inside it.
  close();
  assert.deepEqual(composer.focused, [{ preventScroll: true }]);
});

test("focus that fell to the page as the panel closed goes back to the opener too", () => {
  const { document, body, settingsButton, panel } = modalPage({ opener: "button" });
  const close = focusModalPanel(document, panel);
  document.activeElement = body;
  close();
  assert.deepEqual(settingsButton.focused, [{ preventScroll: true }]);
});

test("Escape on the panel, not on the composer, closes Settings and leaves a running agent alone", (t) => {
  const { document, composer, panel } = modalPage();
  const calls = { settingsClosed: 0, agentStopped: 0 };
  // The composer stops a running agent on Escape and marks the key handled (ChatInput).
  composer.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    calls.agentStopped += 1;
  });
  registerAbortHandler(() => { calls.agentStopped += 1; });
  t.after(() => registerAbortHandler(null));
  const stopSettings = listenForPanelEscape(document, () => { calls.settingsClosed += 1; });
  t.after(stopSettings);
  // Left on the composer, the key stopped the run, and Settings saw it handled and stayed open.
  press(composer, "Escape");
  assert.deepEqual(calls, { settingsClosed: 0, agentStopped: 1 });
  const close = focusModalPanel(document, panel);
  // The key goes where focus now is.
  document.activeElement = panel;
  press(document.activeElement, "Escape");
  assert.deepEqual(calls, { settingsClosed: 1, agentStopped: 1 });
  close();
});

test("on a coarse pointer the composer is not focused again, which would raise the keyboard", () => {
  const { document, composer, panel } = modalPage();
  const close = focusModalPanel(document, panel, { restoreTextEntry: false });
  assert.deepEqual(panel.focused, [{ preventScroll: true }]);
  document.activeElement = panel;
  close();
  assert.deepEqual(composer.focused, []);
  // A button opener still gets focus back there.
  const page = modalPage({ opener: "button" });
  const closeButton = focusModalPanel(page.document, page.panel, { restoreTextEntry: false });
  page.document.activeElement = page.panel;
  closeButton();
  assert.deepEqual(page.settingsButton.focused, [{ preventScroll: true }]);
});

test("focus already inside the panel stays, and focus the user moved elsewhere is not taken back", () => {
  const { document, composer, panel, search } = modalPage();
  // An autoFocus field inside the panel focused itself first: nothing moves, and the opener is unknown.
  document.activeElement = search;
  const closeInside = focusModalPanel(document, panel);
  assert.deepEqual(panel.focused, []);
  closeInside();
  assert.deepEqual(search.focused, []);

  // Another dialog took focus as Settings closed: it keeps it.
  document.activeElement = composer;
  const close = focusModalPanel(document, panel);
  const other = new FakeNode("other dialog", document.body);
  document.activeElement = other;
  close();
  assert.deepEqual(composer.focused, []);

  // The opener left the page meanwhile, or nothing had focus: nothing to give back.
  document.activeElement = composer;
  const closeGone = focusModalPanel(document, panel);
  composer.isConnected = false;
  document.activeElement = document.body;
  closeGone();
  assert.deepEqual(composer.focused, []);
  const closeNone = focusModalPanel(document, panel);
  assert.doesNotThrow(closeNone);
  assert.doesNotThrow(focusModalPanel(document, null));
});
