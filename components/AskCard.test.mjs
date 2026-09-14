import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const askCard = await readFile(new URL("./AskCard.tsx", import.meta.url), "utf8");
const answerCard = await readFile(new URL("./AskAnswerCard.tsx", import.meta.url), "utf8");
const chatWindow = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const messageView = await readFile(new URL("./MessageView.tsx", import.meta.url), "utf8");

test("renders a structured question as pointer-first controls", () => {
  // Options and the freeform entry are real controls, not terminal text.
  assert.match(askCard, /ask\.options\.map/);
  assert.match(askCard, /data-ask-option/);
  assert.match(askCard, /minHeight: ROW_MIN_HEIGHT/);
  assert.equal(/AnsiText/.test(askCard), false);
  assert.match(askCard, /const ROW_MIN_HEIGHT = 48/);
});

test("submits a single choice immediately and a multi choice from the footer", () => {
  assert.match(askCard, /if \(!ask\.allowComment\) submit\(\{ kind: "selection", selections: \[title\] \}\)/);
  assert.match(askCard, /current\.includes\(title\) \? current\.filter\(/);
  assert.match(askCard, /chat\.askSubmitCount/);
});

test("a typed answer and checked options coexist in a multi-select", () => {
  assert.match(askCard, /ask\.allowMultiple && freeformText\s*\?\s*\[\.\.\.selected, freeformText\]/);
  assert.match(askCard, /if \(!ask\.allowMultiple && event\.target\.value\.trim\(\)\) setSelected\(\[\]\)/);
  assert.match(askCard, /askSubmitCount", \{ count: answer\.selections\.length \}/);
});

test("offers freeform text and an optional comment only when allowed", () => {
  assert.match(askCard, /ask\.allowFreeform && \(/);
  assert.match(askCard, /ask\.allowComment && answer !== null && \(/);
});

test("minimizes instead of dismissing, so the conversation stays readable", () => {
  assert.match(askCard, /const \[minimized, setMinimized\] = useState\(false\)/);
  assert.match(askCard, /onClick=\{\(\) => setMinimized\(true\)\}[\s\S]*?chat\.askMinimize/);
  assert.match(askCard, /minimized \? \([\s\S]*?setMinimized\(false\)[\s\S]*?chat\.askExpand/);
  // Only Skip cancels the question.
  assert.equal((askCard.match(/onClick=\{onCancel\}/g) ?? []).length, 1);
  assert.match(askCard, /onClick=\{onCancel\}[\s\S]*?chat\.askSkip/);
});

test("keeps keyboard support as a second layer", () => {
  assert.match(askCard, /event\.key === "Escape"[\s\S]*?setMinimized\(true\)/);
  assert.match(askCard, /\/\^\[1-9\]\$\/\.test\(event\.key\)/);
  assert.match(askCard, /ArrowDown/);
});

test("chat window prefers the native card and keeps the terminal escape hatch", () => {
  assert.match(chatWindow, /extensionCustomUi\.ask && extensionCustomUi\.id !== rawCustomUiId[\s\S]*?<AskCard/);
  assert.match(chatWindow, /\(!extensionCustomUi\.ask \|\| extensionCustomUi\.id === rawCustomUiId\)[\s\S]*?<ExtensionCustomPanel/);
  assert.match(chatWindow, /respondToExtensionAsk\(extensionCustomUi, \{ cancelled: true \}\)/);
  assert.match(chatWindow, /onShowRaw=\{\(\) => setRawCustomUiId\(extensionCustomUi\.id\)\}/);
});


test("transcript shows a decision card for asked questions", () => {
  assert.match(messageView, /parseStructuredAskResult\(block\.toolName, result\?\.details\)/);
  assert.match(messageView, /if \(askRecord\) return <AskAnswerCard record=\{askRecord\} \/>/);
  assert.match(messageView, /pendingAsk[\s\S]*?<AskAnswerCard\s+pending/);
  assert.match(answerCard, /chat\.askAnswered/);
  assert.match(answerCard, /chat\.askCancelled/);
});
