interface CacheState<T> {
  value?: T;
  expiresAt: number;
  inFlight?: Promise<T>;
}

/**
 * A value fetched by `load` and kept for `ttlMs`. Callers that ask while a
 * fetch is on its way share it; a failed fetch answers with the last value
 * when there is one. The state lives on `globalThis` under `key`, so a dev
 * server's hot reload keeps it.
 */
export function createRefreshingCache<T>(key: string, ttlMs: number, load: () => Promise<T>): () => Promise<T> {
  const slot = Symbol.for(key);
  const state = (): CacheState<T> => {
    const global = globalThis as Record<symbol, CacheState<T> | undefined>;
    return global[slot] ??= { expiresAt: 0 };
  };

  return async () => {
    const cache = state();
    if (cache.value !== undefined && cache.expiresAt > Date.now()) return cache.value;
    cache.inFlight ??= load().then((value) => {
      cache.value = value;
      cache.expiresAt = Date.now() + ttlMs;
      return value;
    }).finally(() => {
      cache.inFlight = undefined;
    });

    try {
      return await cache.inFlight;
    } catch (error) {
      if (cache.value !== undefined) return cache.value;
      throw error;
    }
  };
}
