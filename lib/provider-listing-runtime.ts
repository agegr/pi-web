import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { ProviderCredentialType, ProviderListingInput } from "@/lib/provider-listing";

/**
 * Adapter between `ModelRuntime` and the pure listing helpers in
 * `lib/provider-listing.ts`.
 */
export async function collectProviderListingInputs(
  modelRuntime: ModelRuntime,
): Promise<ProviderListingInput[]> {
  const models = modelRuntime.getModels();

  const credentialTypes = new Map<string, ProviderCredentialType>();
  try {
    for (const credential of await modelRuntime.listCredentials()) {
      if (credential.type === "api_key" || credential.type === "oauth") {
        credentialTypes.set(credential.providerId, credential.type);
      }
    }
  } catch {
    // A damaged auth.json must not empty the provider list; fall back to the
    // per-provider auth status only.
  }

  return modelRuntime.getProviders().map((provider) => ({
    id: provider.id,
    name: provider.name,
    hasApiKeyLogin: Boolean(provider.auth.apiKey?.login),
    hasOAuth: Boolean(provider.auth.oauth),
    ...(provider.auth.oauth?.name ? { oauthName: provider.auth.oauth.name } : {}),
    status: modelRuntime.getProviderAuthStatus(provider.id),
    ...(credentialTypes.has(provider.id)
      ? { credentialType: credentialTypes.get(provider.id) }
      : {}),
    modelCount: models.filter((model) => model.provider === provider.id).length,
  }));
}
