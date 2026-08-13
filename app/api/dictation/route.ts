import { NextResponse } from "next/server";
import { isApiRequestAllowed } from "@/lib/request-security";
import { parseFormDataWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_DICTATION_BYTES = 20 * 1024 * 1024;
const TRANSCRIPTION_TIMEOUT_MS = 60_000;
const SUPPORTED_AUDIO_TYPES = new Set([
  "audio/aac",
  "audio/flac",
  "audio/m4a",
  "audio/mp4",
  "audio/mpeg",
  "audio/ogg",
  "audio/opus",
  "audio/wav",
  "audio/webm",
  "audio/x-m4a",
  "audio/x-wav",
]);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Transcribe one browser-recorded audio segment through a configured Pi STT
 * provider. The provider is resolved server-side so browser clients never see
 * stored model credentials.
 */
export async function POST(request: Request) {
  if (!isApiRequestAllowed(request)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }

  let form: FormData;
  try {
    form = await parseFormDataWithinLimit(request, MAX_DICTATION_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ error: "Audio file is too large" }, { status: 413 });
    }
    return NextResponse.json({ error: "Invalid multipart request" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "Audio file is required" }, { status: 400 });
  }
  if (file.size > MAX_DICTATION_BYTES) {
    return NextResponse.json({ error: "Audio file is too large" }, { status: 413 });
  }
  const mediaType = file.type.split(";", 1)[0]?.trim().toLowerCase();
  if (!SUPPORTED_AUDIO_TYPES.has(mediaType)) {
    return NextResponse.json({ error: "Unsupported audio file type" }, { status: 415 });
  }

  try {
    const { resolveConfiguredProviderKey, transcribeAudio } = await import("@/lib/server-transcription");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TRANSCRIPTION_TIMEOUT_MS);
    try {
      const configuredProvider = process.env.PI_WEB_DICTATION_PROVIDER?.trim().toLowerCase() || "openai";
      if (configuredProvider !== "openai" && configuredProvider !== "groq") {
        return NextResponse.json({ error: "Unsupported dictation provider" }, { status: 503 });
      }
      const provider = configuredProvider;
      const apiKey = process.env.PI_WEB_DICTATION_API_KEY
        ?? await resolveConfiguredProviderKey(provider);
      const transcript = await transcribeAudio(file, controller.signal, {
        resolve: () => ({
          provider,
          model: process.env.PI_WEB_DICTATION_MODEL,
          endpoint: process.env.PI_WEB_DICTATION_ENDPOINT,
          apiKey,
        }),
      });
      return NextResponse.json({ ok: true, transcript });
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    const message = errorMessage(error);
    const unavailable = error instanceof Error && "code" in error && error.code === "unavailable";
    return NextResponse.json(
      { error: unavailable ? message : "Transcription failed" },
      { status: unavailable ? 503 : 500 },
    );
  }
}
