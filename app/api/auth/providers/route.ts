import { buildApiKeyProviderList, buildOAuthProviderList } from "@/lib/provider-listing";
import { collectProviderListingInputs } from "@/lib/provider-listing-runtime";
import { getModelRuntimeWithExtensions } from "@/lib/model-runtime";

export const dynamic = "force-dynamic";

// Providers that declare an OAuth login method, including anthropic
// (Claude Pro/Max) — see lib/provider-listing.ts (#309).
export async function GET() {
  const modelRuntime = await getModelRuntimeWithExtensions();
  const inputs = await collectProviderListingInputs(modelRuntime);
  const oauthProviders = buildOAuthProviderList(inputs);
  const apiKeyProviders = buildApiKeyProviderList(inputs);
  // Every runtime provider, not only those with a chat model: the Models
  // sidebar also labels a configured provider with no models (e.g. a
  // classifier-only built-in such as TypeSafe).
  const providerNames = Object.fromEntries(inputs.map((provider) => [provider.id, provider.name]));
  return Response.json({ providers: oauthProviders, oauthProviders, apiKeyProviders, providerNames });
}
