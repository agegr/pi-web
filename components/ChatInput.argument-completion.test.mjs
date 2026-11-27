import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { getArgumentCompletionTarget, argumentCompletionSnapshotKey, argumentCompletionIsSuppressed, argumentCompletionOwnsEscape, ownsArgumentCompletionRequest, replaceArgumentCompletion } = await jiti.import("./ChatInput.tsx");

test("argument completion targets all argument text before the caret and preserves its suffix", () => {
  const value = "/deploy staging --dry-run now";
  const caret = "/deploy staging --dry".length;
  const target = getArgumentCompletionTarget(value, caret);
  assert.deepEqual(target, {
    commandName: "deploy",
    prefix: "staging --dry",
    start: 8,
    end: caret,
  });
  assert.equal(value.slice(0, target.start) + "production --confirm" + value.slice(target.end), "/deploy production --confirm-run now");
});

test("argument parsing mirrors pi's first ASCII-space split and accepts arbitrary registered names", () => {
  assert.deepEqual(getArgumentCompletionTarget("/deploy  sta", 12), {
    commandName: "deploy",
    prefix: " sta",
    start: 8,
    end: 12,
  });
  assert.deepEqual(getArgumentCompletionTarget("/déploy.prod value", 18), {
    commandName: "déploy.prod",
    prefix: "value",
    start: 13,
    end: 18,
  });
});

test("native input during acceptance runs before the accepted snapshot is suppressed", () => {
  const previousDocument = globalThis.document;
  let value = "/deploy sta";
  let selectionStart = value.length;
  let selectionEnd = value.length;
  let suppressedSnapshot = null;
  let inputEvents = 0;
  const listeners = new Set();
  const textarea = {
    get value() { return value; },
    get selectionStart() { return selectionStart; },
    get selectionEnd() { return selectionEnd; },
    focus() {},
    setSelectionRange(start, end) { selectionStart = start; selectionEnd = end; },
    setRangeText(text, start, end) {
      value = value.slice(0, start) + text + value.slice(end);
      selectionStart = selectionEnd = start + text.length;
    },
    dispatchEvent(event) {
      if (event.type === "input") for (const listener of listeners) listener();
      return true;
    },
    addEventListener(_type, listener) { listeners.add(listener); },
  };
  globalThis.document = { execCommand: () => false };
  textarea.addEventListener("input", () => {
    inputEvents += 1;
    suppressedSnapshot = null;
  });
  try {
    const target = getArgumentCompletionTarget(value, selectionStart);
    replaceArgumentCompletion(textarea, target, "staging", "session-a", (snapshot) => {
      suppressedSnapshot = snapshot;
    });
    assert.equal(inputEvents, 1);
    assert.equal(value, "/deploy staging");
    assert.equal(suppressedSnapshot, argumentCompletionSnapshotKey(value, selectionStart, selectionEnd, "session-a"));
    assert.equal(argumentCompletionIsSuppressed(suppressedSnapshot, suppressedSnapshot), true);
  } finally {
    globalThis.document = previousDocument;
  }
});

test("completion snapshots become stale when caret, selection or composer session changes", () => {
  const original = argumentCompletionSnapshotKey("/deploy sta", 11, 11, "session-a");
  assert.notEqual(argumentCompletionSnapshotKey("/deploy sta", 10, 10, "session-a"), original);
  assert.notEqual(argumentCompletionSnapshotKey("/deploy sta", 10, 11, "session-a"), original);
  assert.notEqual(argumentCompletionSnapshotKey("/deploy sta", 11, 11, "session-b"), original);
});

test("Escape is owned only by visible results or an unsuppressed pending request", () => {
  assert.equal(argumentCompletionOwnsEscape({ visibleResults: true, pendingRequest: false, snapshot: "current", suppressedSnapshot: null }), true);
  assert.equal(argumentCompletionOwnsEscape({ visibleResults: false, pendingRequest: true, snapshot: "current", suppressedSnapshot: null }), true);
  assert.equal(argumentCompletionOwnsEscape({ visibleResults: false, pendingRequest: true, snapshot: "current", suppressedSnapshot: "current" }), false);
  assert.equal(argumentCompletionOwnsEscape({ visibleResults: false, pendingRequest: false, snapshot: "current", suppressedSnapshot: null }), false);
  assert.equal(argumentCompletionOwnsEscape({ visibleResults: false, pendingRequest: false, snapshot: null, suppressedSnapshot: null }), false);
});

test("a late completion A cannot clear request B's Escape-cancellable pending marker", async () => {
  let settleA;
  let settleB;
  const completionA = new Promise((resolve) => { settleA = resolve; });
  const completionB = new Promise((resolve) => { settleB = resolve; });
  const controllerA = new AbortController();
  const controllerB = new AbortController();
  let currentRequestId = 1;
  let currentController = controllerA;
  let pendingSnapshot = "A";
  const finish = (id, controller) => {
    if (!ownsArgumentCompletionRequest(id, currentRequestId, controller, currentController)) return;
    pendingSnapshot = null;
    currentController = null;
  };
  const responseA = completionA.then(() => finish(1, controllerA));
  currentRequestId = 2;
  currentController = controllerB;
  pendingSnapshot = "B";
  const responseB = completionB.then(() => finish(2, controllerB));

  settleA(null);
  await responseA;
  assert.equal(pendingSnapshot, "B");
  assert.equal(argumentCompletionOwnsEscape({ visibleResults: false, pendingRequest: true, snapshot: "B", suppressedSnapshot: null }), true);

  settleB(null);
  await responseB;
  assert.equal(pendingSnapshot, null);
  assert.equal(currentController, null);
});

test("argument completion accepts an empty first argument and rejects command-name queries", () => {
  assert.deepEqual(getArgumentCompletionTarget("/deploy ", 8), {
    commandName: "deploy",
    prefix: "",
    start: 8,
    end: 8,
  });
  assert.equal(getArgumentCompletionTarget("/deploy", 7), null);
});
