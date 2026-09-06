import { SessionManager } from "@earendil-works/pi-coding-agent";
import { stat } from "node:fs/promises";
import { normalize } from "node:path";
import { projectTreeForResponse } from "./project-tree";
import { computeSessionStats, type SessionFileStats } from "./session-stats";
import type { SessionContext, SessionEntry, SessionHeader, SessionTreeNode } from "./types";

interface SessionFingerprint {
  size: bigint;
  mtimeNs: bigint;
  ctimeNs: bigint;
  dev: bigint;
  ino: bigint;
}

export interface ParsedSessionSnapshot {
  entries: SessionEntry[];
  filePath: string;
  fingerprint: string;
  header: SessionHeader | null;
  sourceBytes: number;
  leafId: string | null;
  sessionName?: string;
  tree: SessionTreeNode[];
  stats: SessionFileStats;
}

interface CacheEntry {
  snapshot: ParsedSessionSnapshot;
  bytes: number;
}

interface ContextCacheEntry {
  context: SessionContext;
  bytes: number;
}

interface SessionDetailCacheState {
  entries: Map<string, CacheEntry>;
  contextEntries: Map<string, ContextCacheEntry>;
  inFlight: Map<string, Promise<ParsedSessionSnapshot>>;
  totalBytes: number;
  totalContextBytes: number;
}

declare global {
  var __piSessionDetailCache: SessionDetailCacheState | undefined;
}

const MAX_CACHE_ENTRIES = 8;
const MAX_CACHE_BYTES = 96 * 1024 * 1024;
const MAX_ENTRY_BYTES = 64 * 1024 * 1024;
const MAX_CONTEXT_ENTRIES = 12;
const MAX_CONTEXT_BYTES = 96 * 1024 * 1024;
const MAX_CONTEXT_ENTRY_BYTES = 64 * 1024 * 1024;

function state(): SessionDetailCacheState {
  if (!globalThis.__piSessionDetailCache) {
    globalThis.__piSessionDetailCache = {
      entries: new Map(),
      contextEntries: new Map(),
      inFlight: new Map(),
      totalBytes: 0,
      totalContextBytes: 0,
    };
  }
  const cache = globalThis.__piSessionDetailCache;
  // Keep development HMR compatible when the cache shape gains a field.
  cache.contextEntries ??= new Map();
  cache.totalContextBytes ??= 0;
  return cache;
}

async function fingerprint(filePath: string): Promise<SessionFingerprint> {
  const fileStat = await stat(filePath, { bigint: true });
  return {
    size: fileStat.size,
    mtimeNs: fileStat.mtimeNs,
    ctimeNs: fileStat.ctimeNs,
    dev: fileStat.dev,
    ino: fileStat.ino,
  };
}

function fingerprintKey(value: SessionFingerprint): string {
  return [value.size, value.mtimeNs, value.ctimeNs, value.dev, value.ino].join(":");
}

function equalFingerprint(left: SessionFingerprint, right: SessionFingerprint): boolean {
  return fingerprintKey(left) === fingerprintKey(right);
}

function cacheKey(filePath: string, value: SessionFingerprint): string {
  return `${normalize(filePath)}\0${fingerprintKey(value)}`;
}

function getCached(key: string): ParsedSessionSnapshot | null {
  const cache = state();
  const entry = cache.entries.get(key);
  if (!entry) return null;
  cache.entries.delete(key);
  cache.entries.set(key, entry);
  return entry.snapshot;
}

function setCached(key: string, snapshot: ParsedSessionSnapshot, bytes: number): void {
  if (bytes > MAX_ENTRY_BYTES) return;
  const cache = state();
  const previous = cache.entries.get(key);
  if (previous) {
    cache.entries.delete(key);
    cache.totalBytes -= previous.bytes;
  }
  cache.entries.set(key, { snapshot, bytes });
  cache.totalBytes += bytes;
  while (cache.entries.size > MAX_CACHE_ENTRIES || cache.totalBytes > MAX_CACHE_BYTES) {
    const oldestKey = cache.entries.keys().next().value as string | undefined;
    if (!oldestKey) break;
    const oldest = cache.entries.get(oldestKey);
    cache.entries.delete(oldestKey);
    cache.totalBytes -= oldest?.bytes ?? 0;
  }
}

async function parseStableSession(filePath: string): Promise<ParsedSessionSnapshot> {
  let before = await fingerprint(filePath);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const manager = SessionManager.open(filePath);
    const entries = manager.getEntries() as unknown as SessionEntry[];
    const snapshot: ParsedSessionSnapshot = {
      entries,
      stats: computeSessionStats(entries),
      filePath: manager.getSessionFile() || filePath,
      fingerprint: "",
      header: manager.getHeader() as SessionHeader | null,
      sourceBytes: Number(before.size),
      leafId: manager.getLeafId(),
      sessionName: manager.getSessionName(),
      tree: projectTreeForResponse(manager.getTree()) as SessionTreeNode[],
    };
    const after = await fingerprint(filePath);
    if (equalFingerprint(before, after)) {
      snapshot.fingerprint = fingerprintKey(after);
      snapshot.sourceBytes = Number(after.size);
      setCached(cacheKey(filePath, after), snapshot, Number(after.size) * 2);
      return snapshot;
    }
    before = after;
  }
  throw new Error("Session changed repeatedly while being read");
}

export async function getParsedSessionSnapshot(filePath: string): Promise<ParsedSessionSnapshot> {
  const current = await fingerprint(filePath);
  const key = cacheKey(filePath, current);
  const cached = getCached(key);
  if (cached) return cached;

  const cache = state();
  const existing = cache.inFlight.get(key);
  if (existing) return existing;
  const pending = parseStableSession(filePath).finally(() => {
    if (cache.inFlight.get(key) === pending) cache.inFlight.delete(key);
  });
  cache.inFlight.set(key, pending);
  return pending;
}

export function getSessionContextFromSnapshot(
  snapshot: ParsedSessionSnapshot,
  leafId: string | null | undefined,
  options: { deferThinking: boolean; deferToolResultImages: boolean; sessionId?: string },
  build: () => SessionContext,
): SessionContext {
  const key = [
    normalize(snapshot.filePath),
    snapshot.fingerprint,
    "history-v2",
    JSON.stringify(leafId === undefined ? { defaultLeaf: true } : leafId),
    options.deferThinking ? "1" : "0",
    options.deferToolResultImages ? "1" : "0",
    options.sessionId ?? "",
  ].join("\0");
  const cache = state();
  const existing = cache.contextEntries.get(key);
  if (existing) {
    cache.contextEntries.delete(key);
    cache.contextEntries.set(key, existing);
    return existing.context;
  }

  const context = build();
  const bytes = snapshot.sourceBytes * 2;
  if (bytes <= MAX_CONTEXT_ENTRY_BYTES) {
    cache.contextEntries.set(key, { context, bytes });
    cache.totalContextBytes += bytes;
    while (
      cache.contextEntries.size > MAX_CONTEXT_ENTRIES
      || cache.totalContextBytes > MAX_CONTEXT_BYTES
    ) {
      const oldestKey = cache.contextEntries.keys().next().value as string | undefined;
      if (!oldestKey) break;
      const oldest = cache.contextEntries.get(oldestKey);
      cache.contextEntries.delete(oldestKey);
      cache.totalContextBytes -= oldest?.bytes ?? 0;
    }
  }
  return context;
}

export function invalidateParsedSession(filePath: string): void {
  const prefix = `${normalize(filePath)}\0`;
  const cache = state();
  for (const [key, entry] of cache.entries) {
    if (!key.startsWith(prefix)) continue;
    cache.entries.delete(key);
    cache.totalBytes -= entry.bytes;
  }
  for (const [key, entry] of cache.contextEntries) {
    if (!key.startsWith(prefix)) continue;
    cache.contextEntries.delete(key);
    cache.totalContextBytes -= entry.bytes;
  }
}

export function sessionDetailCacheStats(): {
  entries: number;
  bytes: number;
  contextEntries: number;
  contextBytes: number;
  inFlight: number;
} {
  const cache = state();
  return {
    entries: cache.entries.size,
    bytes: cache.totalBytes,
    contextEntries: cache.contextEntries.size,
    contextBytes: cache.totalContextBytes,
    inFlight: cache.inFlight.size,
  };
}
