import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { NextResponse } from "next/server";
import { invalidateModelsCache } from "@/lib/models-cache";
import { getAuthenticatedSession, readAuthJson } from "@/lib/pi-web-auth-route";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ provider: string }> };

// GET /api/auth/api-key/[provider] — returns auth status (never returns the actual key)
export async function GET(_req: Request, { params }: Params) {
  if (!getAuthenticatedSession(_req).valid) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { provider } = await params;
  const modelRuntime = await ModelRuntime.create();
  const status = modelRuntime.getProviderAuthStatus(provider);
  const displayName = modelRuntime.getProvider(provider)?.name ?? provider;
  const models = modelRuntime.getModels(provider).length;
  return NextResponse.json({ provider, displayName, configured: status.configured, source: status.source, models });
}

// POST /api/auth/api-key/[provider]  body: { apiKey: string }
export async function POST(req: Request, { params }: Params) {
  if (!getAuthenticatedSession(req).valid) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { provider } = await params;
  try {
    const { apiKey } = await readAuthJson(req) as { apiKey?: string };
    if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
      return NextResponse.json({ error: "apiKey is required" }, { status: 400 });
    }
    const modelRuntime = await ModelRuntime.create();
    let keySubmitted = false;
    await modelRuntime.login(provider, "api_key", {
      notify: () => {},
      prompt: async (prompt) => {
        if (prompt.type === "select") {
          const keyOption = prompt.options.find((option) => option.id === "api-key" || option.id === "bearer-token");
          if (keyOption) return keyOption.id;
          throw new Error(`${provider} requires interactive authentication setup`);
        }
        if (!keySubmitted && prompt.type === "secret") {
          keySubmitted = true;
          return apiKey.trim();
        }
        throw new Error(`${provider} requires additional authentication settings`);
      },
    });
    invalidateModelsCache();
    return NextResponse.json({ success: true });
  } catch (error) {
    const status = (error as { status?: number }).status;
    return NextResponse.json({ error: status ? (error as Error).message : "Authentication configuration failed" }, { status: status ?? 500 });
  }
}

// DELETE /api/auth/api-key/[provider] — removes stored API key
export async function DELETE(_req: Request, { params }: Params) {
  if (!getAuthenticatedSession(_req).valid) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { provider } = await params;
  try {
    const modelRuntime = await ModelRuntime.create();
    await modelRuntime.logout(provider);
    invalidateModelsCache();
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
