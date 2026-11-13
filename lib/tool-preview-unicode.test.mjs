import assert from "node:assert/strict";
import test from "node:test";
import { toolInputPreview } from "./tool-fields.ts";

test("collapsed tool previews never cut an emoji into an unpaired surrogate", () => {
  const text = "x".repeat(119) + "🔎tail";
  for (const input of [{ command: text }, { query: text }, { questions: [{ question: text }] }]) {
    const preview = toolInputPreview(input);
    assert.equal(preview, "x".repeat(119));
    assert.equal(preview.isWellFormed(), true);
  }
  assert.equal(toolInputPreview({ path: "x".repeat(118) + "🔎tail" }), "x".repeat(118) + "🔎");
});
