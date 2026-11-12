import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = ts.createSourceFile("ChatInput.tsx", readFileSync(new URL("./ChatInput.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let command;
let focusEffect;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === "runBuiltinCommand") {
    command = node.initializer.arguments[0];
  }
  if (ts.isCallExpression(node) && node.expression.getText(source) === "useLayoutEffect"
    && node.arguments[1]?.getText(source) === "[builtinCommandPending]") {
    focusEffect = node.arguments[0];
  }
  ts.forEachChild(node, visit);
}
visit(source);
function compile(node) {
  const js = ts.transpileModule(`(${node.getText(source)})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function("scope", `with (scope) { return ${js} }`);
}
const makeCommand = compile(command);
const makeEffect = focusEffect ? compile(focusEffect) : () => () => {};

function composer({ focused = true } = {}) {
  const body = {};
  const other = {};
  const listeners = new Map();
  const document = {
    body, activeElement: body, querySelector: () => null,
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type) => listeners.delete(type),
  };
  let disabled = false;
  let resolve;
  let reject;
  let focusCount = 0;
  const textarea = {
    isConnected: true,
    focus(options) {
      assert.equal(disabled, false, "focus must wait for the fieldset's enabling commit");
      assert.deepEqual(options, { preventScroll: true });
      document.activeElement = textarea;
      focusCount++;
    },
  };
  document.activeElement = focused ? textarea : other;
  const scope = {
    document,
    attachedImages: [], attachedImagesRef: { current: [] },
    textareaRef: { current: textarea },
    builtinCommandPending: false,
    builtinCommandPendingRef: { current: false },
    builtinCommandFocusRef: { current: null },
    valueRef: { current: "/compact" },
    canClearBuiltinCommandInput: (value, count, submitted) => value === submitted && count === 0,
    clearInput() { scope.valueRef.current = ""; },
    onBuiltinCommand: () => new Promise((done, fail) => { resolve = done; reject = fail; }),
    setBuiltinCommandPending(value) { scope.builtinCommandPending = value; },
  };
  const effect = makeEffect(scope);
  // The browser blurs a focused descendant when React commits disabled=true.
  let cleanup;
  function commit() {
    cleanup?.();
    disabled = scope.builtinCommandPending;
    if (disabled && document.activeElement === textarea) document.activeElement = body;
    cleanup = effect();
  }
  return {
    pointerDown: (target) => listeners.get("pointerdown")?.({ target }),
    scope, document, textarea, other, commit,
    run: makeCommand(scope),
    finish: (result = { handled: true }) => resolve(result),
    fail: (error) => reject(error),
    focusCount: () => focusCount,
  };
}

for (const [name, result] of [
  ["/compact", { handled: true, action: "compact" }],
  ["a refused command", { handled: true, error: "No active session" }],
  ["an extension command falling through", { handled: false }],
]) {
  test(`${name} restores the composer's lost focus after unlocking`, async () => {
    const c = composer();
    const pending = c.run("/compact");
    c.commit();
    assert.equal(c.document.activeElement, c.document.body);
    assert.equal(c.focusCount(), 0);
    c.finish(result);
    await pending;
    assert.equal(c.focusCount(), 0, "the async finally runs before React enables the fieldset");
    c.commit();
    assert.equal(c.document.activeElement, c.textarea);
    assert.equal(c.scope.valueRef.current, result.handled && !result.error ? "" : "/compact");
    c.document.activeElement = c.document.body;
    c.commit();
    assert.equal(c.focusCount(), 1, "the focus request is consumed once");
  });
}

test("a throwing command unlocks and restores focus too", async () => {
  const c = composer();
  const pending = c.run("/compact");
  c.commit();
  c.fail(new Error("failed"));
  await assert.rejects(pending, /failed/);
  c.commit();
  assert.equal(c.document.activeElement, c.textarea);
});

for (const scenario of ["other control", "outside text", "modal", "unmounted", "already focused", "not initially focused"]) {
  test(`command completion does not steal focus: ${scenario}`, async () => {
    const c = composer({ focused: scenario !== "not initially focused" });
    const pending = c.run("/compact");
    c.commit();
    if (scenario === "other control") c.document.activeElement = c.other;
    if (scenario === "outside text") c.pointerDown(c.document.body);
    if (scenario === "modal") c.document.querySelector = () => ({});
    if (scenario === "unmounted") c.textarea.isConnected = false;
    if (scenario === "already focused") c.document.activeElement = c.textarea;
    // Even if a clicked Send button lost focus, do not invent a textarea focus request.
    if (scenario === "not initially focused") c.document.activeElement = c.document.body;
    const active = c.document.activeElement;
    c.finish();
    await pending;
    c.commit();
    assert.equal(c.document.activeElement, active);
    assert.equal(c.focusCount(), 0);
  });
}
