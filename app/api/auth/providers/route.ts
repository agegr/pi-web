import { AuthStorage } from "@earendil-works/pi-coding-agent";
import { assertTrustedRequest } from "@/app/api/_security/api-auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const blocked = assertTrustedRequest(req);
  if (blocked) return blocked;

  const authStorage = AuthStorage.create();
  const providers = authStorage.getOAuthProviders();

  const EXCLUDED = new Set(["anthropic"]);
  const DISPLAY_NAMES: Record<string, string> = {
    "openai-codex": "ChatGPT Plus/Pro",
    "github-copilot": "GitHub Copilot",
  };

  const result = await Promise.all(
    providers
      .filter((p) => !EXCLUDED.has(p.id))
      .map(async (p) => {
        const loggedIn = authStorage.has(p.id);
        return {
          id: p.id,
          name: DISPLAY_NAMES[p.id] ?? p.name,
          usesCallbackServer: p.usesCallbackServer ?? false,
          loggedIn,
        };
      })
  );

  return Response.json({ providers: result });
}
