import { invalidateModelsCache } from "@/lib/models-cache";
import { getOmpRuntime, invalidateOmpRuntime } from "@/lib/omp-runtime";
import { resolveOAuthLoginId } from "@/lib/provider-listing-runtime";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;
  if (!resolveOAuthLoginId(provider)) {
    return Response.json({ error: `Unknown provider: ${provider}` }, { status: 400 });
  }

  const { authStorage } = await getOmpRuntime();
  const stored = authStorage.listStoredCredentials(provider);
  if (stored.length > 0 && !stored.some((entry) => entry.credential.type === "oauth")) {
    return Response.json({ error: `${provider} is authenticated with an API key, not OAuth` }, { status: 409 });
  }

  await authStorage.logout(provider);
  invalidateModelsCache();
  invalidateOmpRuntime();
  return Response.json({ ok: true });
}
