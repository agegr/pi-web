export interface ModelCatalogCost {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
}

export type CompleteModelCatalogCost = Required<ModelCatalogCost>;

export interface ModelCatalogEntry {
  key: string;
  providerId: string;
  providerName: string;
  providerBaseUrl?: string;
  id: string;
  name: string;
  reasoning?: boolean;
  input?: string[];
  contextWindow?: number;
  maxTokens?: number;
  cost: ModelCatalogCost;
}

export interface ModelCatalogPreset {
  name?: string;
  reasoning?: boolean;
  input?: string[];
  contextWindow?: number;
  maxTokens?: number;
  cost?: CompleteModelCatalogCost;
}

export type ModelCatalogMatchMethod = "provider" | "base-url" | "consensus" | "none";

export type ModelCatalogPriceRecommendation =
  | {
      status: "reliable";
      method: Exclude<ModelCatalogMatchMethod, "none">;
      cost: CompleteModelCatalogCost;
      providerId?: string;
      providerName?: string;
      support: number;
      total: number;
    }
  | {
      status: "unreliable";
      reason: "no-exact-match" | "no-valid-price" | "insufficient-support" | "conflict";
      support: number;
      total: number;
    };

export interface ModelCatalogRecommendation {
  exactMatches: number;
  metadataMethod: ModelCatalogMatchMethod;
  matchedProviderId?: string;
  matchedProviderName?: string;
  preset: ModelCatalogPreset;
  price: ModelCatalogPriceRecommendation;
}

const CONSENSUS_MIN_SHARE = 0.6;
const CONSENSUS_MIN_SUPPORT = 5;
const KNOWN_PROVIDER_HOSTS: Record<string, readonly string[]> = {
  anthropic: ["api.anthropic.com"],
  google: ["generativelanguage.googleapis.com"],
  openai: ["api.openai.com"],
  openrouter: ["openrouter.ai"],
};
const SUPPORTED_INPUT_MODALITIES = new Set(["text", "image"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalNonNegativeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function optionalPositiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function readCost(value: unknown): ModelCatalogCost {
  if (!isRecord(value)) return {};
  return {
    input: optionalNonNegativeNumber(value.input),
    output: optionalNonNegativeNumber(value.output),
    cacheRead: optionalNonNegativeNumber(value.cache_read),
    cacheWrite: optionalNonNegativeNumber(value.cache_write),
  };
}

function readInputModalities(value: unknown): string[] | undefined {
  if (!isRecord(value) || !Array.isArray(value.input)) return undefined;
  const input = Array.from(new Set(value.input
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim().toLocaleLowerCase())
    .filter((entry) => SUPPORTED_INPUT_MODALITIES.has(entry))));
  return input.length ? input : undefined;
}

function normalizeProvider(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeModelId(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/^models\//, "");
}

function hostname(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).hostname.toLocaleLowerCase().replace(/\.$/, "");
  } catch {
    return undefined;
  }
}

function hostMatches(actual: string, expected: string): boolean {
  return actual === expected || actual.endsWith(`.${expected}`);
}

function providerMatches(entry: ModelCatalogEntry, providerHint: string): boolean {
  const normalizedHint = normalizeProvider(providerHint);
  if (!normalizedHint) return false;
  return normalizeProvider(entry.providerId) === normalizedHint
    || normalizeProvider(entry.providerName) === normalizedHint;
}

function baseUrlMatches(entry: ModelCatalogEntry, baseUrl: string): boolean {
  const actualHost = hostname(baseUrl);
  if (!actualHost) return false;
  const knownHosts = KNOWN_PROVIDER_HOSTS[normalizeProvider(entry.providerId)] ?? [];
  const providerHost = hostname(entry.providerBaseUrl);
  return [...knownHosts, ...(providerHost ? [providerHost] : [])]
    .some((candidate) => hostMatches(actualHost, candidate));
}

function exactModelMatches(entry: ModelCatalogEntry, query: string): boolean {
  const normalizedQuery = normalizeModelId(query);
  if (!normalizedQuery) return false;
  const normalizedId = normalizeModelId(entry.id);
  const normalizedFullId = `${entry.providerId.toLocaleLowerCase()}/${normalizedId}`;
  return normalizedId === normalizedQuery || normalizedFullId === normalizedQuery;
}

function validPrice(entry: ModelCatalogEntry): entry is ModelCatalogEntry & {
  cost: ModelCatalogCost & { input: number; output: number };
} {
  return entry.cost.input !== undefined && entry.cost.output !== undefined;
}

function modeValue<T>(
  values: readonly T[],
  total: number,
  keyFor: (value: T) => string,
): T | undefined {
  if (values.length === 0 || total <= 0) return undefined;
  const groups = new Map<string, { value: T; count: number }>();
  for (const value of values) {
    const key = keyFor(value);
    const current = groups.get(key);
    if (current) current.count += 1;
    else groups.set(key, { value, count: 1 });
  }
  const ranked = [...groups.values()].sort((a, b) => b.count - a.count);
  const winner = ranked[0];
  if (!winner || winner.count / total < CONSENSUS_MIN_SHARE) return undefined;
  if (ranked[1]?.count === winner.count) return undefined;
  return winner.value;
}

function modeNumber(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const groups = new Map<number, number>();
  for (const value of values) groups.set(value, (groups.get(value) ?? 0) + 1);
  const ranked = [...groups.entries()].sort((a, b) => b[1] - a[1]);
  if (!ranked[0] || ranked[1]?.[1] === ranked[0][1]) return undefined;
  return ranked[0][0];
}

function metadataFromEntry(entry: ModelCatalogEntry): ModelCatalogPreset {
  return {
    name: entry.name,
    reasoning: entry.reasoning,
    input: entry.input,
    contextWindow: entry.contextWindow,
    maxTokens: entry.maxTokens,
  };
}

function consensusMetadata(entries: readonly ModelCatalogEntry[]): ModelCatalogPreset {
  const total = entries.length;
  return {
    name: modeValue(entries.map((entry) => entry.name), total, (value) => value.toLocaleLowerCase()),
    reasoning: modeValue(
      entries.flatMap((entry) => entry.reasoning === undefined ? [] : [entry.reasoning]),
      total,
      String,
    ),
    input: modeValue(
      entries.flatMap((entry) => entry.input ? [entry.input] : []),
      total,
      (value) => [...value].sort().join(","),
    ),
    contextWindow: modeValue(
      entries.flatMap((entry) => entry.contextWindow === undefined ? [] : [entry.contextWindow]),
      total,
      String,
    ),
    maxTokens: modeValue(
      entries.flatMap((entry) => entry.maxTokens === undefined ? [] : [entry.maxTokens]),
      total,
      String,
    ),
  };
}

function priceFromEntry(
  entry: ModelCatalogEntry & { cost: ModelCatalogCost & { input: number; output: number } },
  method: "provider" | "base-url",
): ModelCatalogPriceRecommendation {
  return {
    status: "reliable",
    method,
    cost: {
      input: entry.cost.input,
      output: entry.cost.output,
      cacheRead: entry.cost.cacheRead ?? 0,
      cacheWrite: entry.cost.cacheWrite ?? 0,
    },
    providerId: entry.providerId,
    providerName: entry.providerName,
    support: 1,
    total: 1,
  };
}

function consensusPrice(entries: readonly ModelCatalogEntry[]): ModelCatalogPriceRecommendation {
  const priced = entries.filter(validPrice);
  if (priced.length === 0) {
    return { status: "unreliable", reason: "no-valid-price", support: 0, total: 0 };
  }
  if (priced.length === 1) {
    return { status: "unreliable", reason: "insufficient-support", support: 1, total: 1 };
  }

  const groups = new Map<string, typeof priced>();
  for (const entry of priced) {
    const key = JSON.stringify([entry.cost.input, entry.cost.output]);
    const group = groups.get(key);
    if (group) group.push(entry);
    else groups.set(key, [entry]);
  }
  const ranked = [...groups.values()].sort((a, b) => b.length - a.length);
  const winner = ranked[0];
  if (!winner) {
    return { status: "unreliable", reason: "no-valid-price", support: 0, total: priced.length };
  }
  const hasConsensus = winner.length / priced.length >= CONSENSUS_MIN_SHARE
    || winner.length >= CONSENSUS_MIN_SUPPORT;
  if (ranked[1]?.length === winner.length || !hasConsensus) {
    return {
      status: "unreliable",
      reason: "conflict",
      support: winner.length,
      total: priced.length,
    };
  }

  const cacheRead = modeNumber(winner.map((entry) => entry.cost.cacheRead ?? 0)) ?? 0;
  const cacheWrite = modeNumber(winner.map((entry) => entry.cost.cacheWrite ?? 0)) ?? 0;
  return {
    status: "reliable",
    method: "consensus",
    cost: {
      input: winner[0].cost.input,
      output: winner[0].cost.output,
      cacheRead,
      cacheWrite,
    },
    support: winner.length,
    total: priced.length,
  };
}

export function flattenModelsDevCatalog(value: unknown): ModelCatalogEntry[] {
  if (!isRecord(value)) return [];

  const entries: ModelCatalogEntry[] = [];
  for (const [providerId, rawProvider] of Object.entries(value)) {
    if (!isRecord(rawProvider) || !isRecord(rawProvider.models)) continue;
    const providerName = cleanString(rawProvider.name) ?? providerId;
    const providerBaseUrl = cleanString(rawProvider.api);

    for (const [fallbackId, rawModel] of Object.entries(rawProvider.models)) {
      if (!isRecord(rawModel)) continue;
      const id = cleanString(rawModel.id) ?? fallbackId;
      if (!id) continue;
      const name = cleanString(rawModel.name) ?? id;
      const entry: ModelCatalogEntry = {
        key: `${providerId}/${id}`,
        providerId,
        providerName,
        id,
        name,
        cost: readCost(rawModel.cost),
      };
      if (providerBaseUrl) entry.providerBaseUrl = providerBaseUrl;
      if (typeof rawModel.reasoning === "boolean") entry.reasoning = rawModel.reasoning;
      const input = readInputModalities(rawModel.modalities);
      if (input) entry.input = input;
      if (isRecord(rawModel.limit)) {
        const contextWindow = optionalPositiveNumber(rawModel.limit.context);
        const maxTokens = optionalPositiveNumber(rawModel.limit.output);
        if (contextWindow !== undefined) entry.contextWindow = contextWindow;
        if (maxTokens !== undefined) entry.maxTokens = maxTokens;
      }
      entries.push(entry);
    }
  }

  return entries;
}

export function recommendModelCatalogPreset(
  entries: readonly ModelCatalogEntry[],
  query: string,
  providerHint = "",
  baseUrl = "",
): ModelCatalogRecommendation {
  const exactEntries = entries.filter((entry) => exactModelMatches(entry, query));
  if (exactEntries.length === 0) {
    return {
      exactMatches: 0,
      metadataMethod: "none",
      preset: {},
      price: { status: "unreliable", reason: "no-exact-match", support: 0, total: 0 },
    };
  }

  const providerEntries = exactEntries.filter((entry) => providerMatches(entry, providerHint));
  const baseUrlEntries = exactEntries.filter((entry) => baseUrlMatches(entry, baseUrl));
  const metadataEntry = providerEntries[0] ?? baseUrlEntries[0];
  const metadataMethod: ModelCatalogMatchMethod = providerEntries.length
    ? "provider"
    : baseUrlEntries.length
      ? "base-url"
      : "consensus";
  const preset = metadataEntry ? metadataFromEntry(metadataEntry) : consensusMetadata(exactEntries);

  const providerPrice = providerEntries.find(validPrice);
  const baseUrlPrice = baseUrlEntries.find(validPrice);
  const price = providerPrice
    ? priceFromEntry(providerPrice, "provider")
    : baseUrlPrice
      ? priceFromEntry(baseUrlPrice, "base-url")
      : consensusPrice(exactEntries);
  if (price.status === "reliable") preset.cost = price.cost;

  return {
    exactMatches: exactEntries.length,
    metadataMethod,
    matchedProviderId: metadataEntry?.providerId,
    matchedProviderName: metadataEntry?.providerName,
    preset,
    price,
  };
}

function matchRank(entry: ModelCatalogEntry, query: string, providerHint: string): number {
  const id = entry.id.toLocaleLowerCase();
  const name = entry.name.toLocaleLowerCase();
  const providerId = entry.providerId.toLocaleLowerCase();
  const providerName = entry.providerName.toLocaleLowerCase();
  const fullId = `${providerId}/${id}`;

  let rank = 20;
  if (!query) rank = 10;
  else if (id === query || fullId === query) rank = 0;
  else if (name === query) rank = 1;
  else if (id.startsWith(query) || name.startsWith(query)) rank = 2;
  else if (fullId.startsWith(query) || providerId === query || providerName === query) rank = 3;
  else if (id.includes(query) || name.includes(query)) rank = 4;
  else if (fullId.includes(query) || providerName.includes(query)) rank = 5;

  if (rank < 20 && providerHint && (providerId === providerHint || providerName === providerHint)) rank -= 0.5;
  return rank;
}

export function searchModelCatalog(
  entries: readonly ModelCatalogEntry[],
  query: string,
  providerHint = "",
  limit = 50,
): ModelCatalogEntry[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const normalizedProvider = providerHint.trim().toLocaleLowerCase();
  const cappedLimit = Math.max(1, Math.min(100, Math.floor(limit) || 50));

  return entries
    .map((entry) => ({ entry, rank: matchRank(entry, normalizedQuery, normalizedProvider) }))
    .filter(({ rank }) => !normalizedQuery || rank < 20)
    .sort((a, b) => a.rank - b.rank
      || a.entry.providerName.localeCompare(b.entry.providerName, undefined, { sensitivity: "base" })
      || a.entry.name.localeCompare(b.entry.name, undefined, { numeric: true, sensitivity: "base" })
      || a.entry.id.localeCompare(b.entry.id, undefined, { numeric: true, sensitivity: "base" }))
    .slice(0, cappedLimit)
    .map(({ entry }) => entry);
}
