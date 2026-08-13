import { randomUUID } from "node:crypto";
export class TranscriptionUnavailableError extends Error {
  readonly code = "unavailable" as const;

  constructor(message = "Speech-to-text is not configured") {
    super(message);
  }
}

export interface TranscriptionConfig {
  provider?: "openai" | "groq";
  model?: string;
  apiKey?: string;
  endpoint?: string;
}

export interface TranscriptionResolver {
  resolve: () => Promise<TranscriptionConfig> | TranscriptionConfig;
}

function envValue(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

function readConfig(): TranscriptionConfig {
  // Configuration is intentionally environment-first for the prototype. A
  // future settings panel can persist this file after its schema is reviewed.
  const providerValue = envValue("PI_WEB_DICTATION_PROVIDER") ?? "openai";
  const provider = providerValue === "groq" || providerValue === "openai" ? providerValue : undefined;
  return {
    provider,
    model: envValue("PI_WEB_DICTATION_MODEL"),
    apiKey: envValue("PI_WEB_DICTATION_API_KEY", "OPENAI_API_KEY", "GROQ_API_KEY"),
    endpoint: envValue("PI_WEB_DICTATION_ENDPOINT"),
  };
}

function providerEndpoint(config: TranscriptionConfig): string {
  if (config.endpoint) return config.endpoint.replace(/\/$/, "") + "/audio/transcriptions";
  return config.provider === "groq"
    ? "https://api.groq.com/openai/v1/audio/transcriptions"
    : "https://api.openai.com/v1/audio/transcriptions";
}

function providerApiKey(config: TranscriptionConfig): string | undefined {
  return config.apiKey ?? (config.provider === "groq" ? process.env.GROQ_API_KEY : process.env.OPENAI_API_KEY);
}

/** Resolve a configured Pi provider key without exposing it to the browser. */
export async function resolveConfiguredProviderKey(
  provider: "openai" | "groq" = "openai",
): Promise<string | undefined> {
  const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");
  const runtime = await ModelRuntime.create({ refreshOnCreate: false });
  return (await runtime.getAuth(provider))?.auth.apiKey;
}

/**
 * Sends an audio file to an OpenAI-compatible transcription endpoint. This is
 * deliberately a small server adapter; provider selection can move to Pi's
 * credential/runtime APIs once the prototype's endpoint contract stabilizes.
 */
export async function transcribeAudio(
  file: File,
  signal?: AbortSignal,
  resolver?: TranscriptionResolver,
): Promise<string> {
  const config = resolver ? await resolver.resolve() : readConfig();
  if (config.provider !== "openai" && config.provider !== "groq") {
    throw new TranscriptionUnavailableError("Speech-to-text provider is not configured");
  }
  const apiKey = providerApiKey(config);
  if (!apiKey) throw new TranscriptionUnavailableError();

  const form = new FormData();
  form.append("file", file, file.name || `dictation-${randomUUID()}.webm`);
  const defaultModel = config.provider === "groq" ? "whisper-large-v3-turbo" : "gpt-4o-mini-transcribe";
  form.append("model", config.model ?? defaultModel);
  const response = await fetch(providerEndpoint(config), {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal,
  });
  const data = await response.json().catch(() => ({})) as { text?: unknown; error?: { message?: unknown } };
  if (!response.ok) {
    throw new Error(typeof data.error?.message === "string" ? data.error.message : `Transcription provider returned ${response.status}`);
  }
  if (typeof data.text !== "string") throw new Error("Transcription provider returned no text");
  return data.text.trim();
}
