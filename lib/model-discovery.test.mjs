import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject(path) {
  try {
    const { createJiti } = await import("jiti");
    return createJiti(import.meta.url).import(path);
  } catch {
    return import(path);
  }
}

const { buildModelsListUrl, parseDiscoveredModels } = await loadSubject("./model-discovery.ts");
const { resolveModelDiscoveryAuth } = await loadSubject("./model-discovery-auth.ts");

test("builds protocol-appropriate model list URLs", () => {
  assert.equal(buildModelsListUrl("https://api.example.com/v1/", "openai-completions").toString(), "https://api.example.com/v1/models");
  assert.equal(buildModelsListUrl("https://api.anthropic.com", "anthropic-messages").toString(), "https://api.anthropic.com/v1/models?limit=1000");
  assert.equal(buildModelsListUrl("https://generativelanguage.googleapis.com", "google-generative-ai").toString(), "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000");
  assert.equal(buildModelsListUrl("https://api.example.com/custom/models", "openai-responses").toString(), "https://api.example.com/custom/models");
});

test("parses OpenAI, Anthropic, Google, and string model lists", () => {
  assert.deepEqual(parseDiscoveredModels({ data: [{ id: "gpt-5" }, { id: "claude", display_name: "Claude" }] }), [
    { id: "claude", name: "Claude" },
    { id: "gpt-5" },
  ]);
  assert.deepEqual(parseDiscoveredModels({ models: [{ name: "models/gemini-2.5-pro", displayName: "Gemini 2.5 Pro" }] }), [
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
  ]);
  assert.deepEqual(parseDiscoveredModels(["zeta", "alpha", "alpha"]), [
    { id: "alpha" },
    { id: "zeta" },
  ]);
});

test("reads context window and max output tokens from provider model lists", () => {
  // OpenAI-compatible gateways put the limits directly on the entry.
  assert.deepEqual(parseDiscoveredModels({ data: [{ id: "gpt-5", context_window: 400000, max_tokens: 128000 }] }), [
    { id: "gpt-5", contextWindow: 400000, maxTokens: 128000 },
  ]);

  // vLLM / Together / OpenRouter style spellings.
  assert.deepEqual(parseDiscoveredModels({ data: [{ id: "a", context_length: 32768, max_output_tokens: 8192 }] }), [
    { id: "a", contextWindow: 32768, maxTokens: 8192 },
  ]);
  assert.deepEqual(parseDiscoveredModels({ data: [{ id: "b", max_context_tokens: 200000, max_completion_tokens: 32000 }] }), [
    { id: "b", contextWindow: 200000, maxTokens: 32000 },
  ]);

  // camelCase spellings.
  assert.deepEqual(parseDiscoveredModels({ data: [{ id: "c", contextWindow: 128000, maxTokens: 4096 }] }), [
    { id: "c", contextWindow: 128000, maxTokens: 4096 },
  ]);

  // Nested under metadata / limits / capabilities / top_provider.
  assert.deepEqual(parseDiscoveredModels({ data: [{ id: "d", metadata: { limits: { context_window: 128000, max_tokens: 16384 } } }] }), [
    { id: "d", contextWindow: 128000, maxTokens: 16384 },
  ]);
  assert.deepEqual(parseDiscoveredModels({ data: [{ id: "e", top_provider: { context_length: 1000000 } }] }), [
    { id: "e", contextWindow: 1_000_000 },
  ]);
  assert.deepEqual(parseDiscoveredModels({ data: [{ id: "f", capabilities: { limits: { max_tokens: 64000 } } }] }), [
    { id: "f", maxTokens: 64000 },
  ]);

  // Numeric strings from some gateways are accepted too.
  assert.deepEqual(parseDiscoveredModels({ data: [{ id: "g", context_window: "262144", max_tokens: "16384" }] }), [
    { id: "g", contextWindow: 262144, maxTokens: 16384 },
  ]);
});

test("ignores unusable upstream spec values instead of writing them", () => {
  for (const bad of [0, -1, 1.5, "", "abc", null, undefined, NaN, {}, [], true, false]) {
    assert.deepEqual(parseDiscoveredModels({ data: [{ id: "x", context_window: bad, max_tokens: bad }] }), [
      { id: "x" },
    ], `should drop context_window/max_tokens = ${JSON.stringify(bad)}`);
  }
  // A valid limit survives a sibling that is unusable.
  assert.deepEqual(parseDiscoveredModels({ data: [{ id: "y", context_window: 128000, max_tokens: "lots" }] }), [
    { id: "y", contextWindow: 128000 },
  ]);
  // Nested junk does not shadow a valid top-level value.
  assert.deepEqual(parseDiscoveredModels({ data: [{ id: "z", context_window: 128000, limits: { context_window: -5 } }] }), [
    { id: "z", contextWindow: 128000 },
  ]);
});

test("keeps specs alongside ids and names from mixed provider responses", () => {
  assert.deepEqual(parseDiscoveredModels({
    data: [
      { id: "with-both", name: "With Both", context_window: 200000, max_tokens: 32000 },
      { id: "with-name", display_name: "Only Name" },
      { id: "with-ctx", context_length: 8192 },
      "bare-string",
    ],
  }), [
    { id: "bare-string" },
    { id: "with-name", name: "Only Name" },
    { id: "with-both", name: "With Both", contextWindow: 200000, maxTokens: 32000 },
    { id: "with-ctx", contextWindow: 8192 },
  ]);
});

test("resolves environment-backed headers without an API key", async () => {
  process.env.PI_WEB_DISCOVERY_TEST_TOKEN = "resolved-token";
  try {
    const auth = await resolveModelDiscoveryAuth("pi-web-header-only-test", {
      baseUrl: "https://example.invalid/v1",
      api: "openai-completions",
      headers: { "X-Discovery-Token": "$PI_WEB_DISCOVERY_TEST_TOKEN" },
    });
    assert.equal(auth.apiKey, undefined);
    assert.deepEqual(auth.headers, { "X-Discovery-Token": "resolved-token" });
  } finally {
    delete process.env.PI_WEB_DISCOVERY_TEST_TOKEN;
  }
});
