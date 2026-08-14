import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");

test("keeps access on the left and reasoning beside the model", () => {
  assert.match(source, /TOOL_PRESET_LABEL_KEYS/);
  assert.match(source, /data-thinking-badge=\{thinkingLevel/);
  assert.match(source, /<Brain /);
  assert.match(source, /<Shield /);
  assert.doesNotMatch(source, /MoreHorizontal/);
});
