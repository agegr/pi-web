import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { getAuthenticatedSession } from "@/lib/pi-web-auth-route";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!getAuthenticatedSession(request).valid) return Response.json({ error: "未认证" }, { status: 401 });
  const modelRuntime = await ModelRuntime.create();
  const credentials = await modelRuntime.listCredentials();
  const loggedInProviders = new Set(
    credentials.filter((credential) => credential.type === "oauth").map((credential) => credential.providerId),
  );
  const providers = modelRuntime.getProviders().filter((provider) => provider.auth.oauth);

  const EXCLUDED = new Set(["anthropic"]);
  const DISPLAY_NAMES: Record<string, string> = {
    "openai-codex": "ChatGPT Plus/Pro",
    "github-copilot": "GitHub Copilot",
  };

  const result = await Promise.all(
    providers
      .filter((p) => !EXCLUDED.has(p.id))
      .map(async (p) => {
        return {
          id: p.id,
          name: DISPLAY_NAMES[p.id] ?? p.name,
          usesCallbackServer: false,
          loggedIn: loggedInProviders.has(p.id),
        };
      })
  );

  return Response.json({ providers: result });
}
