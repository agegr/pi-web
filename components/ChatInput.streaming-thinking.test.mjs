import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");
const controls = source.slice(source.indexOf("{isStreaming && onThinkingLevelChange &&"));

test("shows the reasoning level of the running turn without offering a control", () => {
  const readOnly = controls.slice(0, controls.indexOf("{!isStreaming && onThinkingLevelChange &&"));
  assert.match(readOnly, /<span\s+title=\{t\("chat\.currentReasoning", \{ level: thinkingDisplayLabel \}\)\}/);
  assert.match(readOnly, /\{thinkingDisplayLabel\}<\/span>/);
  assert.doesNotMatch(readOnly, /<button|onClick=/);
});

test("keeps the read-only level aligned with the neighbouring controls", () => {
  const readOnly = controls.slice(0, controls.indexOf("{!isStreaming && onThinkingLevelChange &&"));
  const dropdown = controls.slice(controls.indexOf("{!isStreaming && onThinkingLevelChange &&"));
  const padding = /padding: isMobile \? "0 6px" : "8px 12px"/;
  const height = /height: 32/;
  for (const [label, markup] of [["read-only", readOnly], ["dropdown", dropdown]]) {
    assert.match(markup, padding, `${label} horizontal padding`);
    assert.match(markup, height, `${label} height`);
  }
  // The label collapses to the icon on mobile exactly like the editable control.
  assert.match(readOnly, /\(!isMobile \|\| controlsMenuOpen\) &&/);
});
