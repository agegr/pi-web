import assert from "node:assert/strict";
import test from "node:test";
import {
  isStructuredAskToolName,
  normalizeStructuredAskAnswer,
  parseStructuredAsk,
  parseStructuredAskResult,
  resolveStructuredAskSubmission,
  summarizeStructuredAskAnswer,
} from "./structured-ask.ts";

const baseArgs = {
  question: "Which path?",
  options: ["Path A", { title: "Path B", description: "Slower" }],
};

test("parses an ask_user call into a structured question", () => {
  const spec = parseStructuredAsk("ask_user", { ...baseArgs, context: " weigh both " }, "call-1");
  assert.deepEqual(spec, {
    toolName: "ask_user",
    toolCallId: "call-1",
    question: "Which path?",
    context: "weigh both",
    options: [{ title: "Path A" }, { title: "Path B", description: "Slower" }],
    allowMultiple: false,
    allowFreeform: true,
    allowComment: false,
  });
});

test("accepts option key aliases and drops unusable entries", () => {
  const spec = parseStructuredAsk("ask_user", {
    question: "Pick",
    options: [{ label: "Alias" }, { detail: "no title" }, 7, "Plain", "Plain"],
  });
  assert.deepEqual(spec.options, [{ title: "Alias" }, { title: "Plain" }]);
});

test("ignores unknown tools, missing questions, and option-less calls", () => {
  assert.equal(parseStructuredAsk("bash", baseArgs), null);
  assert.equal(parseStructuredAsk("ask_user", { options: ["A"] }), null);
  assert.equal(parseStructuredAsk("ask_user", { question: "Free text?" }), null);
  assert.equal(parseStructuredAsk("ask_user", "not-an-object"), null);
  assert.equal(isStructuredAskToolName("ask_user"), true);
  assert.equal(isStructuredAskToolName("read"), false);
});

test("resolves a single selection into the extension result value", () => {
  const spec = parseStructuredAsk("ask_user", baseArgs);
  const resolved = resolveStructuredAskSubmission(spec, {
    answer: { kind: "selection", selections: ["Path B"] },
  });
  assert.deepEqual(resolved, { ok: true, value: { kind: "selection", selections: ["Path B"] } });
});

test("resolves a dismissal into the extension cancel value", () => {
  const spec = parseStructuredAsk("ask_user", baseArgs);
  assert.deepEqual(resolveStructuredAskSubmission(spec, { cancelled: true }), { ok: true, value: null });
});

test("rejects submissions that do not fit the question", () => {
  const spec = parseStructuredAsk("ask_user", baseArgs);
  // Single-select has room for one answer, so a typed entry cannot ride along.
  assert.deepEqual(resolveStructuredAskSubmission(spec, { answer: { kind: "selection", selections: ["Path C"] } }), { ok: false });
  assert.deepEqual(resolveStructuredAskSubmission(spec, { answer: { kind: "selection", selections: ["Path A", "Path B"] } }), { ok: false });
  assert.deepEqual(resolveStructuredAskSubmission(spec, {}), { ok: false });
  assert.deepEqual(resolveStructuredAskSubmission(spec, null), { ok: false });
});

test("keeps multiple selections only when the question allows them", () => {
  const spec = parseStructuredAsk("ask_user", { ...baseArgs, allowMultiple: true });
  assert.deepEqual(
    normalizeStructuredAskAnswer(spec, { kind: "selection", selections: ["Path B", "Path A", "Path B"] }),
    { kind: "selection", selections: ["Path B", "Path A"] },
  );
});

test("keeps one typed entry beside checked options in a multi-select", () => {
  const spec = parseStructuredAsk("ask_user", { ...baseArgs, allowMultiple: true });
  assert.deepEqual(
    normalizeStructuredAskAnswer(spec, { kind: "selection", selections: ["Path A", "my own answer"] }),
    { kind: "selection", selections: ["Path A", "my own answer"] },
  );
  // Only one typed entry; the rest are not part of the question.
  assert.deepEqual(
    normalizeStructuredAskAnswer(spec, { kind: "selection", selections: ["mine", "also mine"] }),
    { kind: "selection", selections: ["mine"] },
  );
  const closed = parseStructuredAsk("ask_user", { ...baseArgs, allowMultiple: true, allowFreeform: false });
  assert.deepEqual(
    normalizeStructuredAskAnswer(closed, { kind: "selection", selections: ["Path A", "my own answer"] }),
    { kind: "selection", selections: ["Path A"] },
  );
});

test("drops a comment unless the question allows one", () => {
  const withComment = parseStructuredAsk("ask_user", { ...baseArgs, allowComment: true });
  assert.deepEqual(
    normalizeStructuredAskAnswer(withComment, { kind: "selection", selections: ["Path A"], comment: " later " }),
    { kind: "selection", selections: ["Path A"], comment: "later" },
  );
  const withoutComment = parseStructuredAsk("ask_user", baseArgs);
  assert.deepEqual(
    normalizeStructuredAskAnswer(withoutComment, { kind: "selection", selections: ["Path A"], comment: "later" }),
    { kind: "selection", selections: ["Path A"] },
  );
});

test("rejects freeform text when the question forbids it", () => {
  const spec = parseStructuredAsk("ask_user", { ...baseArgs, allowFreeform: false });
  assert.equal(normalizeStructuredAskAnswer(spec, { kind: "freeform", text: "other" }), null);
  const open = parseStructuredAsk("ask_user", baseArgs);
  assert.deepEqual(normalizeStructuredAskAnswer(open, { kind: "freeform", text: " other " }), { kind: "freeform", text: "other" });
  assert.equal(normalizeStructuredAskAnswer(open, { kind: "freeform", text: "   " }), null);
});

test("rebuilds a finished question from tool result details", () => {
  const record = parseStructuredAskResult("ask_user", {
    question: "Which path?",
    options: ["Path A", "Path B"],
    response: { kind: "selection", selections: ["Path A"], comment: "for now" },
    cancelled: false,
  });
  assert.deepEqual(record, {
    question: "Which path?",
    options: [{ title: "Path A" }, { title: "Path B" }],
    answer: { kind: "selection", selections: ["Path A"], comment: "for now" },
    cancelled: false,
  });
});

test("reports a cancelled question with no answer", () => {
  const record = parseStructuredAskResult("ask_user", {
    question: "Which path?",
    options: ["Path A"],
    response: null,
    cancelled: true,
  });
  assert.equal(record.answer, null);
  assert.equal(record.cancelled, true);
  assert.equal(parseStructuredAskResult("ask_user", { error: "boom" }), null);
  assert.equal(parseStructuredAskResult(undefined, {}), null);
});

test("summarizes an answer in one line", () => {
  assert.equal(summarizeStructuredAskAnswer({ kind: "freeform", text: "other" }), "other");
  assert.equal(
    summarizeStructuredAskAnswer({ kind: "selection", selections: ["A", "B"], comment: "note" }),
    "A, B - note",
  );
});
