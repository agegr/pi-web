/**
 * Editing of the `enabledModels` setting for the Models panel.
 *
 * `enabledModels` is a whitelist of pi `--models` patterns, so turning one
 * model off implies spelling out everything that stays on. pi's TUI solves that
 * by rewriting the whole list from the models it can see right now
 * (`/scoped-models` + Ctrl+S). pi-web must not: `ModelRuntime.getAvailable()`
 * only returns models of providers with configured auth, so a full rewrite
 * while the user is logged out of a provider would silently delete every entry
 * they had for it, and it would also flatten hand-written globs and drop
 * `:thinkingLevel` pins.
 *
 * Every operation here is therefore a *minimal edit* of the existing pattern
 * list:
 * - a pattern that matches no available model is never touched: its provider
 *   may just be missing a credential, the model may have been renamed, or the
 *   entry may have been written for another machine,
 * - only the pattern that actually covers a model being switched off is
 *   expanded, in place, into explicit `provider/modelId` entries that keep the
 *   original `:level` suffix,
 * - entry order is preserved, because it is pi's model cycling order and the
 *   fallback for the initial model of a new session.
 *
 * The functions are pure: pattern matching itself (minimatch globs, fuzzy
 * matching, alias preference, `:level` suffixes) belongs to the SDK resolver
 * and reaches this module as a pre-computed `PatternResolution[]`. See
 * `lib/enabled-models-runtime.ts`.
 */

/** How one configured pattern resolves against the available models. */
export interface PatternResolution {
  /** The pattern exactly as stored in settings. */
  pattern: string;
  /** `provider/modelId` references the pattern matches, in resolver order. */
  matched: string[];
  /** Thinking level pinned by a `:level` suffix, when the pattern carries one. */
  pin?: string;
}

export interface EnabledModelsInput {
  /** `enabledModels` as stored; `undefined` means every model is enabled. */
  patterns: string[] | undefined;
  /** Every available `provider/modelId`, grouped by provider in display order. */
  availableRefs: readonly string[];
  /** Resolution of each entry of `patterns`, index-aligned. */
  resolutions: readonly PatternResolution[];
  /**
   * Per provider, a glob **verified** to match exactly that provider's
   * available models — nothing more, nothing less.
   *
   * Never assume `provider/*` here: minimatch's `*` does not cross `/`, so that
   * glob silently misses every model whose id contains a slash
   * (`commandcode/sakana/fugu-ultra`, most OpenRouter ids). A provider with no
   * verified glob is written out model by model instead.
   */
  providerGlobs?: Readonly<Record<string, string>>;
}

export interface EnabledModelsState {
  /** True when no pattern narrows the list, so the selector shows everything. */
  allEnabled: boolean;
  /** Enabled references, restricted to what is available right now. */
  enabled: string[];
  /** `provider/modelId` → thinking level pinned by a `:level` pattern. */
  pins: Record<string, string>;
  /**
   * Patterns that match no available model, so nothing here can tell what they
   * were for — a provider without a usable credential, a renamed or deleted
   * model, a typo, another machine's config. Preserved by every edit.
   */
  stalePatterns: string[];
}

export interface EnabledModelsModelView {
  id: string;
  name: string;
  /** `provider/modelId`, the reference used by every edit. */
  ref: string;
  enabled: boolean;
  /** Thinking level pinned by a `:level` pattern; read-only in pi-web. */
  thinkingPin?: string;
}

export interface EnabledModelsProviderView {
  id: string;
  name: string;
  /**
   * `builtin` covers pi's own providers and any provider an extension
   * registered; both own their model lists, so individual models can only be
   * hidden through `enabledModels`. `custom` providers come from models.json,
   * where a model can simply be deleted, so they are switched as a whole.
   */
  kind: "builtin" | "custom";
  enabledCount: number;
  models: EnabledModelsModelView[];
}

/** Payload of `GET`/`PUT /api/models/enabled`, shared with the browser. */
export interface EnabledModelsView {
  /** True when nothing narrows the model list. */
  allEnabled: boolean;
  patterns: string[] | null;
  /** Configured patterns that match no available model; every edit keeps them. */
  stalePatterns: string[];
  enabledTotal: number;
  availableTotal: number;
  providers: EnabledModelsProviderView[];
  /** Which settings file the effective value comes from. */
  scope: "global" | "project";
  /** That file's path, shortened for display, e.g. `~/.pi/agent/settings.json`. */
  settingsPath: string;
  /** False when project settings shadow the global value pi-web can write. */
  editable: boolean;
  modelError?: string;
}

export type EnabledModelsEdit =
  | { ok: true; patterns: string[] | undefined; changed: boolean }
  | { ok: false; reason: "last-model" };

/** Provider id of a `provider/modelId` reference (model ids may contain `/`). */
export function modelRefProvider(ref: string): string {
  const slash = ref.indexOf("/");
  return slash < 0 ? ref : ref.slice(0, slash);
}

/** Working copy of one configured pattern. */
interface Entry {
  pattern: string;
  matched: string[];
  pin?: string;
}

function toEntries(resolutions: readonly PatternResolution[]): Entry[] {
  return resolutions.map((resolution) => ({
    pattern: resolution.pattern,
    matched: [...resolution.matched],
    ...(resolution.pin ? { pin: resolution.pin } : {}),
  }));
}

function enabledRefs(entries: readonly Entry[]): string[] {
  const seen = new Set<string>();
  const refs: string[] = [];
  for (const entry of entries) {
    for (const ref of entry.matched) {
      if (seen.has(ref)) continue;
      seen.add(ref);
      refs.push(ref);
    }
  }
  return refs;
}

function formatEntry(ref: string, pin?: string): string {
  return pin ? `${ref}:${pin}` : ref;
}

function providerOrder(availableRefs: readonly string[]): string[] {
  const providers: string[] = [];
  for (const ref of availableRefs) {
    const provider = modelRefProvider(ref);
    if (!providers.includes(provider)) providers.push(provider);
  }
  return providers;
}

function refsOfProvider(availableRefs: readonly string[], provider: string): string[] {
  return availableRefs.filter((ref) => modelRefProvider(ref) === provider);
}

/**
 * Make the current selection explicit so a single toggle can edit it.
 *
 * "Everything enabled" is stored as no patterns at all (or as patterns that all
 * went stale). Materializing it as one verified glob per provider keeps the
 * written setting short and lets models added later stay enabled, unlike the
 * TUI, which writes out every model id. A provider without such a glob falls
 * back to one entry per model, which is correct if less tidy.
 */
function materializeEntries(input: EnabledModelsInput): Entry[] {
  const entries = toEntries(input.resolutions);
  if (enabledRefs(entries).length > 0) return entries;
  for (const provider of providerOrder(input.availableRefs)) {
    const refs = refsOfProvider(input.availableRefs, provider);
    const glob = input.providerGlobs?.[provider];
    if (glob) entries.push({ pattern: glob, matched: refs });
    else for (const ref of refs) entries.push({ pattern: ref, matched: [ref] });
  }
  return entries;
}

/**
 * Replace the entries of a fully enabled provider with its verified glob.
 *
 * Skipped when the provider has no glob covering exactly its models, when it
 * has fewer than two entries to merge, when any pattern touching the provider
 * pins a thinking level (a glob cannot carry per-model pins), and when a wider
 * pattern already covers the provider, where rewriting would gain nothing.
 */
function collapseProvider(entries: Entry[], input: EnabledModelsInput, provider: string): Entry[] {
  const providerGlob = input.providerGlobs?.[provider];
  if (!providerGlob) return entries;
  const providerRefs = refsOfProvider(input.availableRefs, provider);
  if (providerRefs.length === 0) return entries;

  const providerSet = new Set(providerRefs);
  const involved = entries.filter((entry) => entry.matched.some((ref) => providerSet.has(ref)));
  if (involved.some((entry) => entry.pin)) return entries;

  const covered = new Set(involved.flatMap((entry) => entry.matched.filter((ref) => providerSet.has(ref))));
  if (providerRefs.some((ref) => !covered.has(ref))) return entries;

  const isSubset = (entry: Entry) => entry.matched.length > 0 && entry.matched.every((ref) => providerSet.has(ref));
  // Merging needs at least two entries. A lone exact reference is a deliberate
  // pick, not an enumeration to tidy up, even when it happens to be the only
  // model the provider offers today.
  if (entries.filter(isSubset).length < 2) return entries;
  const firstSubset = entries.findIndex(isSubset);
  if (firstSubset < 0) return entries;

  // A `**` or a cross-provider pattern already covering everything makes the
  // provider's own entries redundant; leave that list alone.
  const wider = new Set(involved.filter((entry) => !isSubset(entry)).flatMap((entry) => entry.matched));
  if (providerRefs.every((ref) => wider.has(ref))) return entries;

  const glob: Entry = { pattern: providerGlob, matched: providerRefs };
  return entries
    .map((entry, index) => (index === firstSubset ? glob : entry))
    .filter((entry, index) => index === firstSubset || !isSubset(entry));
}

/**
 * Write every fully enabled provider as its glob, not just the edited one.
 *
 * An explicit list is equivalent to the glob today and rots tomorrow: pi
 * refreshes provider catalogs from the network into `models-store.json`, and a
 * rename (deepseek's `deepseek-v4-flash` became `deepseek-flash`) leaves dead
 * entries behind while the new model stays off, even though the user had asked
 * for the whole provider. Normalizing on each write lets such a list heal
 * itself. Providers that are only partly enabled keep their explicit entries,
 * and stale entries are never touched.
 */
function normalizeProviderGlobs(entries: Entry[], input: EnabledModelsInput): Entry[] {
  let normalized = entries;
  for (const provider of providerOrder(input.availableRefs)) {
    normalized = collapseProvider(normalized, input, provider);
  }
  return normalized;
}

function serialize(entries: readonly Entry[], input: EnabledModelsInput): string[] | undefined {
  const hasStale = entries.some((entry) => entry.matched.length === 0);
  const hasPins = entries.some((entry) => entry.pin);
  const enabled = new Set(enabledRefs(entries));
  const coversEverything = input.availableRefs.every((ref) => enabled.has(ref));
  // Drop the setting entirely once it stops narrowing anything, like the TUI —
  // but never when it would discard stale entries or a thinking pin.
  if (coversEverything && !hasStale && !hasPins) return undefined;
  return entries.map((entry) => entry.pattern);
}

function samePatterns(a: string[] | undefined, b: string[] | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.length === b.length && a.every((pattern, index) => pattern === b[index]);
}

/** Current selection derived from the configured patterns. */
export function computeEnabledModelsState(input: EnabledModelsInput): EnabledModelsState {
  const entries = toEntries(input.resolutions);
  const enabled = enabledRefs(entries);
  const pins: Record<string, string> = {};
  for (const entry of entries) {
    if (!entry.pin) continue;
    // The resolver keeps the first occurrence of a model, so its pin wins.
    for (const ref of entry.matched) pins[ref] ??= entry.pin;
  }
  // pi falls back to every available model when the patterns resolve to
  // nothing, so a fully stale list reads as "all enabled" here too.
  const allEnabled = enabled.length === 0;
  return {
    allEnabled,
    enabled: allEnabled ? [...input.availableRefs] : enabled,
    pins,
    stalePatterns: entries.filter((entry) => entry.matched.length === 0).map((entry) => entry.pattern),
  };
}

/**
 * Turn `refs` on or off with the smallest possible edit of the pattern list.
 *
 * Returns `{ ok: false, reason: "last-model" }` when the edit would leave no
 * enabled model: pi treats an empty scope as "no scope" and shows every model
 * again, so disabling the last one would silently mean the opposite.
 */
export function setModelsEnabled(
  input: EnabledModelsInput,
  refs: readonly string[],
  enabled: boolean,
): EnabledModelsEdit {
  const available = new Set(input.availableRefs);
  const targets = [...new Set(refs.filter((ref) => available.has(ref)))];
  if (targets.length === 0) return { ok: true, patterns: input.patterns, changed: false };

  let entries = materializeEntries(input);

  if (enabled) {
    const current = new Set(enabledRefs(entries));
    for (const ref of targets) {
      if (current.has(ref)) continue;
      current.add(ref);
      entries.push({ pattern: ref, matched: [ref] });
    }
  } else {
    const removed = new Set(targets);
    const next: Entry[] = [];
    for (const entry of entries) {
      if (!entry.matched.some((ref) => removed.has(ref))) {
        next.push(entry);
        continue;
      }
      // Expand only this pattern, keeping its thinking pin on each survivor.
      for (const ref of entry.matched.filter((matched) => !removed.has(matched))) {
        next.push({ pattern: formatEntry(ref, entry.pin), matched: [ref], ...(entry.pin ? { pin: entry.pin } : {}) });
      }
    }
    if (enabledRefs(next).length === 0) return { ok: false, reason: "last-model" };
    entries = next;
  }

  const patterns = serialize(normalizeProviderGlobs(entries, input), input);
  return { ok: true, patterns, changed: !samePatterns(patterns, input.patterns) };
}

/**
 * Remove the scope entirely so every model is enabled again.
 *
 * This is the one operation that also drops stale patterns: keeping them would
 * re-narrow the selector the moment they match again (the provider gets a
 * credential back, say), which is the opposite of what "show every model" asks
 * for.
 */
export interface ProviderRename {
  from: string;
  to: string;
}

/** Suffixes `formatEntry()` may have appended, so a rename can carry them over. */
const THINKING_LEVEL_SUFFIXES = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

/**
 * Point renamed models' entries at their new reference.
 *
 * A model renamed in the panel is a known fact, not the kind of mismatch worth
 * preserving: leaving `stepfun/ddd` behind after it became `stepfun/ddd1` loses
 * the selection, and when it was the only entry the whole scope resolves to
 * nothing — which pi reads as "no scope", silently enabling every model.
 *
 * Applied before the provider rewrite, so `from` is the reference as the
 * settings file still spells it and `to` is where it ends up.
 */
export function renameModelPatterns(
  patterns: string[] | undefined,
  renames: readonly ProviderRename[],
): string[] | undefined {
  if (!patterns) return patterns;
  const applicable = renames.filter((rename) => rename.from && rename.to && rename.from !== rename.to);
  if (applicable.length === 0) return patterns;
  return patterns.map((pattern) => {
    for (const { from, to } of applicable) {
      if (pattern === from) return to;
      // Model ids may contain colons, so only a known level is a pin suffix.
      if (!pattern.startsWith(`${from}:`)) continue;
      const suffix = pattern.slice(from.length + 1);
      if (THINKING_LEVEL_SUFFIXES.has(suffix)) return `${to}:${suffix}`;
    }
    return pattern;
  });
}

/**
 * Point a renamed provider's entries at its new id.
 *
 * A pure prefix rewrite, so a `:thinkingLevel` suffix and the entry order both
 * survive. The result is only the *intent*: the same glob can mean something
 * else under the new id, so it must be resolved again and passed through
 * `constrainProviderEntries()` before it is stored.
 */
export function renameProviderPatterns(
  patterns: string[] | undefined,
  renames: readonly ProviderRename[],
): string[] | undefined {
  if (!patterns) return patterns;
  const applicable = renames.filter((rename) => rename.from && rename.to && rename.from !== rename.to);
  if (applicable.length === 0) return patterns;
  return patterns.map((pattern) => {
    const rename = applicable.find((candidate) => pattern.startsWith(`${candidate.from}/`));
    return rename ? `${rename.to}${pattern.slice(rename.from.length)}` : pattern;
  });
}

/**
 * Cut entries back to the provider their prefix names.
 *
 * pi matches a pattern against both `provider/modelId` **and** the bare
 * `modelId`, so `stepfun/*` also matches another provider's model whose id
 * happens to be `stepfun/Step-5-Preview`. A glob is verified against the
 * catalog when it is written, but models.json can change under it: renaming a
 * provider to `stepfun` made its glob reach into `commandcode`, which silently
 * enabled three of its models.
 *
 * An entry that still matches nothing inside its own provider is left alone —
 * it may be a bare model id that only looks like a prefix.
 */
export function constrainProviderEntries(input: EnabledModelsInput): EnabledModelsEdit {
  const providers = new Set(providerOrder(input.availableRefs));
  const next: Entry[] = [];
  let cutBack = false;
  for (const entry of toEntries(input.resolutions)) {
    const slash = entry.pattern.indexOf("/");
    const prefix = slash > 0 ? entry.pattern.slice(0, slash) : "";
    const inside = providers.has(prefix)
      ? entry.matched.filter((ref) => modelRefProvider(ref) === prefix)
      : [];
    if (inside.length === 0 || inside.length === entry.matched.length) {
      next.push(entry);
      continue;
    }
    cutBack = true;
    for (const ref of inside) {
      next.push({ pattern: formatEntry(ref, entry.pin), matched: [ref], ...(entry.pin ? { pin: entry.pin } : {}) });
    }
  }
  // Repair only. Whether the setting can be dropped altogether is for the
  // operation that actually edits the selection to decide.
  if (!cutBack) return { ok: true, patterns: input.patterns, changed: false };
  const patterns = serialize(next, input);
  return { ok: true, patterns, changed: !samePatterns(patterns, input.patterns) };
}

/**
 * Drop the entries that match no available model.
 *
 * Every other operation preserves them, because an entry usually goes unmatched
 * for a reason that can reverse itself (a provider signed out, a catalog not
 * refreshed yet). This one is the user saying they are gone for good, so it is
 * the only way to clean up after a provider renamed its models.
 */
export function pruneStaleEnabledModels(input: EnabledModelsInput): EnabledModelsEdit {
  const kept = toEntries(input.resolutions).filter((entry) => entry.matched.length > 0);
  if (kept.length === input.resolutions.length) {
    return { ok: true, patterns: input.patterns, changed: false };
  }
  // Nothing left to narrow with: drop the key instead of writing an empty list.
  const patterns = kept.length === 0 ? undefined : serialize(kept, input);
  return { ok: true, patterns, changed: !samePatterns(patterns, input.patterns) };
}

export function clearEnabledModels(input: EnabledModelsInput): EnabledModelsEdit {
  return { ok: true, patterns: undefined, changed: input.patterns !== undefined };
}
