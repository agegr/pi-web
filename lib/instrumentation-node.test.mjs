import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../instrumentation-node.ts", import.meta.url), "utf8");

test("server startup starts the pi SDK import without waiting for it (#964)", () => {
  // Next waits for register() before answering any request, so the import must
  // run in the background; the first /api/sessions then reuses the loaded SDK.
  assert.match(source, /\n {2}import\("@earendil-works\/pi-coding-agent"\)\.catch\(\(\) => \{\}\);/);
  assert.doesNotMatch(source, /await import\("@earendil-works\//);
});
