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

/**
 * Sets a compat flag whose default is off. The entry keeps the key only while
 * it differs from what the entry inherits (the provider's value, else off), so
 * switching it back leaves no override behind.
 */
export function setCompatFlag<T extends CompatEntry>(entry: T, key: string, value: boolean, inherited = false): T {
  if (value !== inherited) return setCompatBool(entry, key, value);
  if (!entry.compat || !Object.prototype.hasOwnProperty.call(entry.compat, key)) return entry;
  const rest = { ...entry.compat };
  delete rest[key];
  return { ...entry, compat: Object.keys(rest).length ? rest : undefined };
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
  providers?: Record<string, { models?: { id: string; name?: string }[] }>;
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

/** A provider's models in a new order: the draft to set, and the old index now at each slot. */
export interface ModelOrderChange<T extends ModelsConfigDraft> {
  config: T;
  providerName: string;
  order: number[];
}

/** Puts a provider's models in `order` and moves its saved slots along; null when nothing moves. */
function reorderModelEntries<T extends ModelsConfigDraft>(
  config: T,
  slots: Map<string, (string | null)[]>,
  providerName: string,
  order: number[],
): ModelOrderChange<T> | null {
  const providers = config.providers ?? {};
  const provider = providers[providerName];
  const models = provider?.models;
  if (!models || order.every((index, position) => index === position)) return null;
  const saved = slots.get(providerName);
  if (saved) slots.set(providerName, order.map((index) => saved[index] ?? null));
  return {
    config: {
      ...config,
      providers: { ...providers, [providerName]: { ...provider, models: order.map((index) => models[index]) } },
    },
    providerName,
    order,
  };
}

/** Moves one model to slot `to` within its provider; mutates `slots` to match. Null when either slot is outside the list. */
export function moveModelEntry<T extends ModelsConfigDraft>(
  config: T,
  slots: Map<string, (string | null)[]>,
  providerName: string,
  from: number,
  to: number,
): ModelOrderChange<T> | null {
  const models = config.providers?.[providerName]?.models ?? [];
  if (from < 0 || from >= models.length || to < 0 || to >= models.length) return null;
  const order = [...models.keys()];
  order.splice(from, 1);
  order.splice(to, 0, from);
  return reorderModelEntries(config, slots, providerName, order);
}

/** The slot a model dragged from `from` ends up in when dropped before or after the row at `target`. */
export function modelDropIndex(from: number, target: number, after: boolean): number {
  const slot = after ? target + 1 : target;
  return from < slot ? slot - 1 : slot;
}

/** Sorts a provider's models once by shown name (natural, case-insensitive, stable); mutates `slots` to match. Null when already sorted. */
export function sortModelEntries<T extends ModelsConfigDraft>(
  config: T,
  slots: Map<string, (string | null)[]>,
  providerName: string,
): ModelOrderChange<T> | null {
  const models = config.providers?.[providerName]?.models ?? [];
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  const order = [...models.keys()].sort((left, right) =>
    collator.compare(modelSidebarLabel(models[left]), modelSidebarLabel(models[right])));
  return reorderModelEntries(config, slots, providerName, order);
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

/** What the panel remembers between saves to tell renames from edits. */
export interface ProviderRenameTracking {
  /** Provider ids as models.json has them on disk. */
  savedProviders: Set<string>;
  /** Saved provider id -> where renames since the last save moved it. */
  renames: Map<string, string>;
  /** Saved model ids per provider, keyed by the provider's current id. */
  slots: Map<string, (string | null)[]>;
}

/**
 * Saved provider id that the current draft provider `name` came from, or null
 * when `name` was added since the last save.
 *
 * Once a saved id `from` is in `renames` (`from -> to`), that saved provider
 * lives at `to`, not at `from`: a provider later given the freed id `from` is
 * not the original `from`.
 */
function savedProviderOf(
  { renames, savedProviders }: Pick<ProviderRenameTracking, "renames" | "savedProviders">,
  name: string,
): string | null {
  for (const [from, to] of renames) {
    if (to === name) return from;
  }
  return !renames.has(name) && savedProviders.has(name) ? name : null;
}

/**
 * Moves a provider to a new id, keeping its place in models.json, and records
 * the move so the enabledModels entries can follow it on save.
 *
 * Returns null and records nothing when the provider is gone or the new id is
 * already taken: models.json is keyed by id, so the move would silently
 * replace the other provider.
 */
export function renameProviderEntry<T extends ModelsConfigDraft>(
  config: T,
  tracking: ProviderRenameTracking,
  oldName: string,
  newName: string,
): T | null {
  const providers = config.providers ?? {};
  if (!Object.hasOwn(providers, oldName)) return null;
  if (oldName === newName) return config;
  if (Object.hasOwn(providers, newName)) return null;

  const { renames, slots } = tracking;
  const original = savedProviderOf(tracking, oldName);
  if (original === newName) renames.delete(original);
  else if (original !== null) renames.set(original, newName);
  const saved = slots.get(oldName);
  if (saved) {
    slots.delete(oldName);
    slots.set(newName, saved);
  }

  const entries = Object.entries(providers);
  const index = entries.findIndex(([name]) => name === oldName);
  entries[index] = [newName, entries[index][1]];
  return { ...config, providers: Object.fromEntries(entries) };
}

/**
 * Removes a provider from `config` and forgets any unsaved rename or model-slot
 * tracking for it, so saving after a rename-then-delete does not rewrite
 * `enabledModels` to the deleted id or mistake a new provider with the old id
 * for the deleted one.
 */
export function deleteProviderEntry<T extends ModelsConfigDraft>(
  config: T,
  tracking: ProviderRenameTracking,
  name: string,
): T {
  const original = savedProviderOf(tracking, name);
  if (original !== null) {
    tracking.renames.delete(original);
    tracking.savedProviders.delete(original);
  }
  tracking.slots.delete(name);
  const providers = { ...(config.providers ?? {}) };
  delete providers[name];
  return { ...config, providers };
}

/** Add provider's search: a provider matches by its id or its shown name, case-insensitive. */
export function providerMatchesSearch(search: string, id: string, label: string): boolean {
  const query = search.trim().toLowerCase();
  return !query || label.toLowerCase().includes(query) || id.toLowerCase().includes(query);
}

/** Models sidebar: a model shows its models.json name, as the selector does; the id when it has none. */
export function modelSidebarLabel(model: { id: string; name?: string }): string {
  return model.name?.trim() || model.id;
}

/** Models sidebar: a provider shows its models.json name (else the runtime's), as the selector does; the id when it has none. */
export function providerSidebarLabel(
  providerId: string,
  provider: { name?: string },
  runtimeName?: string,
): string {
  return provider.name?.trim() || runtimeName?.trim() || providerId;
}

/**
 * Sets a provider's models.json `name`, the label the sidebar and the selector
 * show. Blank input removes it, so the label falls back to the id. A new name
 * goes first in the entry; typed spaces stay, as in the other fields.
 */
export function setProviderDisplayName<T extends { name?: string }>(provider: T, value: string): T {
  if (!value.trim()) {
    const rest = { ...provider };
    delete rest.name;
    return rest;
  }
  return "name" in provider ? { ...provider, name: value } : { name: value, ...provider };
}

/** Each saved provider's models.json `name`, by id. */
export function savedProviderNames(config: { providers?: Record<string, { name?: string }> }): Map<string, string> {
  const names = new Map<string, string>();
  for (const [id, provider] of Object.entries(config.providers ?? {})) {
    if (typeof provider.name === "string") names.set(id, provider.name);
  }
  return names;
}

/**
 * The runtime's name for a models.json provider, unless it is the saved `name`
 * itself: pi reads that name, so a name cleared in the draft would otherwise
 * stay the label until the next save.
 */
export function providerRuntimeName(runtimeName: string | undefined, savedName: string | undefined): string | undefined {
  return savedName !== undefined && runtimeName?.trim() === savedName.trim() ? undefined : runtimeName;
}
