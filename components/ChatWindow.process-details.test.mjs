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

test("can keep process text and images visible while retaining tool details", () => {
  assert.match(source, /getProcessContentBlocks\(message, toolResultsMap\)/);
  assert.match(source, /block\.type !== "text" && block\.type !== "image"/);
  assert.match(source, /hideResultImages: showProcessContent/);
});
