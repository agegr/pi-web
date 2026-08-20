interface EnabledModelsSettings {
  getGlobalSettings(): { enabledModels?: string[] };
  setEnabledModels(patterns: string[] | undefined): void;
  flush(): Promise<void>;
}

const THINKING_LEVEL_SUFFIXES = new Set([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function configuredModelReferences(config: Record<string, unknown>): Set<string> {
  const references = new Set<string>();
  if (!isRecord(config.providers)) return references;

  for (const [providerId, provider] of Object.entries(config.providers)) {
    if (!isRecord(provider) || !Array.isArray(provider.models)) continue;
    for (const model of provider.models) {
      if (!isRecord(model) || typeof model.id !== "string") continue;
      const modelId = model.id.trim();
      if (!modelId) continue;
      references.add(`${providerId}/${modelId}`.toLowerCase());
    }
  }
  return references;
}

function exactCanonicalReference(pattern: string, removed: ReadonlySet<string>): string | undefined {
  const trimmed = pattern.trim();
  if (
    !trimmed.includes("/")
    || trimmed.includes("*")
    || trimmed.includes("?")
    || trimmed.includes("[")
  ) return undefined;

  const normalized = trimmed.toLowerCase();
  if (removed.has(normalized)) return normalized;

  const colonIndex = normalized.lastIndexOf(":");
  if (colonIndex < 0) return undefined;
  const suffix = normalized.slice(colonIndex + 1);
  if (!THINKING_LEVEL_SUFFIXES.has(suffix)) return undefined;

  const reference = normalized.slice(0, colonIndex);
  return removed.has(reference) ? reference : undefined;
}

export function pruneRemovedEnabledModelPatterns(
  patterns: readonly string[],
  previousConfig: Record<string, unknown>,
  nextConfig: Record<string, unknown>,
): string[] {
  const previous = configuredModelReferences(previousConfig);
  const next = configuredModelReferences(nextConfig);
  const removed = new Set([...previous].filter((reference) => !next.has(reference)));
  if (removed.size === 0) return [...patterns];

  // Preserve globs, fuzzy/bare ids, and unmatched canonical references. They may
  // intentionally target built-in or future models that are not in models.json.
  return patterns.filter((pattern) => !exactCanonicalReference(pattern, removed));
}

export async function pruneRemovedEnabledModels(
  settings: EnabledModelsSettings,
  previousConfig: Record<string, unknown>,
  nextConfig: Record<string, unknown>,
): Promise<number> {
  const current = settings.getGlobalSettings().enabledModels;
  if (!current || current.length === 0) return 0;

  const pruned = pruneRemovedEnabledModelPatterns(current, previousConfig, nextConfig);
  const removedCount = current.length - pruned.length;
  if (removedCount === 0) return 0;

  settings.setEnabledModels(pruned.length > 0 ? pruned : undefined);
  await settings.flush();
  return removedCount;
}
