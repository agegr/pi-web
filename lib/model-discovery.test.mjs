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

const { buildModelsListUrl, parseDiscoveredModels, normalizeProviderBaseUrl, assertSafeDiscoveryTarget } = await loadSubject("./model-discovery.ts");
const { resolveModelDiscoveryAuth } = await loadSubject("./model-discovery-auth.ts");

test("normalizes host-only base URLs to /v1 for OpenAI-style APIs", () => {
  assert.equal(normalizeProviderBaseUrl("https://www.codex2api.com", "openai-responses"), "https://www.codex2api.com/v1");
  assert.equal(normalizeProviderBaseUrl("https://www.codex2api.com/", "openai-completions"), "https://www.codex2api.com/v1");
  assert.equal(normalizeProviderBaseUrl("https://api.example.com/v1", "openai-completions"), "https://api.example.com/v1");
  assert.equal(normalizeProviderBaseUrl("https://api.example.com/custom", "openai-completions"), "https://api.example.com/custom");
  assert.equal(normalizeProviderBaseUrl("https://api.anthropic.com", "anthropic-messages"), "https://api.anthropic.com");
  assert.equal(normalizeProviderBaseUrl("https://www.codex2api.com", "google-generative-ai"), "https://www.codex2api.com");
});

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

test("rejects non-http(s) discovery targets", () => {
  assert.throws(
    () => assertSafeDiscoveryTarget(new URL("file:///etc/passwd"), {}),
    /http/,
  );
  assert.throws(
    () => assertSafeDiscoveryTarget(new URL("ftp://api.example.com/models"), { apiKey: "k" }),
    /http/,
  );
});

test("never forwards credentials to loopback or private targets", () => {
  for (const target of [
    "http://127.0.0.1:11434/v1/models",
    "http://localhost:1234/v1/models",
    "http://169.254.169.254/latest/meta-data",
    "http://10.0.0.8/v1/models",
    "http://192.168.1.1/v1/models",
    "http://[::1]:8000/v1/models",
  ]) {
    assert.throws(
      () => assertSafeDiscoveryTarget(new URL(target), { apiKey: "stored-key" }),
      /private|loopback|local/i,
      `${target} must be rejected with credentials`,
    );
  }
  assert.throws(
    () => assertSafeDiscoveryTarget(new URL("http://127.0.0.1:11434/v1/models"), { headers: { Authorization: "Bearer x" } }),
    /private|loopback|local/i,
    "header credentials must be blocked too",
  );
});

test("allows private targets without credentials for local models", () => {
  assert.doesNotThrow(() => assertSafeDiscoveryTarget(new URL("http://127.0.0.1:11434/v1/models"), {}));
  assert.doesNotThrow(() => assertSafeDiscoveryTarget(new URL("http://localhost:1234/v1/models"), {}));
  assert.doesNotThrow(() => assertSafeDiscoveryTarget(new URL("http://127.0.0.1:11434/v1/models"), { headers: {} }));
});

test("allows public targets with credentials", () => {
  assert.doesNotThrow(() => assertSafeDiscoveryTarget(new URL("https://api.openai.com/v1/models"), { apiKey: "stored-key" }));
  assert.doesNotThrow(() => assertSafeDiscoveryTarget(new URL("https://api.example.com/v1/models"), { headers: { "X-Key": "v" } }));
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
