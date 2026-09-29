import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { createModelRuntimeWithExtensions } from "@/lib/model-runtime";
import { invalidateModelsCache } from "@/lib/models-cache";

/**
 * On-demand refresh of pi's remote provider catalogs.
 *
 * pi's built-in model lists are generated when the SDK is built and pi-web
 * pins one SDK version, so a model a provider ships after that release stays
 * invisible until pi-web itself publishes a new version (#914: Kimi for
 * Coding's K2.8). The SDK already carries the missing half: every built-in
 * provider is wrapped in a pi.dev catalog overlay that `ModelRuntime.refresh()`
 * fetches and persists to `~/.pi/agent/models-store.json`, keyed by provider.
 * Restoring that overlay needs no network, which is why "run the pi CLI once"
 * was the known workaround — the CLI refreshes with the network on, and every
 * pi-web request then reads what the CLI left behind. Both of pi-web's own
 * refresh paths ask for the offline half only (`createAgentSessionServices()`
 * and `lib/provider-usage.ts` pass `allowNetwork: false`), so pi-web never
 * filled that file itself.
 *
 * This runs the network pass in pi-web, behind the Models panel's refresh
 * button. It only has to write `models-store.json`: the overlay reaches the UI
 * through the ordinary `/api/models` and `/api/models/enabled` loads, which
 * build a fresh runtime that restores the store.
 *
 * Deliberately never on an unrelated request's path. A pass fetches a catalog
 * per authenticated provider, and a save must not wait on a slow catalog — the
 * same reason `/api/auth/api-key/[provider]` stores the credential itself
 * instead of going through `ModelRuntime.login()`.
 */

/** Bounded like the background refresh the CLI starts in RPC mode. */
const CATALOG_REFRESH_TIMEOUT_MS = 15_000;

/** The parts of a model that decide whether the Models panel has something new to show. */
export interface CatalogModel {
  id: string;
  name: string;
  provider: string;
}

export interface CatalogRefreshResult {
  /** Every provider either refreshed or was skipped cleanly — nothing failed or was aborted. */
  completed: boolean;
  /** The visible model list moved, so cached `/api/models` payloads were dropped. */
  changed: boolean;
  /** Set when the pass could not run at all. `offline` means `PI_OFFLINE` is set. */
  reason?: "offline" | "runtime";
}

export interface CatalogRefreshOptions {
  /** Restrict the pass to these provider ids. Defaults to every refreshable provider. */
  providers?: readonly string[];
  signal?: AbortSignal;
}

/**
 * Compare catalogs by what the model list actually exposes.
 *
 * A successful revalidation rewrites `checkedAt` and `etag` in the store on
 * every pass, so comparing stored bytes would report a change each time.
 */
export function modelCatalogSignature(models: readonly CatalogModel[]): string {
  return models
    .map((model) => `${model.provider}\u0000${model.id}\u0000${model.name}`)
    .sort()
    .join("\n");
}

/** pi reads any `PI_OFFLINE` value, empty included, as "never touch the network". */
export function isModelNetworkDisabled(): boolean {
  return process.env.PI_OFFLINE !== undefined;
}

/**
 * Fetch the remote catalogs once and persist them.
 *
 * `refresh()` is called without `allowNetwork` so the runtime applies its own
 * `PI_OFFLINE` rule instead of pi-web overriding it, and always with
 * `force: true`: someone who pressed the button is asking past the SDK's
 * four-hour freshness window, which is the whole point of a manual refresh.
 * Never rejects — a provider that cannot be reached is reported, not thrown.
 */
export async function refreshModelCatalogs(
  options: CatalogRefreshOptions = {},
): Promise<CatalogRefreshResult> {
  if (isModelNetworkDisabled()) return { completed: false, changed: false, reason: "offline" };

  const timeout = AbortSignal.timeout(CATALOG_REFRESH_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;

  let runtime: ModelRuntime;
  try {
    runtime = await createModelRuntimeWithExtensions();
  } catch {
    return { completed: false, changed: false, reason: "runtime" };
  }

  // `createAgentSessionServices()` has already restored the stored overlay, so
  // this is exactly the list the panel is showing right now.
  const before = modelCatalogSignature(runtime.getModels());
  let completed = false;
  try {
    const result = await runtime.refresh({
      ...(options.providers ? { providers: options.providers } : {}),
      force: true,
      signal,
    });
    completed = !result.aborted && result.errors.size === 0;
  } catch {
    completed = false;
  }

  // A pass that failed for one provider can still have persisted another's
  // catalog, so compare regardless of the outcome.
  const changed = modelCatalogSignature(runtime.getModels()) !== before;
  if (changed) invalidateModelsCache();
  return { completed, changed };
}

declare global {
  var __piModelCatalogRefreshPasses: Map<string, Promise<CatalogRefreshResult>> | undefined;
}

function getPasses(): Map<string, Promise<CatalogRefreshResult>> {
  if (!globalThis.__piModelCatalogRefreshPasses) globalThis.__piModelCatalogRefreshPasses = new Map();
  return globalThis.__piModelCatalogRefreshPasses;
}

/**
 * Run a pass, or join the one already running for the same providers.
 *
 * A double-click, or two browser tabs on the same panel, must not start two
 * passes racing over the same store file. Passes for different providers are
 * independent, so they are keyed rather than globally serialized.
 */
export function shareModelCatalogRefresh(
  options: CatalogRefreshOptions = {},
): Promise<CatalogRefreshResult> {
  const key = options.providers ? [...options.providers].sort().join(",") : "";
  const passes = getPasses();
  const running = passes.get(key);
  if (running) return running;

  // Deliberately without the caller's signal: a viewer who navigated away must
  // not abort the pass a second viewer is now waiting on.
  const pass = refreshModelCatalogs({ ...options, signal: undefined }).finally(() => {
    if (passes.get(key) === pass) passes.delete(key);
  });
  passes.set(key, pass);
  return pass;
}
