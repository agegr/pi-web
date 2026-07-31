import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import { getAgentDir, getSessionEntries, listAllSessions } from "./session-reader";
import type { AssistantMessage, SessionMessageEntry } from "./types";

// ============================================================================
// Persistent usage store.
//
// Records per-message token/cost usage for assistant messages *created after
// the feature was installed* — historical session content is intentionally
// ignored. The store lives next to pi's own config as
// ~/.pi/agent/pi-web-usage.json and is updated incrementally: each session
// file is only re-parsed when its mtime changes, and per-file `seen` entry
// ids make re-scans idempotent (entries are never double-counted, even if a
// session file is fully rewritten by pi).
// ============================================================================

export interface UsageBucket {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  messages: number;
  /** Unique session ids that contributed to this bucket */
  sessions: string[];
}

interface SessionFileState {
  mtimeMs: number;
  /** Entry ids already folded into buckets — guards against double counting */
  seen: string[];
}

interface UsageStoreData {
  version: 1;
  /** ISO timestamp; entries older than this are never recorded */
  installedAt: string;
  /** Keyed by session file path */
  files: Record<string, SessionFileState>;
  /** days[localDay]["provider/model"] = bucket */
  days: Record<string, Record<string, UsageBucket>>;
}

export type UsageRange = "today" | "7d" | "30d" | "all";

export interface UsageModelStats {
  provider: string;
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  messages: number;
  sessions: number;
}

export interface UsageReport {
  range: UsageRange;
  installedAt: string;
  models: UsageModelStats[];
  totals: Omit<UsageModelStats, "provider" | "model">;
  /** Per-day totals within the range, ascending by day */
  daily: { day: string; cost: number; tokens: number; messages: number }[];
}

declare global {
  var __piUsageScanPromise: Promise<void> | undefined;
}

function usageStorePath(): string {
  return join(getAgentDir(), "pi-web-usage.json");
}

function emptyStore(): UsageStoreData {
  return { version: 1, installedAt: new Date().toISOString(), files: {}, days: {} };
}

function loadStore(): UsageStoreData {
  try {
    const raw = readFileSync(usageStorePath(), "utf8");
    const data = JSON.parse(raw) as UsageStoreData;
    if (data && data.version === 1 && typeof data.installedAt === "string" && data.days && data.files) {
      return data;
    }
  } catch {
    // Missing or corrupt file — start fresh.
  }
  return emptyStore();
}

function saveStore(data: UsageStoreData): void {
  const dir = getAgentDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const target = usageStorePath();
  const tmp = `${target}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(data), "utf8");
  renameSync(tmp, target);
}

/** Local (server timezone) YYYY-MM-DD day key. */
function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function emptyBucket(): UsageBucket {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, messages: 0, sessions: [] };
}

function recordEntry(store: UsageStoreData, sessionId: string, entry: SessionMessageEntry, message: AssistantMessage): void {
  const usage = message.usage;
  if (!usage) return;
  const ts = Date.parse(entry.timestamp);
  if (Number.isNaN(ts)) return;

  const key = dayKey(new Date(ts));
  const modelKey = `${message.provider}/${message.model}`;
  const dayBucket = (store.days[key] ??= {});
  const bucket = (dayBucket[modelKey] ??= emptyBucket());

  bucket.input += usage.input || 0;
  bucket.output += usage.output || 0;
  bucket.cacheRead += usage.cacheRead || 0;
  bucket.cacheWrite += usage.cacheWrite || 0;
  bucket.cost += usage.cost?.total || 0;
  bucket.messages += 1;
  if (!bucket.sessions.includes(sessionId)) bucket.sessions.push(sessionId);
}

/**
 * Incrementally fold new assistant usage entries into the store.
 * Only entries at/after `installedAt` are considered; files that have not
 * changed since the last scan are skipped via mtime. Coalesced so concurrent
 * API requests share a single scan.
 */
export async function scanUsage(): Promise<void> {
  if (globalThis.__piUsageScanPromise) return globalThis.__piUsageScanPromise;

  const promise = (async () => {
    const sessions = await listAllSessions();
    const store = loadStore();
    const cutoff = Date.parse(store.installedAt);
    let dirty = false;

    for (const session of sessions) {
      let mtimeMs: number;
      try {
        mtimeMs = statSync(session.path).mtimeMs;
      } catch {
        continue; // File vanished between listing and stat.
      }

      const state = store.files[session.path];
      if (state && state.mtimeMs === mtimeMs) continue;

      let entries;
      try {
        entries = getSessionEntries(session.path);
      } catch {
        continue; // Unreadable/partially-written file; retry next scan.
      }

      const seen = new Set(state?.seen ?? []);
      for (const entry of entries) {
        if (entry.type !== "message" || seen.has(entry.id)) continue;
        const message = (entry as SessionMessageEntry).message;
        if (message.role !== "assistant") continue;
        const ts = Date.parse(entry.timestamp);
        if (Number.isNaN(ts) || ts < cutoff) continue;
        const assistant = message as AssistantMessage;
        if (!assistant.usage) continue;
        recordEntry(store, session.id, entry as SessionMessageEntry, assistant);
        seen.add(entry.id);
        dirty = true;
      }

      store.files[session.path] = { mtimeMs, seen: [...seen] };
    }

    if (dirty || !existsSync(usageStorePath())) saveStore(store);
  })();

  globalThis.__piUsageScanPromise = promise;
  try {
    await promise;
  } finally {
    if (globalThis.__piUsageScanPromise === promise) {
      globalThis.__piUsageScanPromise = undefined;
    }
  }
}

function rangeStartDay(range: UsageRange, today: string): string | null {
  if (range === "all") return null;
  if (range === "today") return today;
  const days = range === "7d" ? 6 : 29; // inclusive of today
  const d = new Date();
  d.setDate(d.getDate() - days);
  return dayKey(d);
}

/** Aggregate stored buckets into a report for the requested range. */
export function aggregateUsage(range: UsageRange): UsageReport {
  const store = loadStore();
  const today = dayKey(new Date());
  const startDay = rangeStartDay(range, today);

  const byModel = new Map<string, UsageModelStats>();
  const sessionsByModel = new Map<string, Set<string>>();
  const dailyMap = new Map<string, { day: string; cost: number; tokens: number; messages: number }>();

  for (const [day, dayModels] of Object.entries(store.days)) {
    if (startDay && day < startDay) continue;
    for (const [modelKey, bucket] of Object.entries(dayModels)) {
      const slash = modelKey.indexOf("/");
      const provider = slash === -1 ? "" : modelKey.slice(0, slash);
      const model = slash === -1 ? modelKey : modelKey.slice(slash + 1);

      const stats = byModel.get(modelKey) ?? {
        provider, model, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, messages: 0, sessions: 0,
      };
      stats.input += bucket.input;
      stats.output += bucket.output;
      stats.cacheRead += bucket.cacheRead;
      stats.cacheWrite += bucket.cacheWrite;
      stats.cost += bucket.cost;
      stats.messages += bucket.messages;
      byModel.set(modelKey, stats);

      const sessionSet = sessionsByModel.get(modelKey) ?? new Set<string>();
      for (const id of bucket.sessions) sessionSet.add(id);
      sessionsByModel.set(modelKey, sessionSet);

      const d = dailyMap.get(day) ?? { day, cost: 0, tokens: 0, messages: 0 };
      d.cost += bucket.cost;
      d.tokens += bucket.input + bucket.output + bucket.cacheRead + bucket.cacheWrite;
      d.messages += bucket.messages;
      dailyMap.set(day, d);
    }
  }

  const models = [...byModel.values()]
    .map((m) => ({ ...m, sessions: sessionsByModel.get(m.provider + "/" + m.model)?.size ?? 0 }))
    .sort((a, b) => b.cost - a.cost || b.input + b.output - (a.input + a.output));

  const totals = models.reduce(
    (acc, m) => ({
      input: acc.input + m.input,
      output: acc.output + m.output,
      cacheRead: acc.cacheRead + m.cacheRead,
      cacheWrite: acc.cacheWrite + m.cacheWrite,
      cost: acc.cost + m.cost,
      messages: acc.messages + m.messages,
      sessions: 0,
    }),
    { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, messages: 0, sessions: 0 },
  );
  const allSessions = new Set<string>();
  for (const set of sessionsByModel.values()) for (const id of set) allSessions.add(id);
  totals.sessions = allSessions.size;

  const daily = [...dailyMap.values()].sort((a, b) => (a.day < b.day ? -1 : 1));

  return { range, installedAt: store.installedAt, models, totals, daily };
}
