import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { MODEL_THINKING_LEVELS } from "@earendil-works/pi-ai/providers/model-schema";

const { THINKING_LEVELS, isThinkingLevel } = await createJiti(import.meta.url).import("./thinking-levels.ts");

test("the reasoning levels are pi's", () => {
  assert.deepEqual([...THINKING_LEVELS], [...MODEL_THINKING_LEVELS]);
});

test("isThinkingLevel accepts pi's levels only", () => {
  for (const level of MODEL_THINKING_LEVELS) assert.equal(isThinkingLevel(level), true);
  assert.equal(isThinkingLevel("auto"), false);
  assert.equal(isThinkingLevel(undefined), false);
});
