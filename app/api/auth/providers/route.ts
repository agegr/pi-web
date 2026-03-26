import { AuthStorage } from "@mariozechner/pi-coding-agent";

export const dynamic = "force-dynamic";

export async function GET() {
  const authStorage = AuthStorage.create();
  const providers = authStorage.getOAuthProviders();

  const EXCLUDED = new Set(["anthropic"]);
  const DISPLAY_NAMES: Record<string, string> = {
    "openai-codex": "ChatGPT Plus/Pro",
    "github-copilot": "GitHub Copilot",
    "google-gemini-cli": "Gemini CLI",
    "google-antigravity": "Antigravity",
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
