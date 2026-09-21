import type { DiscoveredModel } from "./model-discovery";

/** Comparison between a provider's configured models and its upstream model list. */
export interface ModelSyncPlan {
  /** Upstream models that are missing from the provider config, in upstream order. */
  additions: DiscoveredModel[];
  /** Configured model ids the upstream list no longer offers, in config order. */
  stale: string[];
}

/**
 * Plans a provider model sync from discovered upstream models.
 *
 * Discovery is treated as advisory: `stale` is only reported, never dropped
 * here, because an upstream endpoint can legitimately return a partial list
 * (gateways, proxies, paging). Callers decide whether to remove those ids.
 *
 * Ids are compared exactly — model ids are opaque strings, so `DeepSeek-V4` and
 * `deepseek-v4` stay distinct unless the upstream list stops offering one.
 * Blank ids and duplicates are ignored on both sides.
 */
export function planModelSync(
  configuredIds: readonly string[],
  upstreamModels: readonly DiscoveredModel[],
): ModelSyncPlan {
  const configured = new Set<string>();
  for (const id of configuredIds) {
    if (id) configured.add(id);
  }

  const additions: DiscoveredModel[] = [];
  const upstreamIds = new Set<string>();
  for (const model of upstreamModels) {
    const id = model?.id;
    if (!id || upstreamIds.has(id)) continue;
    upstreamIds.add(id);
    if (!configured.has(id)) additions.push(model);
  }

  const stale: string[] = [];
  const seen = new Set<string>();
  for (const id of configuredIds) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (!upstreamIds.has(id)) stale.push(id);
  }

  return { additions, stale };
}
