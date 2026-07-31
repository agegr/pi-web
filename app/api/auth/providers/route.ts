import { buildOAuthProviderList } from "@/lib/provider-listing";
import { collectProviderListingInputs } from "@/lib/provider-listing-runtime";

export const dynamic = "force-dynamic";

// Providers that declare an OAuth login method, including anthropic
// (Claude Pro/Max) — see lib/provider-listing.ts.
export async function GET() {
  const providers = buildOAuthProviderList(await collectProviderListingInputs());
  return Response.json({ providers });
}
