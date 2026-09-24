/**
 * Fields commonly used by upstream `/models` endpoints to expose context window and
 * max output token limits. Providers spell these differently (snake_case top level,
 * nested under `metadata` / `limits` / `capabilities`, or camelCase), so every known
 * spelling is checked. Only positive integers are accepted so garbage upstream values
 * never overwrite a good configuration.
 */
const CONTEXT_WINDOW_KEYS = [
  "context_window",
  "contextWindow",
  "context_length",
  "contextLength",
  "max_context_tokens",
  "maxContextTokens",
  "limit_context",
] as const;

const MAX_OUTPUT_TOKEN_KEYS = [
  "max_tokens",
  "maxTokens",
  "max_output_tokens",
  "maxOutputTokens",
  "max_completion_tokens",
  "maxCompletionTokens",
] as const;

export interface DiscoveredModel {
  id: string;
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readLimit(value: unknown): number | undefined {
  if (typeof value === "string" && value.trim() && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    return parsed > 0 ? parsed : undefined;
  }
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function pickLimit(source: Record<string, unknown>, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const value = readLimit(source[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function readSpecs(value: unknown, depth = 0): { contextWindow?: number; maxTokens?: number } {
  const specs: { contextWindow?: number; maxTokens?: number } = {};
  if (!isRecord(value)) return specs;

  const contextWindow = pickLimit(value, CONTEXT_WINDOW_KEYS);
  if (contextWindow !== undefined) specs.contextWindow = contextWindow;

  const maxTokens = pickLimit(value, MAX_OUTPUT_TOKEN_KEYS);
  if (maxTokens !== undefined) specs.maxTokens = maxTokens;

  if (depth >= 2) return specs;

  // Gateways nest the limits one level down, e.g. `metadata.limits.context_window`,
  // `top_provider.context_length`, `capabilities.limits.max_tokens`.
  for (const nestedKey of ["metadata", "limits", "limit", "capabilities", "top_provider"]) {
    if (specs.contextWindow !== undefined && specs.maxTokens !== undefined) break;
    const nested = readSpecs(value[nestedKey], depth + 1);
    if (specs.contextWindow === undefined && nested.contextWindow !== undefined) {
      specs.contextWindow = nested.contextWindow;
    }
    if (specs.maxTokens === undefined && nested.maxTokens !== undefined) {
      specs.maxTokens = nested.maxTokens;
    }
  }

  return specs;
}

function modelFromValue(value: unknown): DiscoveredModel | null {
  if (typeof value === "string") {
    const id = value.trim();
    return id ? { id } : null;
  }
  if (!isRecord(value)) return null;

  const rawId = cleanString(value.id) ?? cleanString(value.model) ?? cleanString(value.name);
  if (!rawId) return null;
  const id = rawId.startsWith("models/") ? rawId.slice("models/".length) : rawId;
  if (!id) return null;
  const name = cleanString(value.display_name)
    ?? cleanString(value.displayName)
    ?? (cleanString(value.id) || cleanString(value.model) ? cleanString(value.name) : undefined);

  const specs = readSpecs(value);
  const discovered: DiscoveredModel = { id };
  if (name && name !== id) discovered.name = name;
  if (specs.contextWindow !== undefined) discovered.contextWindow = specs.contextWindow;
  if (specs.maxTokens !== undefined) discovered.maxTokens = specs.maxTokens;
  return discovered;
}

function listFromResponse(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return [];
  for (const key of ["data", "models", "results", "items"]) {
    const candidate = value[key];
    if (Array.isArray(candidate)) return candidate;
    if (isRecord(candidate)) return Object.values(candidate);
  }
  return [];
}

export function parseDiscoveredModels(value: unknown): DiscoveredModel[] {
  const seen = new Set<string>();
  const models: DiscoveredModel[] = [];
  for (const item of listFromResponse(value)) {
    const model = modelFromValue(item);
    if (!model || seen.has(model.id)) continue;
    seen.add(model.id);
    models.push(model);
  }
  return models.sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id, undefined, {
    numeric: true,
    sensitivity: "base",
  }));
}

export function buildModelsListUrl(baseUrl: string, api: string): URL {
  const url = new URL(baseUrl.trim());
  const trimmedPath = url.pathname.replace(/\/+$/, "");

  if (!/\/models$/i.test(trimmedPath)) {
    let path = trimmedPath;
    if (api === "anthropic-messages" && !/\/v\d+(?:beta)?$/i.test(path)) path += "/v1";
    if (api === "google-generative-ai" && !/\/v\d+(?:beta)?$/i.test(path)) path += "/v1beta";
    url.pathname = `${path}/models`.replace(/\/+/g, "/");
  }

  if (api === "anthropic-messages" && !url.searchParams.has("limit")) {
    url.searchParams.set("limit", "1000");
  }
  if (api === "google-generative-ai" && !url.searchParams.has("pageSize")) {
    url.searchParams.set("pageSize", "1000");
  }
  return url;
}
