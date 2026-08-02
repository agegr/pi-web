import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { buildOAuthProviderList } from "@/lib/provider-listing";
import { collectProviderListingInputs } from "@/lib/provider-listing-runtime";

export const dynamic = "force-dynamic";

// Providers that declare an OAuth login method, including anthropic
// (Claude Pro/Max) — see lib/provider-listing.ts (#309).
export async function GET() {
  const modelRuntime = await ModelRuntime.create();
  const providers = buildOAuthProviderList(await collectProviderListingInputs(modelRuntime));
  return Response.json({ providers });
}
