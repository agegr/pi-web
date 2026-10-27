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

const { orderSelectorModels, resolveVisibleModels, selectInitialModelScope } = await loadSubject();

const MODELS = [
  { id: "claude-opus-5", provider: "anthropic", name: "Claude Opus 5" },
  { id: "claude-sonnet-5", provider: "anthropic", name: "Claude Sonnet 5" },
  { id: "claude-sonnet-4-6", provider: "anthropic", name: "Claude Sonnet 4.6" },
  { id: "claude-opus-4-8", provider: "acme-gateway", name: "Claude Opus 4.8 (Acme)" },
  { id: "claude-sonnet-5", provider: "acme-gateway", name: "Claude Sonnet 5 (Acme)" },
  { id: "gpt-5.6-sol", provider: "acme-gateway-openai", name: "GPT-5.6 (Acme)" },
];

const runtime = {
  getAvailable: async () => MODELS,
  getModels: () => MODELS,
  getProviderAuthStatus: () => ({ configured: true }),
};

const SIGNED_OUT_MODEL = { id: "deepseek-v4-pro", provider: "opencode-go", name: "DeepSeek V4 Pro" };
const signedOutRuntime = {
  ...runtime,
  getModels: () => [...MODELS, SIGNED_OUT_MODEL],
  getProviderAuthStatus: (provider) => ({ configured: provider !== SIGNED_OUT_MODEL.provider }),
};

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

test("keeps models that matched and stays quiet about leftover unmatched globs", async () => {
  const result = await resolveVisibleModels(runtime, [
    "anthropic/claude-opus-5",
    "retired-provider/old-model-*",
    "ghost-gateway/*",
  ]);

  assert.deepEqual(refs(result), ["anthropic/claude-opus-5"]);
  assert.deepEqual(result.warnings, []);
});

test("keeps unmatched exact and malformed glob warnings when another model matches", async () => {
  const result = await resolveVisibleModels(runtime, [
    "anthropic/claude-opus-5",
    "typo-model",
    "ghost-gateway/*:bogus",
  ]);

  assert.deepEqual(refs(result), ["anthropic/claude-opus-5"]);
  assert.deepEqual(result.warnings, [
    'No models match pattern "typo-model"',
    'No models match pattern "ghost-gateway/*:bogus"',
  ]);
});

test("stays quiet about known signed-out models while another preference still matches", async () => {
  const patterns = ["anthropic/claude-opus-5:high", "opencode-go/deepseek-v4-pro"];
  const before = [...patterns];
  const result = await resolveVisibleModels(signedOutRuntime, patterns);

  assert.deepEqual(refs(result), ["anthropic/claude-opus-5"]);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.thinkingLevelPins, { "anthropic/claude-opus-5": "high" });
  assert.deepEqual(patterns, before, "signed-out preferences must not be removed or rewritten");
});

test("recognizes signed-out references with thinking pins, case differences and nested ids", async () => {
  const nestedModel = { id: "vendor/model:version", provider: "gateway", name: "Nested model" };
  const nestedRuntime = {
    ...signedOutRuntime,
    getModels: () => [...signedOutRuntime.getModels(), nestedModel],
    getProviderAuthStatus: (provider) => ({
      configured: provider !== "gateway" && signedOutRuntime.getProviderAuthStatus(provider).configured,
    }),
  };
  const result = await resolveVisibleModels(nestedRuntime, [
    "anthropic/claude-opus-5",
    "OPENCODE-GO/DEEPSEEK-V4-PRO:low",
    "gateway/vendor/model:version:high",
  ]);

  assert.deepEqual(refs(result), ["anthropic/claude-opus-5"]);
  assert.deepEqual(result.warnings, []);
});

test("signed-out preferences become selectable again after sign-in without changing the patterns", async () => {
  let signedIn = false;
  const authRuntime = {
    ...signedOutRuntime,
    getAvailable: async () => signedIn ? signedOutRuntime.getModels() : MODELS,
    getProviderAuthStatus: (provider) => ({
      configured: signedIn || signedOutRuntime.getProviderAuthStatus(provider).configured,
    }),
  };
  const patterns = ["anthropic/claude-opus-5", "opencode-go/deepseek-v4-pro:low"];
  const signedOut = await resolveVisibleModels(authRuntime, patterns);
  assert.deepEqual(signedOut.warnings, []);
  assert.deepEqual(refs(signedOut), ["anthropic/claude-opus-5"]);

  signedIn = true;
  const signedInScope = await resolveVisibleModels(authRuntime, patterns);
  assert.deepEqual(signedInScope.warnings, []);
  assert.deepEqual(refs(signedInScope), ["anthropic/claude-opus-5", "opencode-go/deepseek-v4-pro"]);
  assert.deepEqual(signedInScope.thinkingLevelPins, { "opencode-go/deepseek-v4-pro": "low" });
});

test("keeps typos, removed models, and malformed pins visible even for a signed-out provider", async () => {
  const invalid = [
    "opencode-go/deepseek-v4-prro",
    "opencode-go/retired-model",
    "removed-provider/model",
    "opencode-go/deepseek-v4-pro:bogus",
  ];
  const result = await resolveVisibleModels(signedOutRuntime, ["anthropic/claude-opus-5", ...invalid]);

  assert.deepEqual(result.warnings, invalid.map((pattern) => `No models match pattern "${pattern}"`));
  const availableMalformed = await resolveVisibleModels(runtime, ["anthropic/claude-opus-5:bogus"]);
  assert.match(availableMalformed.warnings[0], /Invalid thinking level/);
});

test("keeps warnings for catalog models with configured auth that are nevertheless unavailable", async () => {
  const result = await resolveVisibleModels({
    ...signedOutRuntime,
    hasConfiguredAuth: () => false,
    getProviderAuthStatus: () => ({ configured: true, source: "stored" }),
  }, [
    "anthropic/claude-opus-5",
    "opencode-go/deepseek-v4-pro",
  ]);

  assert.deepEqual(result.warnings, ['No models match pattern "opencode-go/deepseek-v4-pro"']);
});

test("suppresses unique bare signed-out references but keeps ambiguous catalog references", async () => {
  const unique = await resolveVisibleModels(signedOutRuntime, ["anthropic/claude-opus-5", "deepseek-v4-pro"]);
  assert.deepEqual(unique.warnings, []);

  const ambiguous = await resolveVisibleModels({
    ...signedOutRuntime,
    getModels: () => [...signedOutRuntime.getModels(), { ...SIGNED_OUT_MODEL, provider: "other-gateway" }],
  }, ["anthropic/claude-opus-5", "deepseek-v4-pro"]);
  assert.deepEqual(ambiguous.warnings, ['No models match pattern "deepseek-v4-pro"']);
});

test("keeps signed-out model warnings on a total scope miss", async () => {
  const result = await resolveVisibleModels(signedOutRuntime, ["opencode-go/deepseek-v4-pro:low"]);

  assert.deepEqual(refs(result), MODELS.map((m) => `${m.provider}/${m.id}`));
  assert.deepEqual(result.scopedModels, []);
  assert.deepEqual(result.warnings, ['No models match pattern "opencode-go/deepseek-v4-pro:low"']);
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

test("orders the selector like pi's /model, keeping models.json order (#783)", async () => {
  // Registry order: a models.json provider lists its models in file order.
  const registry = [
    { id: "zeta-flagship", provider: "zz-gateway", name: "Zeta Flagship" },
    { id: "alpha-cheap", provider: "zz-gateway", name: "Alpha Cheap" },
    { id: "gpt-5.6-sol", provider: "acme", name: "GPT-5.6" },
    { id: "deepseek-v4", provider: "acme", name: "DeepSeek V4" },
  ];
  const registryRuntime = { getAvailable: async () => registry };
  const ordered = (scope) => orderSelectorModels(scope).map((m) => `${m.provider}/${m.id}`);

  // Unscoped: grouped by provider id, never sorted by name.
  assert.deepEqual(ordered(await resolveVisibleModels(registryRuntime, undefined)), [
    "acme/gpt-5.6-sol",
    "acme/deepseek-v4",
    "zz-gateway/zeta-flagship",
    "zz-gateway/alpha-cheap",
  ]);
  // A scope keeps the enabledModels order.
  assert.deepEqual(
    ordered(await resolveVisibleModels(registryRuntime, ["zz-gateway/alpha-cheap", "acme/*", "zeta-flagship"])),
    ["zz-gateway/alpha-cheap", "acme/gpt-5.6-sol", "acme/deepseek-v4", "zz-gateway/zeta-flagship"],
  );
});
