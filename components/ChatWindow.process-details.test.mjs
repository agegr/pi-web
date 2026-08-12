import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");

test("collapses completed process details and expands only live details", () => {
  assert.match(source, /const \[expanded, setExpanded\] = useState\(defaultExpanded\)/);
  assert.doesNotMatch(source, /<ProcessDetailsGroup[\s\S]*?\n\s+defaultExpanded(?:=|\s*\n)/);
  assert.match(source, /renderMessage\(renderIdx, \{ defaultDetailsExpanded: true \}\)/);
  assert.match(source, /<MessageView message=\{streamState\.streamingMessage as AgentMessage\} isStreaming[^>]*defaultDetailsExpanded/);
});
