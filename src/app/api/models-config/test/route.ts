import { NextResponse } from "next/server";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { completeSimple, type AssistantMessage } from "@earendil-works/pi-ai";
import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";

export const dynamic = "force-dynamic";

const TEST_TIMEOUT_MS = 20_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getAssistantText(message: AssistantMessage): string {
  return message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
}

export async function POST(req: Request) {
  let tempDir: string | undefined;

  try {
    const body = await req.json() as { providerName?: unknown; provider?: unknown; model?: unknown };
    const providerName = typeof body.providerName === "string" ? body.providerName.trim() : "";
    if (!providerName) return NextResponse.json({ ok: false, error: "providerName is required" }, { status: 400 });
    if (!isRecord(body.provider)) return NextResponse.json({ ok: false, error: "provider is required" }, { status: 400 });
    if (!isRecord(body.model)) return NextResponse.json({ ok: false, error: "model is required" }, { status: 400 });

    const modelId = typeof body.model.id === "string" ? body.model.id.trim() : "";
    if (!modelId) return NextResponse.json({ ok: false, error: "Model ID is required" }, { status: 400 });

    tempDir = mkdtempSync(join(tmpdir(), "pi-web-model-test-"));
    const modelsPath = join(tempDir, "models.json");
    writeFileSync(modelsPath, JSON.stringify({
      providers: {
        [providerName]: {
          ...body.provider,
          models: [{ ...body.model, id: modelId }],
        },
      },
    }, null, 2), "utf8");

    const registry = ModelRegistry.create(AuthStorage.create(), modelsPath);
    const loadError = registry.getError();
    if (loadError) return NextResponse.json({ ok: false, error: loadError });

    const model = registry.find(providerName, modelId);
    if (!model) return NextResponse.json({ ok: false, error: `Model not found: ${providerName}/${modelId}` });

    const auth = await registry.getApiKeyAndHeaders(model);
    if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error });
    if (!auth.apiKey) return NextResponse.json({ ok: false, error: `No API key found for "${providerName}"` });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);
    let status: number | undefined;
    const startedAt = Date.now();

    try {
      const message = await completeSimple(model, {
        messages: [{
          role: "user",
          content: "Reply with OK only.",
          timestamp: Date.now(),
        }],
      }, {
        apiKey: auth.apiKey,
        headers: auth.headers,
        maxTokens: 16,
        timeoutMs: TEST_TIMEOUT_MS,
        maxRetries: 0,
        cacheRetention: "none",
        signal: controller.signal,
        onResponse: (response) => { status = response.status; },
      });

      const latencyMs = Date.now() - startedAt;
      if (message.stopReason === "error" || message.stopReason === "aborted") {
        return NextResponse.json({
          ok: false,
          error: message.errorMessage ?? (controller.signal.aborted ? "Test timed out" : "Model returned an error"),
          latencyMs,
          status,
        });
      }

      return NextResponse.json({
        ok: true,
        latencyMs,
        status,
        responseText: getAssistantText(message).slice(0, 300),
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    return NextResponse.json({ ok: false, error: errorMessage(error) }, { status: 500 });
  } finally {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  }
}
