import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");

test("expands process details when a completed turn has no final answer", () => {
  assert.match(source, /const \[expanded, setExpanded\] = useState\(defaultExpanded\)/);
  assert.match(
    source,
    /<ProcessDetailsGroup[\s\S]*?defaultExpanded=\{!finalAnswerMessage\}/,
  );
});

test("lifts turn tool-result images out of collapsed process details", () => {
  assert.match(source, /collectTurnToolResultImages\(messages, userIdx \+ 1, finalAssistantIdx, toolResultsMap\)/);
  assert.match(source, /hideResultImages: turnToolImages\.length > 0/);
  assert.match(source, /<ResultImages images=\{turnToolImages\} isError=\{false\} \/>/);
});
