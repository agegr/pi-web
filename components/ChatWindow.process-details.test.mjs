import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");

test("expands process details by default", () => {
  assert.match(source, /const \[expanded, setExpanded\] = useState\(defaultExpanded\)/);
  assert.match(source, /^\s+defaultExpanded\s*$/m);
  assert.doesNotMatch(source, /defaultExpanded=\{!finalAnswerMessage\}/);
});
