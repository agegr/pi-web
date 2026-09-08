import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { invalidateModelsCache } from "@/lib/models-cache";
import { removeStoredCredentialIfType } from "@/lib/provider-credential-store";
import { syncAllowlistStandalone } from "@/lib/allowlist-backfill";

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
  const removal = await removeStoredCredentialIfType(provider, "oauth");
  if (removal.status === "type_mismatch") {
    return Response.json({ error: `${provider} is authenticated with an API key, not OAuth` }, { status: 409 });
  }
  invalidateModelsCache();
  // The provider's models are gone now; drop its stale allowlist entries
  // so the resolver stops reporting "No models match pattern" (#727).
  try {
    await syncAllowlistStandalone(process.cwd(), AbortSignal.timeout(10_000));
  } catch {
    // Never fail the logout because the allowlist sync hiccapped.
  }
  return Response.json({ ok: true });
}
