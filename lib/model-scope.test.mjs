import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  try {
    const { createJiti } = await import("jiti");
    return createJiti(import.meta.url).import("./model-scope.ts");
  } catch {
    return import("./model-scope.ts");
  }
}

const { resolveVisibleModels } = await loadSubject();

const MODELS = [
  { id: "claude-opus-5", provider: "anthropic", name: "Claude Opus 5" },
  { id: "claude-sonnet-5", provider: "anthropic", name: "Claude Sonnet 5" },
  { id: "claude-sonnet-4-6", provider: "anthropic", name: "Claude Sonnet 4.6" },
  { id: "claude-opus-4-8", provider: "acme-gateway", name: "Claude Opus 4.8 (Acme)" },
  { id: "claude-sonnet-5", provider: "acme-gateway", name: "Claude Sonnet 5 (Acme)" },
  { id: "gpt-5.6-sol", provider: "acme-gateway-openai", name: "GPT-5.6 (Acme)" },
];

const runtime = { getAvailable: async () => MODELS };

const refs = (result) => result.visible.map((m) => `${m.provider}/${m.id}`);

test("returns every available model when no patterns are configured", async () => {
  for (const patterns of [undefined, [], ["", "   "]]) {
    const result = await resolveVisibleModels(runtime, patterns);
    assert.deepEqual(refs(result), MODELS.map((m) => `${m.provider}/${m.id}`));
    assert.deepEqual(result.warnings, []);
  }
});

test("expands provider globs alongside exact references (#307)", async () => {
  const result = await resolveVisibleModels(runtime, [
    "anthropic/claude-sonnet-5",
    "anthropic/claude-opus-5",
    "acme-gateway/*",
    "acme-gateway-openai/*",
  ]);

  assert.deepEqual(refs(result).sort(), [
    "acme-gateway-openai/gpt-5.6-sol",
    "acme-gateway/claude-opus-4-8",
    "acme-gateway/claude-sonnet-5",
    "anthropic/claude-opus-5",
    "anthropic/claude-sonnet-5",
  ]);
  assert.deepEqual(result.warnings, []);
});

test("matches bare model id globs across providers without duplicates", async () => {
  const result = await resolveVisibleModels(runtime, ["*sonnet*"]);

  assert.deepEqual(refs(result).sort(), [
    "acme-gateway/claude-sonnet-5",
    "anthropic/claude-sonnet-4-6",
    "anthropic/claude-sonnet-5",
  ]);
});

test("keeps thinking-level suffixes out of the matched reference and reports them as pins", async () => {
  const pinned = await resolveVisibleModels(runtime, ["anthropic/*:high"]);
  assert.deepEqual(refs(pinned).sort(), [
    "anthropic/claude-opus-5",
    "anthropic/claude-sonnet-4-6",
    "anthropic/claude-sonnet-5",
  ]);
  assert.deepEqual(pinned.thinkingLevelPins, {
    "anthropic/claude-opus-5": "high",
    "anthropic/claude-sonnet-5": "high",
    "anthropic/claude-sonnet-4-6": "high",
  });

  const single = await resolveVisibleModels(runtime, ["acme-gateway/claude-opus-4-8:low"]);
  assert.deepEqual(refs(single), ["acme-gateway/claude-opus-4-8"]);
  assert.deepEqual(single.thinkingLevelPins, { "acme-gateway/claude-opus-4-8": "low" });
});

test("leaves models without a pinned thinking level unpinned", async () => {
  const result = await resolveVisibleModels(runtime, ["anthropic/claude-opus-5:high", "acme-gateway/*"]);

  assert.deepEqual(result.thinkingLevelPins, { "anthropic/claude-opus-5": "high" });
});

test("reports patterns that match nothing but keeps the models that matched", async () => {
  const result = await resolveVisibleModels(runtime, ["anthropic/claude-opus-5", "ghost-gateway/*"]);

  assert.deepEqual(refs(result), ["anthropic/claude-opus-5"]);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /ghost-gateway\/\*/);
});

test("falls back to all available models when nothing matches at all", async () => {
  const result = await resolveVisibleModels(runtime, ["ghost-gateway/*"]);

  assert.deepEqual(refs(result), MODELS.map((m) => `${m.provider}/${m.id}`));
  assert.equal(result.warnings.length, 1);
  assert.deepEqual(result.thinkingLevelPins, {});
});
