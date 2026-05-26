import { NextResponse } from "next/server";
import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import type { Context } from "@earendil-works/pi-ai";
import { getApiProvider } from "@earendil-works/pi-ai";

export const dynamic = "force-dynamic";

// POST /api/test-connection
// body: { provider: string, modelId: string }
// Sends a minimal "Hi" prompt to verify the model connection works.
export async function POST(req: Request) {
  try {
    const { provider, modelId } = (await req.json()) as { provider?: string; modelId?: string };
    if (!provider || !modelId) {
      return NextResponse.json({ ok: false, error: "provider and modelId are required" }, { status: 400 });
    }

    const authStorage = AuthStorage.create();
    const registry = ModelRegistry.create(authStorage);
    const model = registry.find(provider, modelId);
    if (!model) {
      return NextResponse.json({ ok: false, error: `Model not found: ${provider}/${modelId}` }, { status: 404 });
    }

    // Check if auth is configured
    const authResult = await registry.getApiKeyAndHeaders(model);
    if (!authResult.ok) {
      return NextResponse.json({ ok: false, error: authResult.error });
    }

    // Resolve the stream function for this model's API type
    const apiProvider = getApiProvider(model.api);
    if (!apiProvider) {
      return NextResponse.json({ ok: false, error: `No API provider registered for API type: ${model.api}` });
    }
    const streamFn = apiProvider.stream;

    // Build a minimal context
    const context: Context = {
      systemPrompt: "Respond with exactly: OK",
      messages: [
        {
          role: "user",
          content: "Say OK",
          timestamp: Date.now(),
        },
      ],
    };

    const options = {
      apiKey: authResult.apiKey,
      headers: authResult.headers,
      maxTokens: 10,
      timeoutMs: 15_000,
    };

    const stream = streamFn(model, context, options);

    // EventStream is an AsyncIterable — use for-await-of
    let textReceived = "";
    const deadline = Date.now() + 15_000;

    for await (const event of stream) {
      if (Date.now() > deadline) {
        return NextResponse.json({ ok: false, error: "Connection timed out (15s)" });
      }

      if (event.type === "text_delta") {
        textReceived += (event as { type: "text_delta"; delta: string }).delta;
      }

      if (event.type === "done") {
        const e = event as { type: "done"; message?: { usage?: { input: number; output: number } } };
        return NextResponse.json({
          ok: true,
          response: textReceived.trim() || "(empty response)",
          usage: e.message?.usage ?? null,
        });
      }

      if (event.type === "error") {
        const e = event as { type: "error"; error?: { message?: string }; message?: { errorMessage?: string } };
        const errMsg = e.message?.errorMessage
          || (e.error as Error | undefined)?.message
          || "Unknown error";
        return NextResponse.json({ ok: false, error: errMsg });
      }
    }

    // Stream ended without done/error
    return NextResponse.json({ ok: true, response: textReceived.trim() || "(stream ended)" });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
