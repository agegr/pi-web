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

test("keeps capability metadata a gateway publishes (#856)", () => {
  assert.deepEqual(parseDiscoveredModels({
    data: [{
      id: "glm-5.3",
      object: "model",
      context_length: 1000000,
      max_output_tokens: 64000,
      supports_reasoning: true,
      default_effort: "high",
      can_disable_thinking: true,
      supported_efforts: ["low", "high", "max"],
    }],
  }), [{
    id: "glm-5.3",
    reasoning: true,
    // Unadvertised levels are unsupported; max is offered only when mapped.
    thinkingLevelMap: { minimal: null, medium: null, xhigh: null, max: "max" },
    contextWindow: 1000000,
    maxTokens: 64000,
  }]);
  assert.deepEqual(parseDiscoveredModels({
    models: [{
      name: "models/gemini-2.5-pro",
      displayName: "Gemini 2.5 Pro",
      inputTokenLimit: 1048576,
      outputTokenLimit: "65536",
      thinking: true,
    }],
  }), [{ id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", reasoning: true, contextWindow: 1048576, maxTokens: 65536 }]);
});

test("reads reasoning levels and input modalities from a gateway's own field names", () => {
  assert.deepEqual(parseDiscoveredModels({
    object: "list",
    data: [{
      id: "idealab-team/bailian/deepseek-v4.1-flash-1017",
      display_name: "DeepSeek V4.1 Flash 1017",
      max_input_tokens: 1048576,
      max_output_tokens: 384000,
      modalities: { input: ["text", "image"] },
      reasoning: true,
      reasoning_levels: ["none", "low", "high", "max"],
      supported_reasoning_levels: [{ effort: "none" }, { effort: "low" }, { effort: "high" }, { effort: "max" }],
    }],
  }), [{
    id: "idealab-team/bailian/deepseek-v4.1-flash-1017",
    name: "DeepSeek V4.1 Flash 1017",
    reasoning: true,
    // `none` is an effort string, not pi's disabled thinking, so `off` stays unmapped.
    thinkingLevelMap: { minimal: null, medium: null, xhigh: null, max: "max" },
    input: ["text", "image"],
    contextWindow: 1048576,
    maxTokens: 384000,
  }]);
});

test("keeps the input modalities pi knows and drops the rest", () => {
  assert.deepEqual(parseDiscoveredModels({
    data: [
      { id: "vision", modalities: { input: ["text", "image", "video", "PDF"] } },
      { id: "image-only", modalities: { input: ["image"] } },
      { id: "bare", input: ["text", "audio"] },
      { id: "unknown-only", modalities: { input: ["audio"] } },
      { id: "not-a-list", modalities: { input: "text" } },
      { id: "string-input", input: "image" },
      { id: "absent" },
    ],
  }), [
    { id: "absent" },
    { id: "bare", input: ["text"] },
    { id: "image-only", input: ["image"] },
    { id: "not-a-list" },
    { id: "string-input" },
    { id: "unknown-only" },
    { id: "vision", input: ["text", "image"] },
  ]);
});

test("takes supported_efforts over reasoning_levels when both are published", () => {
  assert.deepEqual(parseDiscoveredModels({
    data: [{ id: "both", reasoning: true, supported_efforts: ["low"], reasoning_levels: ["low", "max"] }],
  }), [{ id: "both", reasoning: true, thinkingLevelMap: { minimal: null, medium: null, high: null, xhigh: null, max: null } }]);
});

test("leaves a gateway's pricing out", () => {
  // The same names mean different units: Vercel AI Gateway quotes per token,
  // Chutes per million.
  assert.deepEqual(parseDiscoveredModels({
    data: [
      { id: "per-token", pricing: { input: "0.00001", output: "0.00005", input_cache_read: "0.000001" } },
      { id: "per-million", pricing: { prompt: 0.12, completion: 0.37 } },
    ],
  }), [{ id: "per-million" }, { id: "per-token" }]);
});

test("ignores junk and ambiguous capability values (#856)", () => {
  assert.deepEqual(parseDiscoveredModels({
    data: [
      { id: "junk", context_length: 0, max_output_tokens: "abc", supports_reasoning: "yes", supported_efforts: ["high"] },
      // max_tokens means either limit depending on the gateway.
      { id: "ambiguous", max_tokens: 8192, contextWindow: 12.5 },
      { id: "efforts-only", supports_reasoning: true, supported_efforts: ["none", 3] },
      { id: "empty-efforts", reasoning: true, supported_efforts: [] },
    ],
  }), [
    { id: "ambiguous" },
    { id: "efforts-only", reasoning: true },
    { id: "empty-efforts", reasoning: true },
    { id: "junk" },
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

test("resolves the effective base URL and API for the requested provider", async () => {
  const configured = await resolveModelDiscoveryAuth("pi-web-baseurl-test", {
    baseUrl: "https://example.invalid/v1/",
    api: "anthropic-messages",
  });
  assert.equal(configured.baseUrl, "https://example.invalid/v1/");
  assert.equal(configured.api, "anthropic-messages");

  // A models-only entry keeps the endpoint and protocol pi ships for that
  // provider, so discovery does not depend on models.json repeating the base URL.
  const builtin = await resolveModelDiscoveryAuth("deepseek", {
    models: [{ id: "deepseek-flash" }],
  });
  assert.equal(builtin.baseUrl, "https://api.deepseek.com");
  assert.equal(builtin.api, "openai-completions");
});

test("asks for a Base URL when a custom provider has none and pi ships no endpoint", async () => {
  const { createJiti } = await import("jiti");
  const { POST } = await createJiti(import.meta.url, { tsconfigPaths: true })
    .import("../app/api/models-config/discover/route.ts");
  const response = await POST(new Request("http://localhost/api/models-config/discover", {
    method: "POST",
    body: JSON.stringify({ providerName: "pi-web-no-baseurl-test", provider: {} }),
  }));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Base URL is required" });
});
