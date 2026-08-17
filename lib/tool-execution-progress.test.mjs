import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { getToolExecutionProgress } = await jiti.import("./tool-execution-progress.ts");

test("uses the latest non-empty text line from a partial tool result", () => {
  assert.equal(getToolExecutionProgress({
    content: [
      { type: "text", text: "Phase 1 complete\n" },
      { type: "image", data: "ignored" },
      { type: "text", text: "\nProcessing item 4 of 10\n" },
    ],
  }), "Processing item 4 of 10");
});

test("ignores partial tool results without displayable text", () => {
  assert.equal(getToolExecutionProgress(null), null);
  assert.equal(getToolExecutionProgress({ content: [{ type: "image" }] }), null);
  assert.equal(getToolExecutionProgress({ content: [{ type: "text", text: "  \n" }] }), null);
});

test("bounds long progress lines while preserving the latest text", () => {
  const progress = getToolExecutionProgress({
    content: [{ type: "text", text: `prefix-${"x".repeat(600)}-latest` }],
  });

  assert.equal(progress.length, 500);
  assert.match(progress, /^\.\.\./);
  assert.match(progress, /-latest$/);
});
