/** Cursor 模型目录：兜底列表、思考档位合并与价格信息。 */

import rawFallbackModels from "./cursor-models-raw.json";

export interface CursorModel {
  id: string;
  name: string;
  reasoning: boolean;
  contextWindow: number;
  maxTokens: number;
}

export function inferContextWindow(id: string): number {
  const lower = id.toLowerCase();
  if (lower.includes("-1m")) return 1_048_576;
  if (/claude-4\.[56]-/.test(lower)) return 1_048_576;
  if (lower.includes("claude-")) return 200_000;
  if (lower.includes("gemini-")) return 1_048_576;
  if (/gpt-[0-9.]*-(nano|mini)/.test(lower)) return 128_000;
  if (/gpt-5\.[456]/.test(lower)) return 1_048_576;
  if (lower.includes("gpt-")) return 400_000;
  if (lower.includes("grok-")) return 256_000;
  if (lower.includes("kimi-")) return 262_144;
  return 200_000;
}

/** 独立 thinking SKU，不应当作思考档位后缀合并。 */
function isThinkingVariantId(id: string): boolean {
  return /(^|-)thinking(-|$)/i.test(id);
}

export interface ModelCost {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface ProcessedCursorModel extends CursorModel {
  supportsEffort: boolean;
  availableEfforts?: string[];
}

/** 将带档位后缀的同族模型合并为一个模型选择项。 */
const CURSOR_FAMILY_EFFORTS: Array<{ test: RegExp; efforts: string[] }> = [
  { test: /(^|-)grok-4\.6(-fast)?$/i, efforts: ["low", "medium", "high", "xhigh"] },
  { test: /(^|-)grok-4\.5(-fast)?$/i, efforts: ["low", "medium", "high"] },
  { test: /(^|-)gpt-5\.6-(luna|sol|terra)(-fast)?$/i, efforts: ["none", "low", "medium", "high", "xhigh", "max"] },
  { test: /(^|-)gemini-3\.6-flash$/i, efforts: ["minimal", "low", "medium", "high"] },
  { test: /(^|-)gemini-3\.7-flash$/i, efforts: ["low", "medium", "high"] },
  { test: /(^|-)glm-5\.2$/i, efforts: ["high", "max"] },
];

const MODEL_COST_TABLE: Record<string, ModelCost> = {
  "claude-4-sonnet": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  "claude-4.5-haiku": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  "claude-4.5-opus": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-4.5-sonnet": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  "claude-4.6-opus": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-4.6-sonnet": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  "claude-4.7-opus": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-4.8-opus": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "composer-1": { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
  "composer-1.5": { input: 3.5, output: 17.5, cacheRead: 0.35, cacheWrite: 0 },
  "composer-2": { input: 0.5, output: 2.5, cacheRead: 0.2, cacheWrite: 0 },
  "gemini-2.5-flash": { input: 0.3, output: 2.5, cacheRead: 0.03, cacheWrite: 0 },
  "gemini-3-flash": { input: 0.5, output: 3, cacheRead: 0.05, cacheWrite: 0 },
  "gemini-3-pro": { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 0 },
  "gemini-3.1-pro": { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 0 },
  "gpt-5": { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
  "gpt-5-mini": { input: 0.25, output: 2, cacheRead: 0.025, cacheWrite: 0 },
  "gpt-5.4": { input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: 0 },
  "gpt-5.4-mini": { input: 0.75, output: 4.5, cacheRead: 0.075, cacheWrite: 0 },
  "gpt-5.4-nano": { input: 0.2, output: 1.25, cacheRead: 0.02, cacheWrite: 0 },
  "gpt-5.5": { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 0 },
  "gpt-5.6": { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 0 },
  "grok-4-20": { input: 2, output: 6, cacheRead: 0.2, cacheWrite: 0 },
  "grok-4.20": { input: 2, output: 6, cacheRead: 0.2, cacheWrite: 0 },
  "grok-4.5": { input: 1.25, output: 2.5, cacheRead: 0.2, cacheWrite: 0 },
  "grok-4.6": { input: 1.25, output: 2.5, cacheRead: 0.2, cacheWrite: 0 },
  "kimi-k2.5": { input: 0.6, output: 3, cacheRead: 0.1, cacheWrite: 0 },
};

const MODEL_COST_PATTERNS: Array<{ match: (id: string) => boolean; cost: ModelCost }> = [
  { match: (id) => /claude.*opus.*fast/i.test(id), cost: { input: 30, output: 150, cacheRead: 3, cacheWrite: 37.5 } },
  { match: (id) => /claude.*opus/i.test(id), cost: MODEL_COST_TABLE["claude-4.6-opus"]! },
  { match: (id) => /claude.*haiku/i.test(id), cost: MODEL_COST_TABLE["claude-4.5-haiku"]! },
  { match: (id) => /claude.*sonnet/i.test(id), cost: MODEL_COST_TABLE["claude-4.6-sonnet"]! },
  { match: (id) => /composer/i.test(id), cost: MODEL_COST_TABLE["composer-2"]! },
  { match: (id) => /gpt-5\.6/i.test(id), cost: MODEL_COST_TABLE["gpt-5.6"]! },
  { match: (id) => /gpt-5\.5/i.test(id), cost: MODEL_COST_TABLE["gpt-5.5"]! },
  { match: (id) => /gpt-5\.4.*nano/i.test(id), cost: MODEL_COST_TABLE["gpt-5.4-nano"]! },
  { match: (id) => /gpt-5\.4.*mini/i.test(id), cost: MODEL_COST_TABLE["gpt-5.4-mini"]! },
  { match: (id) => /gpt-5\.4/i.test(id), cost: MODEL_COST_TABLE["gpt-5.4"]! },
  { match: (id) => /gpt-5.*mini/i.test(id), cost: MODEL_COST_TABLE["gpt-5-mini"]! },
  { match: (id) => /gpt-5/i.test(id), cost: MODEL_COST_TABLE["gpt-5"]! },
  { match: (id) => /gemini.*flash/i.test(id), cost: MODEL_COST_TABLE["gemini-2.5-flash"]! },
  { match: (id) => /gemini/i.test(id), cost: MODEL_COST_TABLE["gemini-3-pro"]! },
  { match: (id) => /grok-4[.-]20/i.test(id), cost: MODEL_COST_TABLE["grok-4-20"]! },
  { match: (id) => /grok/i.test(id), cost: MODEL_COST_TABLE["grok-4.6"]! },
  { match: (id) => /kimi/i.test(id), cost: MODEL_COST_TABLE["kimi-k2.5"]! },
];

const DEFAULT_COST: ModelCost = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 0 };
const EFFORT_LEVELS = new Set(["none", "minimal", "low", "medium", "high", "xhigh", "max"]);
const EFFORT_ORDER = ["none", "minimal", "low", "", "medium", "high", "xhigh", "max"] as const;

export function estimateModelCost(modelId: string): ModelCost {
  const normalized = modelId.toLowerCase();
  const exact = MODEL_COST_TABLE[normalized];
  if (exact) return exact;
  const stripped = normalized.replace(/-(high|medium|low|preview|thinking|spark-preview|fast)$/g, "");
  return MODEL_COST_TABLE[stripped] ?? MODEL_COST_PATTERNS.find((p) => p.match(normalized))?.cost ?? DEFAULT_COST;
}

export function parseModelId(id: string): { base: string; effort: string; fast: boolean; thinking: boolean } {
  let remaining = id;
  let fast = false;
  let thinking = false;
  if (remaining.endsWith("-fast")) {
    fast = true;
    remaining = remaining.slice(0, -5);
  }
  if (remaining.endsWith("-thinking")) {
    thinking = true;
    remaining = remaining.slice(0, -9);
  }
  const lastDash = remaining.lastIndexOf("-");
  if (lastDash >= 0) {
    const suffix = remaining.slice(lastDash + 1);
    if (EFFORT_LEVELS.has(suffix)) {
      return { base: remaining.slice(0, lastDash), effort: suffix, fast, thinking };
    }
  }
  return { base: remaining, effort: "", fast, thinking };
}

function supportsReasoningModelId(id: string): boolean {
  const { base, effort, thinking } = parseModelId(id);
  if (effort || thinking || base === "default") return true;
  if (knownEffortsForModelId(id)) return true;
  return /(^|-)(claude|composer|gemini|gpt|grok|kimi)(-|$)/i.test(base);
}

function familyModelId(id: string): string {
  const parsed = parseModelId(id);
  let family = parsed.base;
  if (parsed.thinking) family += "-thinking";
  if (parsed.fast) family += "-fast";
  return family;
}

function knownEffortsForModelId(id: string): string[] | undefined {
  const family = familyModelId(id);
  return CURSOR_FAMILY_EFFORTS.find((entry) => entry.test.test(family))?.efforts;
}

function stripEffortFromName(name: string): string {
  return name
    .replace(/\s+(?:None|Minimal|Low|Medium|High|XHigh|Extra High|Max)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function defaultEffortForModelId(id: string): string | undefined {
  const known = knownEffortsForModelId(id);
  if (!known || known.length === 0) return undefined;
  if (known.includes("medium")) return "medium";
  if (known.includes("high")) return "high";
  return known[0];
}

/** 将思考档位插入合并后的模型 ID；Grok 4.6 默认使用 medium。 */
export function resolveCursorWireModelId(model: string, reasoningEffort?: string): string {
  const parsed = parseModelId(model);
  if (parsed.effort) return model;
  const effort = reasoningEffort?.trim() || defaultEffortForModelId(model);
  if (!effort) return model;
  let suffix = "";
  let base = model;
  if (base.endsWith("-fast")) {
    suffix = "-fast";
    base = base.slice(0, -5);
  } else if (base.endsWith("-thinking")) {
    suffix = "-thinking";
    base = base.slice(0, -9);
  }
  return `${base}-${effort}${suffix}`;
}

function familyIdFromGroup(group: { base: string; fast: boolean; thinking: boolean }): string {
  let id = group.base;
  if (group.thinking) id += "-thinking";
  if (group.fast) id += "-fast";
  return id;
}

export function processModels(raw: CursorModel[]): ProcessedCursorModel[] {
  const groups = new Map<string, {
    base: string;
    fast: boolean;
    thinking: boolean;
    efforts: Map<string, CursorModel>;
  }>();

  for (const model of raw) {
    if (isThinkingVariantId(model.id)) continue;
    const parsed = parseModelId(model.id);
    const key = `${parsed.base}|${parsed.fast}|${parsed.thinking}`;
    let group = groups.get(key);
    if (!group) {
      group = { base: parsed.base, fast: parsed.fast, thinking: parsed.thinking, efforts: new Map() };
      groups.set(key, group);
    }
    group.efforts.set(parsed.effort, model);
  }

  const result: ProcessedCursorModel[] = [];
  for (const group of groups.values()) {
    const id = familyIdFromGroup(group);
    if (knownEffortsForModelId(id)) {
      const representative = group.efforts.get("medium")
        ?? group.efforts.get("")
        ?? group.efforts.get("high")
        ?? [...group.efforts.values()][0]!;
      const availableEfforts = [...group.efforts.keys()].filter((effort) => effort !== "");
      result.push(applyKnownFamilyEfforts({
        ...representative,
        id,
        name: stripEffortFromName(representative.name),
        supportsEffort: true,
        availableEfforts,
      }));
    } else {
      for (const model of group.efforts.values()) {
        result.push({ ...model, supportsEffort: false });
      }
    }
  }
  return result.sort((a, b) => a.id.localeCompare(b.id));
}

function applyKnownFamilyEfforts(model: ProcessedCursorModel): ProcessedCursorModel {
  const known = knownEffortsForModelId(model.id);
  const efforts = new Set<string>(
    (model.availableEfforts ?? []).filter((effort) => effort !== ""),
  );
  if (known) for (const effort of known) efforts.add(effort);
  if (efforts.size === 0) return model;
  return {
    ...model,
    name: stripEffortFromName(model.name),
    supportsEffort: true,
    availableEfforts: EFFORT_ORDER.filter((effort) => effort !== "" && efforts.has(effort)),
  };
}

export function thinkingLevelMapFromEfforts(efforts: Iterable<string>): Record<string, string | null> {
  const set = new Set(efforts);
  return {
    off: set.has("none") ? "none" : null,
    minimal: set.has("minimal") ? "minimal" : null,
    low: set.has("low") ? "low" : null,
    medium: set.has("medium") ? "medium" : null,
    high: set.has("high") ? "high" : null,
    xhigh: set.has("xhigh") ? "xhigh" : null,
    max: set.has("max") ? "max" : null,
  };
}

export function toProviderModelConfig(model: ProcessedCursorModel) {
  const efforts = model.availableEfforts ?? [];
  const thinkingLevelMap = model.supportsEffort && efforts.length > 0
    ? thinkingLevelMapFromEfforts(efforts)
    : undefined;
  return {
    id: model.id,
    name: model.name,
    reasoning: Boolean(model.supportsEffort),
    ...(thinkingLevelMap ? { thinkingLevelMap } : {}),
    input: ["text", "image"] as ("text" | "image")[],
    cost: estimateModelCost(model.id),
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
  };
}

export const FALLBACK_MODELS: CursorModel[] = (rawFallbackModels as CursorModel[]).map((model) => ({
  ...model,
  reasoning: supportsReasoningModelId(model.id),
  contextWindow: inferContextWindow(model.id),
}));
