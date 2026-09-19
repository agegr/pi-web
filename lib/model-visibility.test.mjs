import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  try {
    const { createJiti } = await import("jiti");
    return createJiti(import.meta.url).import("./model-visibility.ts");
  } catch {
    return import("./model-visibility.ts");
  }
}

const {
  computeVisibilitySave,
  hasAdvancedPatterns,
  modelRefKey,
  sanitizeEnabledPatterns,
  toEnabledPattern,
} = await loadSubject();

const MODELS = [
  { provider: "anthropic", id: "claude-opus-5" },
  { provider: "anthropic", id: "claude-sonnet-5" },
  { provider: "openai", id: "gpt-5.6" },
];

test("modelRefKey disambiguates same id across providers", () => {
  assert.equal(modelRefKey({ provider: "anthropic", id: "claude-opus-5" }), "anthropic:claude-opus-5");
  assert.notEqual(
    modelRefKey({ provider: "anthropic", id: "claude-opus-5" }),
    modelRefKey({ provider: "acme", id: "claude-opus-5" }),
  );
});

test("toEnabledPattern writes canonical provider/modelId references", () => {
  assert.equal(toEnabledPattern({ provider: "anthropic", id: "claude-opus-5" }), "anthropic/claude-opus-5");
});

test("computeVisibilitySave clears the scope when every model stays visible", () => {
  assert.deepEqual(computeVisibilitySave(MODELS, 3), { type: "clear" });
});

test("computeVisibilitySave writes exact patterns for a subset", () => {
  assert.deepEqual(computeVisibilitySave(MODELS.slice(0, 2), 3), {
    type: "patterns",
    patterns: ["anthropic/claude-opus-5", "anthropic/claude-sonnet-5"],
  });
});

test("computeVisibilitySave rejects an empty selection", () => {
  // pi falls back to showing every model when a scope matches nothing, so an
  // empty scope would do the opposite of what the user asked for.
  assert.equal(computeVisibilitySave([], 3), null);
  assert.equal(computeVisibilitySave([], 0), null);
});

test("hasAdvancedPatterns detects globs, bare ids, and thinking pins", () => {
  assert.equal(hasAdvancedPatterns(null), false);
  assert.equal(hasAdvancedPatterns([]), false);
  assert.equal(hasAdvancedPatterns(["anthropic/claude-opus-5"]), false);
  assert.equal(hasAdvancedPatterns(["anthropic/claude-opus-5", "openai/*"]), true);
  assert.equal(hasAdvancedPatterns(["claude-opus-5"]), true);
  assert.equal(hasAdvancedPatterns(["anthropic/claude-opus-5:high"]), true);
  assert.equal(hasAdvancedPatterns(["anthropic/[ck]*"]), true);
});

test("sanitizeEnabledPatterns accepts null as clearing the scope", () => {
  assert.deepEqual(sanitizeEnabledPatterns(null), { patterns: undefined });
  assert.deepEqual(sanitizeEnabledPatterns(undefined), { patterns: undefined });
});

test("sanitizeEnabledPatterns trims and validates pattern entries", () => {
  assert.deepEqual(sanitizeEnabledPatterns([" anthropic/claude-opus-5 ", "openai/gpt-5.6"]), {
    patterns: ["anthropic/claude-opus-5", "openai/gpt-5.6"],
  });
  assert.equal("error" in sanitizeEnabledPatterns("nope"), true);
  assert.equal("error" in sanitizeEnabledPatterns([]), true);
  assert.equal("error" in sanitizeEnabledPatterns([""]), true);
  assert.equal("error" in sanitizeEnabledPatterns([42]), true);
  assert.equal("error" in sanitizeEnabledPatterns(["x".repeat(513)]), true);
});
