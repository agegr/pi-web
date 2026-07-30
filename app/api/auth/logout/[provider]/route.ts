import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { invalidateModelsCache } from "@/lib/models-cache";
import { canRemoveCredential } from "@/lib/provider-listing";
import { getStoredCredentialType } from "@/lib/provider-listing-runtime";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;
  const modelRuntime = await ModelRuntime.create();
  if (!modelRuntime.getProvider(provider)?.auth.oauth) {
    return Response.json({ error: `Unknown provider: ${provider}` }, { status: 400 });
  }
  // A dual-auth provider holds one credential; never delete an API key here (#309).
  if (!canRemoveCredential(await getStoredCredentialType(modelRuntime, provider), "oauth")) {
    return Response.json({ error: `${provider} is authenticated with an API key, not OAuth` }, { status: 409 });
  }
  await modelRuntime.logout(provider);
  invalidateModelsCache();
  return Response.json({ ok: true });
}
