export interface CompatEntry {
  compat?: Record<string, unknown>;
}

export interface HeaderRow {
  id: number;
  name: string;
  value: string;
}

export const MODEL_COST_KEYS = ["input", "output", "cacheRead", "cacheWrite"] as const;

export type ModelCostKey = (typeof MODEL_COST_KEYS)[number];

export type ModelCostRates = Record<ModelCostKey, number>;

export type ModelCostDraft = Record<ModelCostKey, string>;

export function modelCostToDraft(cost?: Partial<ModelCostRates>): ModelCostDraft {
  return {
    input: cost?.input === undefined ? "" : String(cost.input),
    output: cost?.output === undefined ? "" : String(cost.output),
    cacheRead: cost?.cacheRead === undefined ? "" : String(cost.cacheRead),
    cacheWrite: cost?.cacheWrite === undefined ? "" : String(cost.cacheWrite),
  };
}

export function parseCompleteModelCost(draft: ModelCostDraft): ModelCostRates | undefined {
  if (!hasModelCostDraftValue(draft)) return undefined;

  const parse = (value: string): number | undefined => {
    if (!value.trim()) return 0;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
  };
  const input = parse(draft.input);
  const output = parse(draft.output);
  const cacheRead = parse(draft.cacheRead);
  const cacheWrite = parse(draft.cacheWrite);
  if (input === undefined || output === undefined || cacheRead === undefined || cacheWrite === undefined) {
    return undefined;
  }
  return { input, output, cacheRead, cacheWrite };
}

export function hasModelCostDraftValue(draft: ModelCostDraft): boolean {
  return MODEL_COST_KEYS.some((key) => draft[key].trim() !== "");
}

export function setCompatBool<T extends CompatEntry>(entry: T, key: string, value: boolean): T {
  return {
    ...entry,
    compat: { ...(entry.compat ?? {}), [key]: value },
  };
}

export function updateHeaderRow(
  rows: readonly HeaderRow[],
  id: number,
  changes: Partial<Pick<HeaderRow, "name" | "value">>,
): HeaderRow[] {
  return rows.map((row) => row.id === id ? { ...row, ...changes } : row);
}

export function serializeHeaderRows(rows: readonly HeaderRow[]): Record<string, string> | undefined {
  const headers: Record<string, string> = {};
  for (const row of rows) {
    const name = row.name.trim();
    if (name) headers[name] = row.value;
  }
  return Object.keys(headers).length ? headers : undefined;
}

/** The parts of models.json the rename tracking needs. */
export interface ModelsConfigDraft {
  providers?: Record<string, { models?: { id: string }[] }>;
}

/** Snapshot of the model ids models.json holds, by provider and slot. */
export function savedModelIds(config: ModelsConfigDraft): Map<string, (string | null)[]> {
  return new Map(Object.entries(config.providers ?? {}).map(([name, provider]) => [
    name,
    (provider.models ?? []).map((model) => model.id),
  ]));
}

export function trackAddedModels(slots: Map<string, (string | null)[]>, providerName: string, count: number) {
  if (count <= 0) return;
  const existing = slots.get(providerName) ?? [];
  slots.set(providerName, [...existing, ...Array.from({ length: count }, () => null)]);
}

/**
 * Model ids that changed in place since the last save, as full references.
 *
 * `from` keeps the provider id the settings file still spells, so the server
 * can rewrite the entry before it applies the provider renames.
 */
export function collectModelRenames(
  config: ModelsConfigDraft,
  slots: Map<string, (string | null)[]>,
  providerRenames: Map<string, string>,
): { from: string; to: string }[] {
  const originalProvider = (name: string) => {
    for (const [from, to] of providerRenames) if (to === name) return from;
    return name;
  };

  const renames: { from: string; to: string }[] = [];
  for (const [name, provider] of Object.entries(config.providers ?? {})) {
    const saved = slots.get(name);
    if (!saved) continue;
    (provider.models ?? []).forEach((model, index) => {
      const before = saved[index];
      if (!before || !model.id || before === model.id) return;
      renames.push({ from: `${originalProvider(name)}/${before}`, to: `${name}/${model.id}` });
    });
  }
  return renames;
}
