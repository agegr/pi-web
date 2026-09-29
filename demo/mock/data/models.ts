/**
 * Model catalog as a real Pi Web install reports it for this demo setup:
 * ChatGPT Plus/Pro (Codex) signed in with OAuth, DeepSeek with an API key and
 * a custom "Claude Gateway" provider from models.json. Captured from
 * GET /api/models and friends against the pi SDK, see mock/captured/.
 */
import modelsResponse from "../captured/models.json";
import enabledModelsResponse from "../captured/models-enabled.json";
import authProvidersResponse from "../captured/auth-providers.json";
import modelsConfigResponse from "../captured/models-config.json";

export const MODELS_RESPONSE = modelsResponse;
export const ENABLED_MODELS_RESPONSE = enabledModelsResponse;
export const AUTH_PROVIDERS_RESPONSE = authProvidersResponse;
export const MODELS_CONFIG = modelsConfigResponse as { providers: Record<string, Record<string, unknown>> };

/** Wire API each provider speaks (recorded on assistant messages). */
export const MODEL_API: Record<string, string> = {
  "openai-codex": "openai-codex-responses",
  deepseek: "openai-completions",
  "claude-gateway": "anthropic-messages",
};

/** USD per million tokens, from the pi model catalog and models.json. */
export const MODEL_PRICING: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  "openai-codex/gpt-5.3-codex-spark": { input: 1.75, output: 14, cacheRead: 0.175, cacheWrite: 0 },
  "openai-codex/gpt-5.5": { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 0 },
  "openai-codex/gpt-5.6-luna": { input: 0.2, output: 1.2, cacheRead: 0.02, cacheWrite: 0.25 },
  "openai-codex/gpt-5.6-sol": { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 6.25 },
  "openai-codex/gpt-5.6-terra": { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 2.5 },
  "openai-codex/gpt-6-astra": { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
  "deepseek/deepseek-flash": { input: 0.3, output: 1.2, cacheRead: 0.006, cacheWrite: 0 },
  "deepseek/deepseek-v4-pro": { input: 1.32, output: 3.96, cacheRead: 0.044, cacheWrite: 0 },
  "claude-gateway/claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-gateway/claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-gateway/claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
};

/** Context window per model, for the top-bar context meter. */
export const CONTEXT_WINDOWS: Record<string, number> = {
  "openai-codex/gpt-5.3-codex-spark": 128_000,
  "deepseek/deepseek-flash": 1_000_000,
  "deepseek/deepseek-v4-pro": 1_000_000,
  "claude-gateway/claude-opus-5": 1_000_000,
  "claude-gateway/claude-sonnet-5": 1_000_000,
  "claude-gateway/claude-haiku-4-5": 200_000,
};

export function contextWindowFor(provider: string, modelId: string): number {
  return CONTEXT_WINDOWS[`${provider}/${modelId}`] ?? 272_000;
}

export const DEFAULT_MODEL = { provider: "openai-codex", modelId: "gpt-5.5" };
export const DEFAULT_THINKING_LEVEL = "medium";

export function modelExists(provider: string, modelId: string): boolean {
  return MODELS_RESPONSE.modelList.some((model) => model.provider === provider && model.id === modelId);
}
