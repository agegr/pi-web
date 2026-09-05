import { getAgentDir, ModelRuntime, SettingsManager } from "@earendil-works/pi-coding-agent";
import { resolve } from "path";

const PROVIDER_PART = "[A-Za-z0-9_.-]+";

/** Does the pattern list contain any entry attributable to `providerId`? */
function hasProviderEntry(patterns: string[], providerId: string): boolean {
  const prefix = `${providerId}/`;
  return patterns.some((e) => e.startsWith(prefix) || e === providerId);
}

export interface BackfillResult {
  changed: boolean;
  added: string[];
  warning?: string;
}

/**
 * Seed `provider/*` for configured providers that have no allowlist entry.
 *
 * The `enabledModels` allowlist is one global array shared by every provider:
 * without a backfill, a newly configured provider's models would be invisible
 * until manually enabled. Backfilling keeps the semantics of "the allowlist
 * records only what was explicitly trimmed" — everything else (including new
 * providers) stays fully visible.
 *
 * No-op while the allowlist is empty (allow-all mode).
 */
export async function backfillAllowlist(runtime: ModelRuntime, settings: SettingsManager, signal?: AbortSignal): Promise<BackfillResult> {
  const current = settings.getEnabledModels();
  if (!Array.isArray(current) || current.length === 0) {
    return { changed: false, added: [] }; // allow-all mode: nothing to backfill
  }
  try {
    const available = await runtime.getAvailable(undefined, signal ? { signal } : undefined);
    const configured = [...new Set(available.map((m) => m.provider))];
    const missing = configured.filter((p) => !hasProviderEntry(current, p));
    if (missing.length === 0) {
      return { changed: false, added: [] };
    }
    const added = missing.map((p) => `${p}/*`);
    settings.setEnabledModels([...current, ...added]);
    return { changed: true, added };
  } catch (error) {
    return {
      changed: false,
      added: [],
      warning: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Convenience wrapper: fresh runtime + settings for post-auth/refresh backfill. */
export async function backfillAllowlistStandalone(cwd?: string, signal?: AbortSignal): Promise<BackfillResult> {
  const runtime = await ModelRuntime.create({ signal });
  const settings = SettingsManager.create(resolve(cwd ?? process.cwd()), getAgentDir());
  return backfillAllowlist(runtime, settings, signal);
}
