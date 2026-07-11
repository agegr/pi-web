// In-memory cache for session entries (used by history API)
// Cleared on server restart

const entriesCache = new Map<string, { entries: any[]; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_ENTRIES = 50; // max sessions cached

export { entriesCache, CACHE_TTL };

/** Evict oldest entry when cache is full */
function evictOldestCacheEntry() {
  let oldestKey: string | null = null;
  let oldestTs = Infinity;
  for (const [key, val] of entriesCache) {
    if (val.timestamp < oldestTs) { oldestTs = val.timestamp; oldestKey = key; }
  }
  if (oldestKey) entriesCache.delete(oldestKey);
}

/** Get or create cached entries for a session */
export function getCachedEntries(id: string): { entries: any[]; timestamp: number } | undefined {
  const cached = entriesCache.get(id);
  if (cached && Date.now() - cached.timestamp <= CACHE_TTL) return cached;
  if (entriesCache.size >= MAX_CACHE_ENTRIES) evictOldestCacheEntry();
  return undefined;
}

/** Store entries in cache */
export function setCachedEntries(id: string, entries: any[]) {
  if (entriesCache.size >= MAX_CACHE_ENTRIES) evictOldestCacheEntry();
  entriesCache.set(id, { entries, timestamp: Date.now() });
}

/** Invalidate cache for a session (call after new messages are written) */
export function invalidateSessionEntriesCache(id: string) {
  entriesCache.delete(id);
}
