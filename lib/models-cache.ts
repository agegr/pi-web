export interface ModelsData {
  models: Record<string, string>;
  modelList: { id: string; name: string; provider: string; providerName: string; input?: string[] }[];
  defaultModel: { provider: string; modelId: string } | null;
  /** Resolved thinking level a new session starts with when the user has not picked one. */
  defaultThinkingLevel: string | null;
  /** `defaultThinkingLevel` as saved in settings, which the reasoning selector's star marks. */
  savedDefaultThinkingLevel: string | null;
  thinkingLevels: Record<string, string[]>;
  thinkingLevelMaps: Record<string, Record<string, string | null>>;
  /** `provider/modelId` → thinking level pinned by an `enabledModels` `:level` suffix. */
  thinkingLevelPins: Record<string, string>;
  modelError?: string;
  /** Warnings from resolving the `enabledModels` scope (e.g. a pattern matched nothing). */
  modelScopeWarnings?: string[];
  /** True when enabledModels is active and restricting the model list. */
  isScoped?: boolean;
}

interface ModelsCacheState {
  entries: Map<string, { data: ModelsData; expiresAt: number }>;
  inFlight: Map<string, Promise<ModelsData>>;
  generation: number;
}

declare global {
  var __piModelsCacheState: ModelsCacheState | undefined;
}

const MODELS_CACHE_TTL_MS = 60_000;
const MAX_MODELS_CACHE_ENTRIES = 32;
// Never interpolate the caught error here; SDK errors can contain paths and provider details.
const SAFE_MODEL_LOAD_FAILURE_MESSAGE = "Model list is temporarily unavailable. Check your configuration and try again.";

function getModelsCacheState(): ModelsCacheState {
  if (!globalThis.__piModelsCacheState) {
    globalThis.__piModelsCacheState = {
      entries: new Map(),
      inFlight: new Map(),
      generation: 0,
    };
  }
  return globalThis.__piModelsCacheState;
}

export function invalidateModelsCache(): void {
  const state = getModelsCacheState();
  state.generation += 1;
  state.entries.clear();
  state.inFlight.clear();
}

export function withModelRuntimeError(data: ModelsData, modelError: string | undefined): ModelsData {
  return modelError ? { ...data, modelError } : data;
}

export function withSafeModelLoadFailure(data: ModelsData): ModelsData {
  return { ...data, modelError: SAFE_MODEL_LOAD_FAILURE_MESSAGE };
}

export function loadModelsWithCache(cwd: string, loader: () => Promise<ModelsData>): Promise<ModelsData> {
  const state = getModelsCacheState();
  const cached = state.entries.get(cwd);
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.data);

  // Stale-while-revalidate. A miss rebuilds the whole session service graph
  // (createAgentSessionServices: every extension, every credential), which takes seconds on
  // a host where one lstat costs ~1ms, and it holds the event loop, so the rest of the page
  // load waits behind it. An expired entry that still holds a model list answers as-is while
  // the rebuild runs in the background. An entry with no models (a failed load) still blocks:
  // an old good list must not hide a configuration that is broken now.
  const stale = cached && cached.data.modelList.length > 0 ? cached.data : undefined;

  const existingLoad = state.inFlight.get(cwd);
  if (existingLoad) return stale ? Promise.resolve(stale) : existingLoad;

  const generation = state.generation;
  const loadPromise: Promise<ModelsData> = Promise.resolve()
    .then(loader)
    .then((data) => {
      if (state.generation === generation && state.inFlight.get(cwd) === loadPromise) {
        const now = Date.now();
        // Expired entries are kept: they are what the next request serves while this rebuild
        // runs. Re-inserting the refreshed entry moves it to the end, so the cap evicts the
        // least recently written entry rather than this one.
        state.entries.delete(cwd);
        while (state.entries.size >= MAX_MODELS_CACHE_ENTRIES) {
          const oldestKey = state.entries.keys().next().value;
          if (oldestKey === undefined) break;
          state.entries.delete(oldestKey);
        }
        state.entries.set(cwd, { data, expiresAt: now + MODELS_CACHE_TTL_MS });
      }
      return data;
    })
    .finally(() => {
      if (state.inFlight.get(cwd) === loadPromise) state.inFlight.delete(cwd);
    });

  state.inFlight.set(cwd, loadPromise);
  if (!stale) return loadPromise;

  // Nobody awaits the background rebuild, so a failure must not surface as an unhandled
  // rejection; the next request retries.
  void loadPromise.catch(() => {});
  return Promise.resolve(stale);
}
