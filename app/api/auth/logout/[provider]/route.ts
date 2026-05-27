import { AuthStorage } from "@earendil-works/pi-coding-agent";
import { assertTrustedRequest } from "@/app/api/_security/api-auth";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const blocked = assertTrustedRequest(req);
  if (blocked) return blocked;

  const { provider } = await params;
  const authStorage = AuthStorage.create();
  const providers = authStorage.getOAuthProviders();
  if (!providers.find((p) => p.id === provider)) {
    return Response.json({ error: `Unknown provider: ${provider}` }, { status: 400 });
  }
  authStorage.logout(provider);
  return Response.json({ ok: true });
}
