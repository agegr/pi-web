/**
 * Provider listing for the Models panel.
 *
 * Providers are listed by the auth methods they actually declare, not by a
 * hardcoded id list. Anthropic and GitHub Copilot (and kimi-coding, openrouter,
 * radius, xai) declare both an API key and OAuth; hardcoding them as "OAuth
 * only" hid them from the API-key endpoint, while the OAuth endpoint separately
 * excluded Anthropic, so a configured Anthropic account appeared in neither list
 * (#309). Which providers are dual-auth is a property of the SDK's provider
 * definitions and changes between releases — read it from `auth`, never assume
 * it from an id.
 */

/** Credential kinds pi stores in `auth.json`. */
export type ProviderCredentialType = "api_key" | "oauth";

/** Auth status sources that mean "this key comes from models.json". */
const CUSTOM_PROVIDER_SOURCES = new Set(["models_json_key", "models_json_command"]);

/** Friendlier names for OAuth entries whose provider name is not self-explanatory. */
const OAUTH_DISPLAY_NAMES: Record<string, string> = {
  "openai-codex": "ChatGPT Plus/Pro",
  "github-copilot": "GitHub Copilot",
};

export interface ProviderListingInput {
  id: string;
  /** Provider display name (`provider.name`). */
  name: string;
  /** True when the provider declares an API-key login method. */
  hasApiKeyLogin: boolean;
  /** True when the provider declares an OAuth login method. */
  hasOAuth: boolean;
  /** Label of the OAuth method, e.g. "Anthropic (Claude Pro/Max)". */
  oauthName?: string;
  /** Result of `ModelRuntime.getProviderAuthStatus()`. */
  status: { configured: boolean; source?: string };
  /** Type of the credential stored for this provider, when there is one. */
  credentialType?: ProviderCredentialType;
  modelCount: number;
}

export interface ApiKeyProviderListing {
  id: string;
  displayName: string;
  configured: boolean;
  source?: string;
  modelCount: number;
  /** True when the same provider can also be authenticated with OAuth. */
  supportsOAuth: boolean;
}

export interface OAuthProviderListing {
  id: string;
  name: string;
  usesCallbackServer: boolean;
  loggedIn: boolean;
  /** True when the same provider can also be authenticated with an API key. */
  supportsApiKey: boolean;
}

function dedupeById(providers: readonly ProviderListingInput[]): ProviderListingInput[] {
  const seen = new Set<string>();
  const result: ProviderListingInput[] = [];
  for (const provider of providers) {
    if (seen.has(provider.id)) continue;
    seen.add(provider.id);
    result.push(provider);
  }
  return result;
}

/**
 * Providers that can be authenticated with an API key.
 *
 * Custom `models.json` providers are excluded because the Models panel already
 * renders them from `models.json` itself. A provider currently authenticated
 * with an OAuth credential is reported as not configured here, so it is listed
 * once — in the OAuth list — instead of twice.
 */
export function buildApiKeyProviderList(
  providers: readonly ProviderListingInput[],
): ApiKeyProviderListing[] {
  const result: ApiKeyProviderListing[] = [];
  for (const provider of dedupeById(providers)) {
    if (!provider.hasApiKeyLogin) continue;
    if (provider.status.source && CUSTOM_PROVIDER_SOURCES.has(provider.status.source)) continue;

    const configured = provider.status.configured && provider.credentialType !== "oauth";
    result.push({
      id: provider.id,
      displayName: provider.name,
      configured,
      ...(configured && provider.status.source ? { source: provider.status.source } : {}),
      modelCount: provider.modelCount,
      supportsOAuth: provider.hasOAuth,
    });
  }
  return result;
}

/** Providers that can be authenticated with OAuth. */
export function buildOAuthProviderList(
  providers: readonly ProviderListingInput[],
): OAuthProviderListing[] {
  const result: OAuthProviderListing[] = [];
  for (const provider of dedupeById(providers)) {
    if (!provider.hasOAuth) continue;
    result.push({
      id: provider.id,
      name: OAUTH_DISPLAY_NAMES[provider.id] ?? provider.oauthName ?? provider.name,
      usesCallbackServer: false,
      loggedIn: provider.credentialType === "oauth",
      supportsApiKey: provider.hasApiKeyLogin,
    });
  }
  return result;
}
