import assert from "node:assert/strict";
import test from "node:test";

import {
  formatModelRoleSelector,
  getModelRoleThinkingLevel,
  getModelRoleThinkingOptions,
} from "./model-role-selection.ts";

test("role thinking options mirror omp's strip", () => {
  assert.deepEqual(getModelRoleThinkingOptions(["low", "high"]), [
    "inherit",
    "off",
    "auto",
    "low",
    "high",
  ]);
  assert.deepEqual(getModelRoleThinkingOptions(), [
    "inherit",
    "off",
    "auto",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
  ]);
});

test("role thinking suffixes round-trip without changing the model", () => {
  assert.equal(getModelRoleThinkingLevel("anthropic/claude:high"), "high");
  assert.equal(getModelRoleThinkingLevel("anthropic/claude"), "inherit");
  assert.equal(getModelRoleThinkingLevel("openrouter/vendor/model:free"), "inherit");
  assert.equal(formatModelRoleSelector("anthropic/claude", "off"), "anthropic/claude:off");
  assert.equal(formatModelRoleSelector("anthropic/claude:high", "inherit"), "anthropic/claude");
  assert.equal(formatModelRoleSelector("anthropic/claude:high", "xhigh"), "anthropic/claude:xhigh");
});
