import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  applySavedModelsConfig,
  filterModelsNavigation,
  resolveModelsSelection,
  modelsSelectionLabel,
  isModelsConfigDirty,
} = await jiti.import("./models-config-navigation.ts");

const data = {
  accounts: [
    { kind: "oauth", id: "anthropic", name: "Anthropic", connected: true, modelCount: 0 },
    { kind: "apikey", id: "openai", name: "OpenAI", connected: true, modelCount: 3 },
  ],
  providers: [
    {
      name: "deepseek",
      baseUrl: "https://api.deepseek.com/v1",
      api: "openai-completions",
      modelCount: 2,
      models: [
        { id: "deepseek-chat", name: "DeepSeek Chat", reasoning: false, index: 0 },
        { id: "deepseek-reasoner", name: "DeepSeek Reasoner", reasoning: true, index: 1 },
      ],
    },
    {
      name: "local-llm",
      baseUrl: "http://localhost:11434/v1",
      api: "openai-completions",
      modelCount: 1,
      models: [
        { id: "claude-sonnet-4-6", name: "Claude Sonnet", index: 0 },
      ],
    },
  ],
  expandedProviders: new Set(),
};

test("account or provider match keeps the matching provider visible", () => {
  const result = filterModelsNavigation(data, "anthropic");
  assert.deepEqual(result.accounts.map((a) => a.id), ["anthropic"]);
  assert.deepEqual(result.providers, []);

  const byProvider = filterModelsNavigation(data, "deepseek");
  assert.equal(byProvider.providers.length, 1);
  assert.equal(byProvider.providers[0].name, "deepseek");
  // Provider match shows all of that provider's models.
  assert.deepEqual(byProvider.providers[0].models.map((m) => m.id), ["deepseek-chat", "deepseek-reasoner"]);
  assert.deepEqual(byProvider.expandedProviders, new Set(["deepseek"]));
});

test("provider rows match base URL and API type", () => {
  const byUrl = filterModelsNavigation(data, "11434");
  assert.deepEqual(byUrl.providers.map((p) => p.name), ["local-llm"]);
  const byApi = filterModelsNavigation(data, "openai-completions");
  assert.equal(byApi.providers.length, 2);
});

test("model-only match keeps its parent provider and only matching model rows", () => {
  const result = filterModelsNavigation(data, "claude-sonnet");
  assert.equal(result.providers.length, 1);
  assert.equal(result.providers[0].name, "local-llm");
  assert.deepEqual(result.providers[0].models.map((m) => m.id), ["claude-sonnet-4-6"]);
  assert.deepEqual(result.expandedProviders, new Set(["local-llm"]));
});

test("model rows match display names and empty ids never crash", () => {
  const withBlank = {
    ...data,
    providers: [
      ...data.providers,
      { name: "blank", baseUrl: undefined, api: undefined, modelCount: 1, models: [{ id: "", name: undefined, index: 0 }] },
    ],
  };
  const result = filterModelsNavigation(withBlank, "BLANK");
  assert.equal(result.providers.length, 1);
  assert.equal(result.providers[0].name, "blank");
  assert.equal(filterModelsNavigation(withBlank, "zzz-no-match").providers.length, 0);
});

test("empty query restores every group and preserves explicit disclosure state", () => {
  const expanded = new Set(["deepseek"]);
  const result = filterModelsNavigation({ ...data, expandedProviders: expanded }, "");
  assert.equal(result.accounts.length, 2);
  assert.equal(result.providers.length, 2);
  assert.deepEqual(result.expandedProviders, expanded);
});

test("deleted model selection falls back to its parent provider", () => {
  const config = {
    providers: {
      deepseek: { models: [{ id: "deepseek-chat" }] },
    },
  };
  const selection = { type: "model", providerName: "deepseek", index: 5 };
  assert.deepEqual(resolveModelsSelection(selection, config, [], []), {
    type: "provider",
    name: "deepseek",
  });
});

test("deleted provider selection resolves to the nearest valid provider or list view", () => {
  const config = { providers: { local: {} } };
  assert.deepEqual(
    resolveModelsSelection({ type: "provider", name: "gone" }, config, [], []),
    { type: "provider", name: "local" },
  );
  assert.equal(resolveModelsSelection({ type: "provider", name: "gone" }, { providers: {} }, [], []), null);
  assert.equal(resolveModelsSelection(null, config, [], []), null);
});

test("disconnected account selections resolve to the list view", () => {
  const config = { providers: {} };
  const oauth = [{ id: "anthropic", name: "Anthropic", usesCallbackServer: false, loggedIn: false }];
  const apiKey = [{ id: "openai", displayName: "OpenAI", configured: false, modelCount: 0 }];
  assert.equal(resolveModelsSelection({ type: "oauth", providerId: "anthropic" }, config, oauth, apiKey), null);
  assert.equal(resolveModelsSelection({ type: "apikey", providerId: "openai" }, config, oauth, apiKey), null);
  const loggedIn = [{ ...oauth[0], loggedIn: true }];
  assert.deepEqual(resolveModelsSelection({ type: "oauth", providerId: "anthropic" }, config, loggedIn, apiKey), { type: "oauth", providerId: "anthropic" });
});

test("selection labels name the selection and its provider context", () => {
  const config = {
    providers: {
      deepseek: { baseUrl: "https://api.deepseek.com/v1", models: [{ id: "deepseek-chat" }] },
    },
  };
  assert.deepEqual(modelsSelectionLabel({ type: "provider", name: "deepseek" }, config, [], []), {
    title: "deepseek",
    subtitle: "https://api.deepseek.com/v1",
  });
  assert.deepEqual(modelsSelectionLabel({ type: "model", providerName: "deepseek", index: 0 }, config, [], []), {
    title: "deepseek-chat",
    subtitle: "deepseek",
  });
  const oauth = [{ id: "anthropic", name: "Anthropic", usesCallbackServer: false, loggedIn: true }];
  assert.deepEqual(modelsSelectionLabel({ type: "oauth", providerId: "anthropic" }, config, oauth, []), {
    title: "Anthropic",
  });
  assert.deepEqual(modelsSelectionLabel(null, config, [], []), { title: "" });
});

test("model-only match keeps the original model index, not the filtered array index", () => {
  const result = filterModelsNavigation(data, "reasoner");
  assert.equal(result.providers.length, 1);
  assert.deepEqual(result.providers[0].models, [
    { id: "deepseek-reasoner", name: "DeepSeek Reasoner", reasoning: true, index: 1 },
  ]);
});

test("applySavedModelsConfig keeps concurrent edits and otherwise takes the normalized document", () => {
  const saved = { providers: { a: { api: "openai-completions" } } };
  const normalized = { providers: { a: { api: "openai-completions", baseUrl: "https://api.example.com/v1" } } };
  assert.deepEqual(applySavedModelsConfig(saved, saved, normalized), normalized);
  const concurrent = { providers: { a: { api: "openai-completions", headers: { "X-Extra": "1" } } } };
  assert.deepEqual(applySavedModelsConfig(saved, concurrent, normalized), concurrent);
});

test("null baseline is dirty once the draft has any custom provider", () => {
  assert.equal(isModelsConfigDirty(null, { providers: {} }), false);
  assert.equal(isModelsConfigDirty(null, { providers: { a: {} } }), true);
});

test("dirty comparison ignores object key order but keeps array order", () => {
  const baseline = { providers: { a: { models: [{ id: "m1" }, { id: "m2" }], api: "openai-completions" } } };
  const reorderedKeys = { providers: { a: { api: "openai-completions", models: [{ id: "m1" }, { id: "m2" }] } } };
  const changed = { providers: { a: { models: [{ id: "m1" }, { id: "m3" }], api: "openai-completions" } } };
  const reorderedModels = { providers: { a: { models: [{ id: "m2" }, { id: "m1" }], api: "openai-completions" } } };

  assert.equal(isModelsConfigDirty(baseline, { ...baseline }), false);
  assert.equal(isModelsConfigDirty(baseline, reorderedKeys), false);
  assert.equal(isModelsConfigDirty(baseline, changed), true);
  assert.equal(isModelsConfigDirty(baseline, reorderedModels), true);
});
