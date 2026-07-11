// In-memory cache for session entries (used by the history API).
//
// Freshness is keyed off the session file's mtime: when the underlying
// `.jsonl` changes (pi appends new messages, runs compaction, etc.) the cache
// entry is dropped automatically the next time it's consulted. This avoids
// the need for any invalidation hook in the SSE / RPC write paths — whoever
// writes to the file already bumps its mtime, so a single `statSync` on read
// is enough to detect staleness.
//
// The cache is cleared on server restart (in-memory only).

const entriesCache = new Map<string, { entries: unknown[]; fileMtime: number }>();
const MAX_CACHE_ENTRIES = 50; // max sessions cached

/** Evict the oldest cached entry to make room. */
function evictOldestCacheEntry(): void {
  // Map preserves insertion order; the first entry is the oldest.
  const oldestKey = entriesCache.keys().next().value;
  if (oldestKey !== undefined) entriesCache.delete(oldestKey);
}

/**
 * Get cached entries for a session, but only if the on-disk file hasn't
 * changed since they were cached. Returns `undefined` on a miss or when the
 * mtime check fails (in which case the stale entry is dropped).
 *
 * `fileMtime` is the file's current mtimeMs — callers obtain it via a single
 * `statSync(filePath).mtimeMs` and pass it in. This keeps stat calls to one
 * per request instead of per cache lookup.
 */
export function getCachedEntries(id: string, fileMtime: number): unknown[] | undefined {
  const cached = entriesCache.get(id);
  if (cached) {
    if (cached.fileMtime === fileMtime) return cached.entries;
    // File changed since cache was populated — drop the stale entry.
    entriesCache.delete(id);
  }
  // Proactively make room for the next setCachedEntries call.
  if (entriesCache.size >= MAX_CACHE_ENTRIES) evictOldestCacheEntry();
  return undefined;
}

/**
 * Store entries in the cache together with the file mtime that observed them,
 * so a later `getCachedEntries` call can verify they're still fresh.
 */
export function setCachedEntries(id: string, entries: unknown[], fileMtime: number): void {
  if (!entriesCache.has(id) && entriesCache.size >= MAX_CACHE_ENTRIES) {
    evictOldestCacheEntry();
  }
  entriesCache.set(id, { entries, fileMtime });
}

/**
 * Invalidate the cache for a session explicitly. Callers that KNOW they
 * just mutated the file (e.g. direct session writes from this process) can
 * use this to skip the next stat check; for SSE-driven writes from the pi
 * agent process the mtime check already handles it.
 */
export function invalidateSessionEntriesCache(id: string): void {
  entriesCache.delete(id);
}
