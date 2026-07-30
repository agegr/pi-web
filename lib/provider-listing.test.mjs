import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  try {
    const { createJiti } = await import("jiti");
    return createJiti(import.meta.url).import("./provider-listing.ts");
  } catch {
    return import("./provider-listing.ts");
  }
}

const { buildApiKeyProviderList, buildOAuthProviderList } = await loadSubject();

const provider = (overrides) => ({
  id: "anthropic",
  name: "Anthropic",
  hasApiKeyLogin: true,
  hasOAuth: true,
  oauthName: "Anthropic (Claude Pro/Max)",
  status: { configured: false },
  modelCount: 12,
  ...overrides,
});

test("lists an API-key-configured dual-auth provider in the API-key list (#309)", () => {
  const providers = [provider({ status: { configured: true, source: "stored" }, credentialType: "api_key" })];

  const apiKey = buildApiKeyProviderList(providers);
  assert.deepEqual(apiKey, [{
    id: "anthropic",
    displayName: "Anthropic",
    configured: true,
    source: "stored",
    modelCount: 12,
    supportsOAuth: true,
  }]);

  // …and only as a not-logged-in entry in the OAuth list, so it renders once.
  const oauth = buildOAuthProviderList(providers);
  assert.equal(oauth.length, 1);
  assert.equal(oauth[0].loggedIn, false);
  assert.equal(oauth[0].name, "Anthropic (Claude Pro/Max)");
  assert.equal(oauth[0].supportsApiKey, true);
});

test("an OAuth-authenticated provider counts as configured only in the OAuth list", () => {
  const providers = [provider({ status: { configured: true, source: "stored" }, credentialType: "oauth" })];

  assert.deepEqual(buildApiKeyProviderList(providers).map((p) => [p.id, p.configured, p.source]), [
    ["anthropic", false, undefined],
  ]);
  assert.deepEqual(buildOAuthProviderList(providers).map((p) => [p.id, p.loggedIn]), [["anthropic", true]]);
});

test("switching auth method moves the provider between lists in both directions", () => {
  // API key → OAuth: the API-key row goes inactive as the OAuth row lights up.
  const afterOAuthLogin = [provider({ status: { configured: true, source: "stored" }, credentialType: "oauth" })];
  assert.equal(buildApiKeyProviderList(afterOAuthLogin)[0].configured, false);
  assert.equal(buildOAuthProviderList(afterOAuthLogin)[0].loggedIn, true);

  // OAuth → API key: and back again.
  const afterKeySaved = [provider({ status: { configured: true, source: "stored" }, credentialType: "api_key" })];
  assert.equal(buildApiKeyProviderList(afterKeySaved)[0].configured, true);
  assert.equal(buildOAuthProviderList(afterKeySaved)[0].loggedIn, false);
});

test("environment-provided keys are reported as configured", () => {
  const providers = [provider({ id: "openai", name: "OpenAI", hasOAuth: false, oauthName: undefined, status: { configured: true, source: "environment" } })];

  const apiKey = buildApiKeyProviderList(providers);
  assert.equal(apiKey[0].configured, true);
  assert.equal(apiKey[0].source, "environment");
  assert.equal(apiKey[0].supportsOAuth, false);
  assert.deepEqual(buildOAuthProviderList(providers), []);
});

test("custom models.json providers stay out of the API-key list", () => {
  const providers = [
    provider({ id: "acme-gateway", name: "acme-gateway", hasOAuth: false, oauthName: undefined, status: { configured: true, source: "models_json_key" } }),
    provider({ id: "acme-cmd", name: "acme-cmd", hasOAuth: false, oauthName: undefined, status: { configured: true, source: "models_json_command" } }),
  ];

  assert.deepEqual(buildApiKeyProviderList(providers), []);
});

test("providers without an API-key login method are excluded", () => {
  const providers = [provider({ id: "subscription-only", name: "Subscription Only", hasApiKeyLogin: false, oauthName: undefined })];

  assert.deepEqual(buildApiKeyProviderList(providers), []);
  assert.deepEqual(buildOAuthProviderList(providers).map((p) => p.name), ["Subscription Only"]);
});

test("keeps friendlier OAuth labels and falls back to the provider name", () => {
  const providers = [
    // openai-codex is OAuth-only in the pinned SDK — the label map still covers it.
    provider({ id: "openai-codex", name: "OpenAI Codex", hasApiKeyLogin: false, oauthName: "Sign in with ChatGPT" }),
    provider({ id: "github-copilot", name: "GitHub Copilot Provider", oauthName: "Copilot" }),
    provider({ id: "xai", name: "xAI", oauthName: undefined }),
  ];

  assert.deepEqual(buildOAuthProviderList(providers).map((p) => p.name), [
    "ChatGPT Plus/Pro",
    "GitHub Copilot",
    "xAI",
  ]);
});

test("duplicate provider ids are collapsed", () => {
  const providers = [provider({}), provider({ status: { configured: true, source: "stored" }, credentialType: "api_key" })];

  assert.deepEqual(buildApiKeyProviderList(providers).map((p) => [p.id, p.configured]), [["anthropic", false]]);
  assert.equal(buildOAuthProviderList(providers).length, 1);
});
