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

const { resolveVisibleModels, selectInitialModelScope } = await loadSubject();

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
    assert.deepEqual(result.scopedModels, []);
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

test("rejects an ambiguous bare exact model id before fuzzy matching", async () => {
  await assert.rejects(
    resolveVisibleModels(runtime, ["claude-sonnet-5"]),
    /Ambiguous enabledModels entry.*acme-gateway\/claude-sonnet-5.*anthropic\/claude-sonnet-5.*provider\/modelId/,
  );
});

test("accepts provider-qualified and unique bare exact model ids", async () => {
  const qualified = await resolveVisibleModels(runtime, ["acme-gateway/claude-sonnet-5"]);
  assert.deepEqual(refs(qualified), ["acme-gateway/claude-sonnet-5"]);

  const unique = await resolveVisibleModels(runtime, ["gpt-5.6-sol"]);
  assert.deepEqual(refs(unique), ["acme-gateway-openai/gpt-5.6-sol"]);
});

test("rejects an ambiguous bare exact model id with a thinking suffix", async () => {
  await assert.rejects(
    resolveVisibleModels(runtime, ["claude-sonnet-5:high"]),
    /Ambiguous enabledModels entry/,
  );
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
  assert.deepEqual(result.scopedModels, []);
  assert.deepEqual(result.thinkingLevelPins, {});
});

test("selects the saved scoped default and applies its thinking pin", async () => {
  const scope = await resolveVisibleModels(runtime, [
    "anthropic/claude-opus-5:high",
    "acme-gateway/*:low",
  ]);
  const initial = selectInitialModelScope(scope, {
    defaultModel: { provider: "acme-gateway", modelId: "claude-sonnet-5" },
  });

  assert.equal(`${initial.model.provider}/${initial.model.id}`, "acme-gateway/claude-sonnet-5");
  assert.equal(initial.thinkingLevel, "low");
  assert.equal(initial.scopedModels.length, 3);
});

test("uses the saved default without creating a synthetic scope when unconfigured", async () => {
  const scope = await resolveVisibleModels(runtime, undefined);
  const initial = selectInitialModelScope(scope, {
    defaultModel: { provider: "acme-gateway-openai", modelId: "gpt-5.6-sol" },
  });

  assert.equal(`${initial.model.provider}/${initial.model.id}`, "acme-gateway-openai/gpt-5.6-sol");
  assert.equal(initial.thinkingLevel, undefined);
  assert.deepEqual(initial.scopedModels, []);
});

test("uses resolver order when the saved default is outside the enabled scope", async () => {
  const scope = await resolveVisibleModels(runtime, [
    "anthropic/claude-opus-5:high",
    "anthropic/claude-sonnet-5:low",
  ]);
  const initial = selectInitialModelScope(scope, {
    defaultModel: { provider: "acme-gateway-openai", modelId: "gpt-5.6-sol" },
  });

  assert.equal(`${initial.model.provider}/${initial.model.id}`, "anthropic/claude-opus-5");
  assert.equal(initial.thinkingLevel, "high");
});

test("applies a requested scoped model pin unless thinking was explicitly overridden", async () => {
  const scope = await resolveVisibleModels(runtime, ["anthropic/*:high"]);
  const requestedModel = { provider: "anthropic", modelId: "claude-sonnet-5" };

  assert.equal(
    selectInitialModelScope(scope, { requestedModel }).thinkingLevel,
    "high",
  );
  assert.equal(
    selectInitialModelScope(scope, { requestedModel, thinkingLevel: "low" }).thinkingLevel,
    "low",
  );
  assert.equal(
    selectInitialModelScope(scope, { requestedModel, thinkingLevel: "off" }).thinkingLevel,
    "off",
  );
});

test("rejects an explicit model outside the enabled scope", async () => {
  const scope = await resolveVisibleModels(runtime, ["anthropic/*"]);

  assert.throws(
    () => selectInitialModelScope(scope, {
      requestedModel: { provider: "acme-gateway", modelId: "claude-sonnet-5" },
    }),
    /not available in the enabled scope/,
  );
});
