import { getAgentDir, ModelRuntime, SettingsManager } from "@earendil-works/pi-coding-agent";
import { resolve } from "path";

const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

/** Does the pattern list contain any entry attributable to `providerId`? */
function hasProviderEntry(patterns: string[], providerId: string): boolean {
  const prefix = `${providerId}/`;
  return patterns.some((e) => e.startsWith(prefix) || e === providerId);
}

/**
 * Which provider does an allowlist entry belong to?
 *
 * Only provider-scoped entries (`provider/*`, `provider/model`, `provider/model:level`)
 * are attributable. Bare patterns (`*`, `my-*`, `model-id`) and wildcard-provider globs
 * (asterisk/model) match by model id and must never be pruned, so they return null.
 */
function attributableProvider(entry: string): string | null {
  const slash = entry.indexOf("/");
  if (slash <= 0) return null;
  const provider = entry.slice(0, slash);
  if (!/^[A-Za-z0-9_.-]+$/.test(provider)) return null;
  return provider;
}

export interface SyncAllowlistResult {
  changed: boolean;
  added: string[];
  removed: string[];
  warning?: string;
}

/**
 * Seed `provider/*` for the NAMED providers when they have no allowlist entry,
 * so a newly configured provider stays fully visible ("the allowlist records
 * only what was explicitly trimmed").
 *
 * Deliberately named-provider-only: a global "backfill every missing provider"
 * would silently revive a provider the user trimmed to zero models — in a
 * non-empty allowlist, absence IS how "all models hidden" is expressed, and
 * that state is indistinguishable from "never seeded" (B1). Callers pass the
 * providers they actually added (models.json diff, just-authenticated provider,
 * genuinely new providers after a remote catalog refresh).
 *
 * No-op while the allowlist is empty (allow-all mode). The write mutates the
 * instance's in-memory state immediately and queues the disk write; callers
 * sharing this instance see the update, and should `await settings.flush()`
 * before responding.
 */
export function ensureAllowlistSegments(settings: SettingsManager, providerIds: string[]): SyncAllowlistResult {
  if (providerIds.length === 0) return { changed: false, added: [], removed: [] };
  const current = settings.getEnabledModels();
  if (!Array.isArray(current) || current.length === 0) return { changed: false, added: [], removed: [] };
  const missing = providerIds.filter((p) => !hasProviderEntry(current, p));
  if (missing.length === 0) return { changed: false, added: [], removed: [] };
  const added = missing.map((p) => `${p}/*`);
  settings.setEnabledModels([...current, ...added]);
  return { changed: true, added, removed: [] };
}

/** SettingsManager-only convenience for auth routes; flushes before returning. */
export async function ensureAllowlistSegmentsStandalone(cwd?: string, providerIds: string[] = []): Promise<SyncAllowlistResult> {
  const settings = SettingsManager.create(resolve(cwd ?? process.cwd()), getAgentDir());
  const result = ensureAllowlistSegments(settings, providerIds);
  await settings.flush();
  return result;
}

/**
 * Prune allowlist entries of providers that are no longer in the runtime's
 * available list.
 *
 * Backfill is deliberately NOT done here (see ensureAllowlistSegments): a
 * global "backfill every missing provider" would silently revive providers the
 * user trimmed to zero models. Callers seed genuinely-new providers by name.
 *
 * Bare entries exactly equal to a stale provider id are dropped too, but only
 * when that provider is also referenced by a slash-scoped entry — a bare id
 * alone is indistinguishable from a hand-written fuzzy model pattern, so those
 * are kept here (explicit-name pruning via pruneAllowlistProviders removes
 * them reliably; a known, documented divergence).
 *
 * No-op while the allowlist is empty (allow-all mode).
 */
export async function syncAllowlist(runtime: ModelRuntime, settings: SettingsManager, signal?: AbortSignal, options: { prune?: boolean; keepProviders?: string[] } = {}): Promise<SyncAllowlistResult> {
  const current = settings.getEnabledModels();
  if (!Array.isArray(current) || current.length === 0) {
    return { changed: false, added: [], removed: [] }; // allow-all mode: nothing to sync
  }
  try {
    const available = await runtime.getAvailable(undefined, signal ? { signal } : undefined);
    const configuredSet = new Set(available.map((m) => m.provider));
    const keepSet = new Set(options.keepProviders ?? []);

    const staleProviders = new Set(
      current
        .map((entry) => attributableProvider(entry))
        .filter((p): p is string => p !== null && !configuredSet.has(p) && !keepSet.has(p)),
    );
    const kept: string[] = [];
    const removed: string[] = [];
    for (const entry of current) {
      const provider = attributableProvider(entry);
      const stale = provider !== null
        ? !configuredSet.has(provider) && !keepSet.has(provider)
        : staleProviders.has(entry);
      if (options.prune !== false && stale) removed.push(entry);
      else kept.push(entry);
    }
    if (removed.length === 0) return { changed: false, added: [], removed: [] };
    settings.setEnabledModels(kept);
    return { changed: true, added: [], removed };
  } catch (error) {
    return {
      changed: false,
      added: [],
      removed: [],
      warning: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Convenience wrapper: fresh runtime + settings for post-removal prune; flushes before returning. */
export async function syncAllowlistStandalone(cwd?: string, signal?: AbortSignal, options?: { prune?: boolean; keepProviders?: string[] }): Promise<SyncAllowlistResult> {
  const runtime = await ModelRuntime.create({ signal });
  const settings = SettingsManager.create(resolve(cwd ?? process.cwd()), getAgentDir());
  const result = await syncAllowlist(runtime, settings, signal, options);
  await settings.flush();
  return result;
}

/**
 * Drop every allowlist entry attributable to explicitly named providers — no
 * runtime needed. Used when models.json edit is known to have removed specific
 * providers, so a transient catalog hiccup can never prune entries of providers
 * that are merely temporarily unavailable.
 *
 * No-op while the allowlist is empty (allow-all mode).
 *
 * `removedModels` optionally prunes exact entries (`p/model`, `p/model:level`)
 * of models deleted from a surviving provider; `p/*` and glob patterns are kept
 * — they never become stale just because one model id vanished.
 */
export function pruneAllowlistProviders(settings: SettingsManager, providerIds: string[], removedModels?: Record<string, string[]>): SyncAllowlistResult {
  if (providerIds.length === 0 && (!removedModels || Object.keys(removedModels).length === 0)) return { changed: false, added: [], removed: [] };
  const current = settings.getEnabledModels();
  if (!Array.isArray(current) || current.length === 0) return { changed: false, added: [], removed: [] };
  const removedModelSets = new Map(Object.entries(removedModels ?? {}).map(([p, ids]) => [p, new Set(ids)]));
  const providerIdSet = new Set(providerIds);
  const kept: string[] = [];
  const removed: string[] = [];
  for (const entry of current) {
    const provider = attributableProvider(entry);
    let drop: boolean;
    if (provider === null) {
      drop = providerIdSet.has(entry); // bare entry exactly equal to a provider id
    } else if (providerIdSet.has(provider)) {
      drop = true;
    } else {
      const models = removedModelSets.get(provider);
      if (!models || models.size === 0) {
        drop = false;
      } else {
        const rest = entry.slice(provider.length + 1);
        // Strip a trailing `:thinkingLevel` suffix (only when it is a real level —
        // model ids may contain `:` themselves); globs and `p/*` never exactly
        // equal a deleted model id, so they survive untouched.
        const colon = rest.lastIndexOf(":");
        const suffix = colon > 0 ? rest.slice(colon + 1) : "";
        const modelId = THINKING_LEVELS.has(suffix) ? rest.slice(0, colon) : rest;
        drop = models.has(modelId);
      }
    }
    if (drop) removed.push(entry);
    else kept.push(entry);
  }
  if (removed.length === 0) return { changed: false, added: [], removed: [] };
  settings.setEnabledModels(kept);
  return { changed: true, added: [], removed };
}
