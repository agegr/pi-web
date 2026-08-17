import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

test("renders a Codex-style new-session home", () => {
  assert.match(source, /chat\.homeTitle/);
  assert.match(source, /className="new-session-home/);
  assert.match(source, /onDismiss=\{dismissNotice\}/);
  assert.match(source, /insertIfEmpty\(`\/skill:\$\{skill\}/);
  assert.match(source, /chat\.homeSkill/);
  assert.doesNotMatch(source, /handleSend\(`\/skill:\$\{skill\}/);
  assert.match(source, /skill: "requesting-code-review"/);
  assert.match(source, /chat\.homeExplore/);
  assert.match(source, /workspaceHint=\{isEmptyNew \? homeCwdLabel : null\}/);
  assert.doesNotMatch(source, /maxWidth: 820/);
  assert.doesNotMatch(source, /margin: "0 auto -14px"/);
});

test("process details use a compact result row and stay collapsed", () => {
  assert.match(source, /className="chat-process-summary"/);
  assert.match(source, /defaultExpanded = false/);
  assert.match(source, /chat\.processCompleted/);
  assert.match(source, /chat\.processErrors/);
  assert.doesNotMatch(source, /chat\.processRunning/);
});

test("notice shelf animation does not lock toast height", () => {
  const start = css.indexOf("@keyframes notice-shelf-in");
  const end = css.indexOf("@keyframes notice-shelf-out");
  assert.ok(start >= 0 && end > start);
  const block = css.slice(start, end);
  assert.doesNotMatch(block, /height:\s*60px/);
  assert.doesNotMatch(block, /max-height:\s*60px/);
});
