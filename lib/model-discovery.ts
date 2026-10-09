const EFFORT_LEVELS = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;
type EffortLevel = typeof EFFORT_LEVELS[number];

export interface DiscoveredModel {
  id: string;
  name?: string;
  // Capabilities the upstream list publishes, as models.json fields (#856).
  reasoning?: true;
  thinkingLevelMap?: Partial<Record<EffortLevel, string | null>>;
  contextWindow?: number;
  maxTokens?: number;
}

// Only fields whose meaning does not vary between gateways. `max_tokens` is
// left out: LiteLLM, for one, fills it with either the input or output limit.
const CONTEXT_WINDOW_FIELDS = [
  "context_length", "contextLength", "context_window", "contextWindow",
  "max_model_len", "max_input_tokens", "inputTokenLimit",
];
const MAX_TOKENS_FIELDS = ["max_output_tokens", "maxOutputTokens", "max_completion_tokens", "outputTokenLimit"];
const REASONING_FIELDS = ["supports_reasoning", "supportsReasoning", "reasoning", "thinking"];
const EFFORT_LIST_FIELDS = ["supported_efforts", "supportedEfforts"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function firstPositiveInteger(value: Record<string, unknown>, fields: readonly string[]): number | undefined {
  for (const field of fields) {
    const raw = value[field];
    const number = typeof raw === "string" && /^\d+$/.test(raw.trim()) ? Number(raw) : raw;
    if (typeof number === "number" && Number.isSafeInteger(number) && number > 0) return number;
  }
  return undefined;
}

/**
 * An advertised effort list names pi's own levels, which pi sends as the
 * effort when thinkingLevelMap has no entry. Every level it leaves out is
 * marked unsupported (null), and `xhigh` / `max` need an entry to be offered at
 * all. `off` stays unmapped: the list does not say whether thinking can be
 * turned off. A list naming none of pi's levels maps nothing.
 */
function thinkingLevelMapFromEfforts(value: Record<string, unknown>): DiscoveredModel["thinkingLevelMap"] {
  const list = EFFORT_LIST_FIELDS.map((field) => value[field]).find(Array.isArray);
  if (!list) return undefined;
  const advertised = new Set(list.filter((effort): effort is string => typeof effort === "string"));
  if (!EFFORT_LEVELS.some((level) => advertised.has(level))) return undefined;
  const map: NonNullable<DiscoveredModel["thinkingLevelMap"]> = {};
  for (const level of EFFORT_LEVELS) {
    if (!advertised.has(level)) map[level] = null;
    else if (level === "xhigh" || level === "max") map[level] = level;
  }
  return map;
}

function capabilitiesFromValue(value: Record<string, unknown>): Omit<DiscoveredModel, "id" | "name"> {
  const reasoning = REASONING_FIELDS.some((field) => value[field] === true);
  const thinkingLevelMap = reasoning ? thinkingLevelMapFromEfforts(value) : undefined;
  const contextWindow = firstPositiveInteger(value, CONTEXT_WINDOW_FIELDS);
  const maxTokens = firstPositiveInteger(value, MAX_TOKENS_FIELDS);
  return {
    ...(reasoning ? { reasoning: true } : {}),
    ...(thinkingLevelMap ? { thinkingLevelMap } : {}),
    ...(contextWindow ? { contextWindow } : {}),
    ...(maxTokens ? { maxTokens } : {}),
  };
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
  return { id, ...(name && name !== id ? { name } : {}), ...capabilitiesFromValue(value) };
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
