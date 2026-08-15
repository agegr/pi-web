import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import {
  readStoredVisionApiKey,
  readVisionToolkitSnapshot,
  validateApiKey,
  writeVisionToolkitSettings,
  type VisionProtocol,
  type VisionToolkitSettings,
} from "@/lib/vision-toolkit-config";

export const dynamic = "force-dynamic";

const PROTOCOLS = new Set<VisionProtocol>(["chat_completions", "responses", "anthropic"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function redactVisionError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const secret = readStoredVisionApiKey();
  return secret ? message.split(secret).join("<redacted>") : message;
}

function parseSettings(body: unknown): { settings: VisionToolkitSettings; apiKey?: string } | { error: string } {
  if (!isRecord(body)) return { error: "Settings object is required" };

  if (!PROTOCOLS.has(body.protocol as VisionProtocol)) {
    return { error: "protocol must be chat_completions, responses, or anthropic" };
  }
  if (typeof body.baseUrl !== "string") return { error: "baseUrl must be a string" };
  if (typeof body.model !== "string") return { error: "model must be a string" };
  if (body.language !== "zh" && body.language !== "en" && body.language !== "") {
    return { error: "language must be zh, en, or empty" };
  }

  let apiKey: string | undefined;
  if (body.apiKey !== undefined) {
    if (typeof body.apiKey !== "string") return { error: "apiKey must be a string" };
    const invalid = validateApiKey(body.apiKey);
    if (invalid) return { error: invalid };
    apiKey = body.apiKey;
  }

  return {
    settings: {
      protocol: body.protocol as VisionProtocol,
      baseUrl: body.baseUrl,
      model: body.model,
      language: body.language,
    },
    apiKey,
  };
}

export async function GET(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return Response.json({ error: "Untrusted API request" }, { status: 403 });
  }
  return Response.json(readVisionToolkitSnapshot());
}

export async function PUT(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return Response.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return Response.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  try {
    const parsed = parseSettings(await req.json());
    if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400 });
    const snapshot = writeVisionToolkitSettings(parsed.settings, parsed.apiKey);
    return Response.json(snapshot);
  } catch (error) {
    return Response.json({ error: redactVisionError(error) }, { status: 500 });
  }
}
