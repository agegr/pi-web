import { NextResponse } from "next/server";
import { invalidateModelsCache } from "@/lib/models-cache";
import { getOmpRuntime, invalidateOmpRuntime } from "@/lib/omp-runtime";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ provider: string }> };

// GET /api/auth/api-key/[provider] — returns auth status (never returns the actual key)
export async function GET(_req: Request, { params }: Params) {
  const { provider } = await params;
  const { modelRegistry, authStorage } = await getOmpRuntime();
  const origin = authStorage.getCredentialOrigin(provider);
  const models = modelRegistry.getAll().filter((model) => model.provider === provider).length;
  return NextResponse.json({
    provider,
    displayName: provider,
    configured: authStorage.hasAuth(provider),
    source: origin?.kind,
    models,
  });
}

// POST /api/auth/api-key/[provider]  body: { apiKey: string }
export async function POST(req: Request, { params }: Params) {
  const { provider } = await params;
  try {
    const { apiKey } = await req.json() as { apiKey?: string };
    if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
      return NextResponse.json({ error: "apiKey is required" }, { status: 400 });
    }
    const { modelRegistry, authStorage } = await getOmpRuntime();
    if (!modelRegistry.hasProvider(provider)) {
      return NextResponse.json({ error: `Unknown provider: ${provider}` }, { status: 400 });
    }
    // omp stores one row per credential in `agent.db`; writing through
    // AuthStorage keeps the CLI and omp-web on the same store and lock.
    await authStorage.set(provider, { type: "api_key", key: apiKey.trim(), source: "login" });
    invalidateModelsCache();
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// DELETE /api/auth/api-key/[provider] — removes stored API keys
export async function DELETE(_req: Request, { params }: Params) {
  const { provider } = await params;
  try {
    const { authStorage } = await getOmpRuntime();
    const stored = authStorage.listStoredCredentials(provider);
    if (stored.some((entry) => entry.credential.type === "oauth")) {
      return NextResponse.json(
        { error: `${provider} is authenticated with OAuth, not an API key` },
        { status: 409 },
      );
    }
    await authStorage.remove(provider);
    invalidateModelsCache();
    invalidateOmpRuntime();
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
