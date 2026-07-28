import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { getAuthenticatedSession } from "@/lib/pi-web-auth-route";

export const dynamic = "force-dynamic";

// Providers that use OAuth — handled separately via /api/auth/providers
const OAUTH_PROVIDER_IDS = new Set(["anthropic", "github-copilot", "openai-codex"]);

export async function GET(request: Request) {
  if (!getAuthenticatedSession(request).valid) return Response.json({ error: "Not authenticated" }, { status: 401 });
  const modelRuntime = await ModelRuntime.create();
  const all = modelRuntime.getModels();

  // Deduplicate by provider, skip OAuth-only providers and custom providers (source=models_json_key)
  const seen = new Set<string>();
  const result: {
    id: string;
    displayName: string;
    configured: boolean;
    source?: string;
    modelCount: number;
  }[] = [];

  for (const provider of modelRuntime.getProviders()) {
    if (seen.has(provider.id)) continue;
    seen.add(provider.id);
    if (OAUTH_PROVIDER_IDS.has(provider.id) || !provider.auth.apiKey?.login) continue;
    const status = modelRuntime.getProviderAuthStatus(provider.id);
    // Skip providers whose key comes from models.json (those are custom providers)
    if (status.source === "models_json_key") continue;
    const modelCount = all.filter((model) => model.provider === provider.id).length;
    result.push({
      id: provider.id,
      displayName: provider.name,
      configured: status.configured,
      source: status.source,
      modelCount,
    });
  }

  return Response.json({ providers: result });
}
