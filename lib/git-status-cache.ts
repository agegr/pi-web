import type { GitStatusResponse } from "./git-types";

/**
 * A short TTL for the Git status listing, which is a full working-tree scan
 * (`getGitStatus()` in lib/git-changes.ts, untracked files read one by one).
 * The sidebar refetches it on every reload trigger and at most once a second
 * while a run's tools finish, so identical requests arrive in bursts — from one
 * panel, from two tabs on one project. The first of a burst scans, a concurrent
 * one joins it, and a repeat inside the TTL reuses the answer.
 *
 * The entry is dropped before a request scans once it has expired, so a listing
 * is never served older than the TTL: the changed-file badges are what the
 * focus reload (#1144) exists to refresh, and an edit made in an editor must
 * show up on that reload. Eager invalidation covers the writes Pi Web itself
 * makes to a working tree.
 *
 * Keyed by the cwd exactly as the caller spells it, because the answer's paths
 * are rebased onto it (lib/git-changes.ts): two spellings of one folder are two
 * entries on purpose, and one project's entry is never another's.
 */

interface GitStatusCacheState {
  entries: Map<string, { status: GitStatusResponse; expiresAt: number }>;
  inFlight: Map<string, Promise<GitStatusResponse>>;
  generation: number;
}

declare global {
  var __piGitStatusCache: GitStatusCacheState | undefined;
}

export const GIT_STATUS_CACHE_TTL_MS = 2_000;
const MAX_GIT_STATUS_CACHE_ENTRIES = 32;

function getGitStatusCache(): GitStatusCacheState {
  if (!globalThis.__piGitStatusCache) {
    globalThis.__piGitStatusCache = { entries: new Map(), inFlight: new Map(), generation: 0 };
  }
  return globalThis.__piGitStatusCache;
}

/**
 * Forget every cached listing after Pi Web has written to a working tree — an
 * upload (`/api/files ?type=upload`). Global rather than per cwd because an
 * upload's folder may be below a cwd whose listing reports it, and a stale
 * in-flight scan must not refill the cache.
 */
export function invalidateGitStatusCache(): void {
  const state = getGitStatusCache();
  state.generation += 1;
  state.entries.clear();
  state.inFlight.clear();
}

export function loadGitStatusWithCache(
  cwd: string,
  loader: () => Promise<GitStatusResponse>,
): Promise<GitStatusResponse> {
  const state = getGitStatusCache();
  const cached = state.entries.get(cwd);
  if (cached) {
    if (cached.expiresAt > Date.now()) return Promise.resolve(cached.status);
    state.entries.delete(cwd);
  }

  const existingLoad = state.inFlight.get(cwd);
  if (existingLoad) return existingLoad;

  const generation = state.generation;
  const loadPromise: Promise<GitStatusResponse> = Promise.resolve()
    .then(loader)
    .then((status) => {
      if (state.generation === generation && state.inFlight.get(cwd) === loadPromise) {
        const now = Date.now();
        for (const [key, entry] of state.entries) {
          if (entry.expiresAt <= now) state.entries.delete(key);
        }
        while (state.entries.size >= MAX_GIT_STATUS_CACHE_ENTRIES) {
          const oldestKey = state.entries.keys().next().value;
          if (oldestKey === undefined) break;
          state.entries.delete(oldestKey);
        }
        state.entries.set(cwd, { status, expiresAt: now + GIT_STATUS_CACHE_TTL_MS });
      }
      return status;
    })
    .finally(() => {
      if (state.inFlight.get(cwd) === loadPromise) state.inFlight.delete(cwd);
    });

  state.inFlight.set(cwd, loadPromise);
  return loadPromise;
}
