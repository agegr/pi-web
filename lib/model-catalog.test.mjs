import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  try {
    const { createJiti } = await import("jiti");
    return createJiti(import.meta.url).import("./model-catalog.ts");
  } catch {
    return import("./model-catalog.ts");
  }
}

const {
  flattenModelsDevCatalog,
  recommendModelCatalogPreset,
  searchModelCatalog,
} = await loadSubject();

const catalog = flattenModelsDevCatalog({
  openai: {
    name: "OpenAI",
    models: {
      "gpt-5": {
        id: "gpt-5",
        name: "GPT-5",
        reasoning: true,
        modalities: { input: ["text", "image", "pdf"], output: ["text"] },
        limit: { context: 400_000, output: 128_000 },
        cost: { input: 1.25, output: 10, cache_read: 0.125 },
      },
    },
  },
  openrouter: {
    name: "OpenRouter",
    api: "https://openrouter.ai/api/v1",
    models: {
      "openai/gpt-5": {
        id: "openai/gpt-5",
        name: "GPT-5 via OpenRouter",
        limit: { context: 400_000, output: 128_000 },
        cost: { input: 1.3, output: 10.5, cache_write: 2 },
      },
      "missing-price": {
        id: "missing-price",
        name: "No Price",
        limit: { context: 32_000, output: 8_000 },
      },
    },
  },
});

test("flattens supported models.dev metadata and prices", () => {
  assert.deepEqual(catalog[0], {
    key: "openai/gpt-5",
    providerId: "openai",
    providerName: "OpenAI",
    id: "gpt-5",
    name: "GPT-5",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 400_000,
    maxTokens: 128_000,
    cost: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: undefined },
  });
  assert.deepEqual(catalog[2].cost, {});
  assert.equal(catalog[2].contextWindow, 32_000);
  assert.equal(catalog.length, 3);
});

test("ranks exact model IDs and provider hints first", () => {
  assert.equal(searchModelCatalog(catalog, "gpt-5", "openai")[0].providerId, "openai");
  assert.equal(searchModelCatalog(catalog, "openai/gpt-5", "openrouter")[0].providerId, "openrouter");
});

test("prefers an exact Pi provider match", () => {
  const recommendation = recommendModelCatalogPreset(
    catalog,
    "openai/gpt-5",
    "openrouter",
    "https://proxy.example.com/v1",
  );
  assert.equal(recommendation.metadataMethod, "provider");
  assert.equal(recommendation.matchedProviderId, "openrouter");
  assert.deepEqual(recommendation.price, {
    status: "reliable",
    method: "provider",
    cost: { input: 1.3, output: 10.5, cacheRead: undefined, cacheWrite: 2 },
    providerId: "openrouter",
    providerName: "OpenRouter",
    support: 1,
    total: 1,
  });
});

test("matches canonical and catalog Base URLs by hostname", () => {
  const openai = recommendModelCatalogPreset(
    catalog,
    "openai/gpt-5",
    "custom-provider",
    "https://api.openai.com/v1",
  );
  assert.equal(openai.metadataMethod, "base-url");
  assert.equal(openai.matchedProviderId, "openai");
  assert.equal(openai.price.status, "reliable");
  assert.equal(openai.price.method, "base-url");
  assert.equal(openai.price.cost.input, 1.25);

  const openrouter = recommendModelCatalogPreset(
    catalog,
    "openai/gpt-5",
    "custom-provider",
    "https://api.openrouter.ai/api/v1",
  );
  assert.equal(openrouter.matchedProviderId, "openrouter");
  assert.equal(openrouter.price.status, "reliable");
  assert.equal(openrouter.price.cost.input, 1.3);

  const lookalike = recommendModelCatalogPreset(
    catalog,
    "openai/gpt-5",
    "custom-provider",
    "https://openrouter.ai.example.com/v1",
  );
  assert.equal(lookalike.metadataMethod, "consensus");
});

test("uses stable metadata and price consensus with cache modes", () => {
  const consensusCatalog = flattenModelsDevCatalog({
    alpha: {
      models: {
        shared: {
          id: "shared",
          name: "Shared Model",
          reasoning: true,
          modalities: { input: ["text", "image"] },
          limit: { context: 128_000, output: 16_000 },
          cost: { input: 2, output: 8, cache_read: 0.2, cache_write: 2 },
        },
      },
    },
    beta: {
      models: {
        shared: {
          id: "shared",
          name: "Shared Model",
          reasoning: true,
          modalities: { input: ["text", "image"] },
          limit: { context: 128_000, output: 16_000 },
          cost: { input: 2, output: 8, cache_read: 0.2, cache_write: 2 },
        },
      },
    },
    delta: {
      models: {
        shared: {
          id: "shared",
          name: "Shared Model",
          reasoning: true,
          modalities: { input: ["text", "image"] },
          limit: { context: 128_000, output: 16_000 },
          cost: { input: 2, output: 8, cache_read: 0.3, cache_write: 3 },
        },
      },
    },
    gamma: {
      models: {
        shared: {
          id: "shared",
          name: "Other Name",
          reasoning: false,
          modalities: { input: ["text"] },
          limit: { context: 64_000, output: 8_000 },
          cost: { input: 3, output: 9, cache_read: 0.4, cache_write: 4 },
        },
      },
    },
  });
  const recommendation = recommendModelCatalogPreset(consensusCatalog, "shared", "custom", "");
  assert.equal(recommendation.metadataMethod, "consensus");
  assert.deepEqual(recommendation.preset, {
    name: "Shared Model",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 128_000,
    maxTokens: 16_000,
    cost: { input: 2, output: 8, cacheRead: 0.2, cacheWrite: 2 },
  });
  assert.deepEqual(recommendation.price, {
    status: "reliable",
    method: "consensus",
    cost: { input: 2, output: 8, cacheRead: 0.2, cacheWrite: 2 },
    support: 3,
    total: 4,
  });
});

test("refuses tied or single-record fallback prices", () => {
  const conflictCatalog = flattenModelsDevCatalog({
    a: { models: { model: { id: "model", cost: { input: 1, output: 2 } } } },
    b: { models: { model: { id: "model", cost: { input: 1, output: 2 } } } },
    c: { models: { model: { id: "model", cost: { input: 3, output: 4 } } } },
    d: { models: { model: { id: "model", cost: { input: 3, output: 4 } } } },
  });
  const conflict = recommendModelCatalogPreset(conflictCatalog, "model", "custom", "");
  assert.deepEqual(conflict.price, {
    status: "unreliable",
    reason: "conflict",
    support: 2,
    total: 4,
  });
  assert.equal(conflict.preset.cost, undefined);

  const single = recommendModelCatalogPreset(
    flattenModelsDevCatalog({
      only: { models: { model: { id: "model", cost: { input: 1, output: 2 } } } },
    }),
    "model",
    "custom",
    "",
  );
  assert.equal(single.price.status, "unreliable");
  assert.equal(single.price.reason, "insufficient-support");
});
