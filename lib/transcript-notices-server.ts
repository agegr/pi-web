import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { AgentUsage, SessionEntry } from "./types";
import { withTranscriptNotices, type TranscriptNotice } from "./transcript-notices";

type CacheWarmNotice = Extract<TranscriptNotice, { kind: "cache_warm" }>;

// The notices pi's TUI shows when `showCacheMissNotices` is on (#1265), derived
// from session entries so a reload, a reconnect or an older page shows the same
// ones: cache misses are never persisted, the TUI re-derives them too.
// `scanCacheMisses()` ports the SDK's core/cache-stats.js, which the package
// does not export; lib/transcript-notices.test.mjs compares the two.

/** Idle gaps past this are named as the likely cause of a miss (Anthropic's default cache TTL). */
const CACHE_TTL_MS = 5 * 60 * 1000;
/** Per-turn misses at or below this are cache breakpoint granularity noise. */
const NOISE_FLOOR_TOKENS = 1024;
/** The TUI shows a miss from 20k re-billed tokens or $0.10 up. */
const NOTICE_MIN_TOKENS = 20_000;
const NOTICE_MIN_COST = 0.1;

/** The part of pi's ModelRuntime the cost of a total miss needs. */
export interface NoticeModelLookup {
  getModel(provider: string, modelId: string): { cost?: { cacheRead?: number } } | undefined;
}

interface UsageMessage {
  role: "assistant";
  provider: string;
  model: string;
  timestamp: number;
  usage: AgentUsage;
  stopReason?: string;
  diagnostics?: unknown;
}

interface PreviousRequest {
  promptTokens: number;
  modelKey: string;
  timestamp: number;
  reportedCache: boolean;
}

export interface CacheMiss {
  missedTokens: number;
  missedCost: number;
  idleMs: number;
  modelChanged: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUsage(value: unknown): value is AgentUsage {
  return isRecord(value)
    && typeof value.input === "number"
    && typeof value.output === "number"
    && typeof value.cacheRead === "number"
    && typeof value.cacheWrite === "number"
    && isRecord(value.cost);
}

function assistantMessageOf(entry: SessionEntry): UsageMessage | undefined {
  if (entry.type !== "message") return undefined;
  const message = entry.message as unknown as Record<string, unknown>;
  if (message.role !== "assistant" || !isUsage(message.usage)) return undefined;
  return message as unknown as UsageMessage;
}

function detectMiss(prev: PreviousRequest | undefined, message: UsageMessage, models: NoticeModelLookup): CacheMiss | undefined {
  const usage = message.usage;
  const promptTokens = usage.input + usage.cacheRead + usage.cacheWrite;
  // A zero-cache turn only counts when cache activity was reported before: on
  // cache-read-only providers that is a total miss, on providers that never
  // report caching it means nothing.
  if (!prev || promptTokens <= 0 || (usage.cacheRead + usage.cacheWrite === 0 && !prev.reportedCache)) {
    return undefined;
  }
  const missedTokens = Math.min(prev.promptTokens, promptTokens) - usage.cacheRead;
  if (missedTokens <= NOISE_FLOOR_TOKENS) return undefined;
  // Missed tokens land in the input or cacheWrite buckets, so the paid rate
  // comes from this message's own cost breakdown.
  const paidTokens = usage.input + usage.cacheWrite;
  const paidPerToken = paidTokens > 0 ? (usage.cost.input + usage.cost.cacheWrite) / paidTokens : 0;
  const readPerToken = usage.cacheRead > 0
    ? usage.cost.cacheRead / usage.cacheRead
    : (models.getModel(message.provider, message.model)?.cost?.cacheRead ?? 0) / 1_000_000;
  return {
    missedTokens,
    missedCost: missedTokens * Math.max(0, paidPerToken - readPerToken),
    idleMs: Math.max(0, message.timestamp - prev.timestamp),
    modelChanged: `${message.provider}/${message.model}` !== prev.modelKey,
  };
}

function asPreviousRequest(message: UsageMessage, reportedCache: boolean): PreviousRequest | undefined {
  const usage = message.usage;
  const promptTokens = usage.input + usage.cacheRead + usage.cacheWrite;
  if (promptTokens <= 0) return undefined;
  return {
    promptTokens,
    modelKey: `${message.provider}/${message.model}`,
    timestamp: message.timestamp,
    reportedCache: reportedCache || usage.cacheRead + usage.cacheWrite > 0,
  };
}

/**
 * The SDK's cache-stats scan: every entry in file order (pi's `getEntries()`,
 * other branches included, as the TUI reads it). `misses` is keyed by entry id.
 */
export function scanCacheMisses(
  entries: readonly SessionEntry[],
  models: NoticeModelLookup,
): { prev: PreviousRequest | undefined; misses: Map<string, CacheMiss> } {
  let prev: PreviousRequest | undefined;
  const misses = new Map<string, CacheMiss>();
  for (const entry of entries) {
    if (entry.type === "compaction" || entry.type === "branch_summary") {
      // The context changed on purpose: the next prompt is new content, not
      // re-billed content. Model switches are not exempt.
      prev = undefined;
      continue;
    }
    if (entry.type === "usage" && entry.kind === "cache_warm") {
      if (!isUsage(entry.usage)) continue;
      const promptTokens = entry.usage.input + entry.usage.cacheRead + entry.usage.cacheWrite;
      if (promptTokens > 0) {
        prev = {
          promptTokens,
          modelKey: `${entry.provider}/${entry.model}`,
          timestamp: Date.parse(entry.timestamp),
          reportedCache: true,
        };
      }
      continue;
    }
    const message = assistantMessageOf(entry);
    if (!message) continue;
    const miss = detectMiss(prev, message, models);
    if (miss) misses.set(entry.id, miss);
    prev = asPreviousRequest(message, prev?.reportedCache ?? false) ?? prev;
  }
  return { prev, misses };
}

function cacheMissNotice(miss: CacheMiss): TranscriptNotice | undefined {
  if (miss.missedTokens < NOTICE_MIN_TOKENS && miss.missedCost < NOTICE_MIN_COST) return undefined;
  return {
    kind: "cache_miss",
    missedTokens: miss.missedTokens,
    missedCost: miss.missedCost,
    ...(miss.modelChanged
      ? { modelChanged: true }
      : miss.idleMs >= CACHE_TTL_MS ? { idleMinutes: Math.round(miss.idleMs / 60_000) } : {}),
  };
}

/** Thinking blocks Anthropic dropped from the request that produced `message`. */
export function countDroppedThinkingBlocks(message: unknown): number {
  if (!isRecord(message) || !Array.isArray(message.diagnostics)) return 0;
  let count = 0;
  for (const diagnostic of message.diagnostics) {
    if (!isRecord(diagnostic) || diagnostic.type !== "anthropic_input_transformations") continue;
    const transformations = isRecord(diagnostic.details) ? diagnostic.details.transformations : undefined;
    if (!Array.isArray(transformations)) continue;
    count += transformations.filter((t) => isRecord(t) && t.type === "thinking_dropped").length;
  }
  return count;
}

/** Shown only when more were dropped than for the previous response, as the TUI does. */
function thinkingDroppedNotice(dropped: number, previousDropped: number): TranscriptNotice | undefined {
  return dropped > previousDropped ? { kind: "thinking_dropped", count: dropped } : undefined;
}

function summaryCostNotice(source: "compaction" | "branch_summary", usage: unknown): TranscriptNotice | undefined {
  if (!isUsage(usage)) return undefined;
  return {
    kind: "summary_cost",
    source,
    tokens: usage.input + usage.output + usage.cacheRead + usage.cacheWrite,
    cost: typeof usage.cost.total === "number" ? usage.cost.total : 0,
  };
}

/** An entry the chat shows as a message of its own, which notices can follow. */
function rendersStandalone(entry: SessionEntry): boolean {
  switch (entry.type) {
    case "message": {
      const role = (entry.message as { role?: string }).role;
      return role !== "toolResult" && role !== "system";
    }
    case "compaction":
      return true;
    case "branch_summary":
      return Boolean(entry.summary);
    case "custom_message":
      return entry.display;
    default:
      return false;
  }
}

function pushNotice(map: Map<string, TranscriptNotice[]>, entryId: string, notice: TranscriptNotice | undefined): void {
  if (!notice) return;
  const list = map.get(entryId);
  if (list) list.push(notice);
  else map.set(entryId, [notice]);
}

/**
 * Every notice of a session, keyed by the id of the entry whose chat message
 * it follows. Cache warming follows the nearest ancestor the chat shows (a tool
 * result is drawn inside its call), so it lands on the same message on any page.
 */
export function collectTranscriptNotices(
  entries: readonly SessionEntry[],
  models: NoticeModelLookup,
  options: { leafId?: string | null } = {},
): Map<string, TranscriptNotice[]> {
  const notices = new Map<string, TranscriptNotice[]>();
  const byId = new Map<string, SessionEntry>();
  for (const entry of entries) byId.set(entry.id, entry);
  const ancestor = (entry: SessionEntry, match: (candidate: SessionEntry) => boolean): SessionEntry | undefined => {
    let current = entry.parentId ? byId.get(entry.parentId) : undefined;
    while (current && !match(current)) current = current.parentId ? byId.get(current.parentId) : undefined;
    return current;
  };
  // Cache warming hangs on an ancestor that other branches share too, so it
  // shows only on the branch it was billed on, as the TUI renders it from context.
  let onBranch: Set<string> | undefined;
  if (options.leafId) {
    onBranch = new Set();
    for (let current = byId.get(options.leafId); current; current = current.parentId ? byId.get(current.parentId) : undefined) {
      onBranch.add(current.id);
    }
  }

  const { misses } = scanCacheMisses(entries, models);
  // The line each cache_warm entry was drawn in, by entry id.
  const warmLines = new Map<string, CacheWarmNotice>();
  for (const entry of entries) {
    switch (entry.type) {
      case "message": {
        const message = assistantMessageOf(entry);
        if (!message || message.stopReason === "aborted" || message.stopReason === "error") break;
        const miss = misses.get(entry.id);
        if (miss) pushNotice(notices, entry.id, cacheMissNotice(miss));
        const dropped = countDroppedThinkingBlocks(message);
        if (dropped > 0) {
          const previous = ancestor(entry, (candidate) => Boolean(assistantMessageOf(candidate)));
          const previousDropped = previous?.type === "message" ? countDroppedThinkingBlocks(previous.message) : 0;
          pushNotice(notices, entry.id, thinkingDroppedNotice(dropped, previousDropped));
        }
        break;
      }
      case "usage": {
        if (entry.kind !== "cache_warm" || !isUsage(entry.usage) || (onBranch && !onBranch.has(entry.id))) break;
        const anchor = ancestor(entry, rendersStandalone);
        if (!anchor) break;
        const cost = typeof entry.usage.cost.total === "number" ? entry.usage.cost.total : 0;
        // Back-to-back warms are one line with the cumulative cost, as pi's TUI
        // (1.5.1) draws them: a warm right after another with the same note,
        // while that line is still the anchor's last.
        const previous = entry.parentId ? warmLines.get(entry.parentId) : undefined;
        if (previous && previous.note === (entry.note || undefined) && notices.get(anchor.id)?.at(-1) === previous) {
          previous.cost += cost;
          warmLines.set(entry.id, previous);
          break;
        }
        const line: CacheWarmNotice = { kind: "cache_warm", cost, ...(entry.note ? { note: entry.note } : {}) };
        warmLines.set(entry.id, line);
        pushNotice(notices, anchor.id, line);
        break;
      }
      case "compaction":
        pushNotice(notices, entry.id, summaryCostNotice("compaction", entry.usage));
        break;
      case "branch_summary":
        if (entry.summary) pushNotice(notices, entry.id, summaryCostNotice("branch_summary", entry.usage));
        break;
    }
  }
  return notices;
}

/**
 * The notices of an assistant message that just completed, for its
 * `message_end`. pi announces it before writing it, so it is skipped if the
 * entries already hold it.
 */
export function collectLiveAssistantNotices(
  entries: readonly SessionEntry[],
  branch: readonly SessionEntry[],
  message: unknown,
  models: NoticeModelLookup,
): TranscriptNotice[] {
  if (!isRecord(message) || message.role !== "assistant" || !isUsage(message.usage)) return [];
  if (message.stopReason === "aborted" || message.stopReason === "error") return [];
  const isThis = (entry: SessionEntry) => entry.type === "message" && (entry.message as unknown) === message;
  const assistant = message as unknown as UsageMessage;
  const notices: TranscriptNotice[] = [];

  const { prev } = scanCacheMisses(entries.filter((entry) => !isThis(entry)), models);
  const miss = detectMiss(prev, assistant, models);
  const missNotice = miss ? cacheMissNotice(miss) : undefined;
  if (missNotice) notices.push(missNotice);

  const dropped = countDroppedThinkingBlocks(message);
  if (dropped > 0) {
    let previousDropped = 0;
    for (let i = branch.length - 1; i >= 0; i--) {
      const entry = branch[i];
      if (isThis(entry) || !assistantMessageOf(entry) || entry.type !== "message") continue;
      previousDropped = countDroppedThinkingBlocks(entry.message);
      break;
    }
    const droppedNotice = thinkingDroppedNotice(dropped, previousDropped);
    if (droppedNotice) notices.push(droppedNotice);
  }
  return notices;
}

interface CachedSetting {
  stamp: string;
  value: boolean | undefined;
}

const SETTING_CACHE_LIMIT = 200;
const settingCache = new Map<string, CachedSetting>();

/**
 * One settings file's `showCacheMissNotices`, read without pi's file lock:
 * `SettingsManager.create()` locks each file (a `settings.json.lock` directory
 * in the project) and busy-waits when another writer holds it, which every
 * history read and every reply would pay. Cached until the file changes.
 */
function readSettingFile(path: string): boolean | undefined {
  let stamp: string;
  try {
    const stats = statSync(path);
    stamp = `${stats.ino}:${stats.size}:${stats.mtimeMs}`;
  } catch {
    settingCache.delete(path);
    return undefined;
  }
  const cached = settingCache.get(path);
  if (cached?.stamp === stamp) return cached.value;
  let value: boolean | undefined;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
    const raw = isRecord(parsed) ? parsed.showCacheMissNotices : undefined;
    value = typeof raw === "boolean" ? raw : undefined;
  } catch {
    // pi skips a file it cannot parse, keeping the other one.
    value = undefined;
  }
  settingCache.delete(path);
  settingCache.set(path, { stamp, value });
  if (settingCache.size > SETTING_CACHE_LIMIT) settingCache.delete(settingCache.keys().next().value!);
  return value;
}

/** pi's `showCacheMissNotices` for a folder: project settings over global, off by default. */
export function readShowCacheMissNotices(cwd: string, agentDir: string = getAgentDir()): boolean {
  return readSettingFile(join(cwd, ".pi", "settings.json"))
    ?? readSettingFile(join(agentDir, "settings.json"))
    ?? false;
}

/**
 * The cache-read price of a model as the session's own replies paid it, for a
 * total miss when no runtime knows the model. Same figure as the model's
 * catalog price, and taken from the file alone, so every read of the session
 * prices it the same.
 */
function sessionCacheReadPrices(entries: readonly SessionEntry[]): NoticeModelLookup {
  const perMillion = new Map<string, number>();
  for (const entry of entries) {
    const message = assistantMessageOf(entry);
    if (!message || message.usage.cacheRead <= 0 || typeof message.usage.cost.cacheRead !== "number") continue;
    perMillion.set(`${message.provider}/${message.model}`, message.usage.cost.cacheRead / message.usage.cacheRead * 1_000_000);
  }
  return {
    getModel: (provider, modelId) => {
      const cacheRead = perMillion.get(`${provider}/${modelId}`);
      return cacheRead === undefined ? undefined : { cost: { cacheRead } };
    },
  };
}

/**
 * What the session itself paid for a cache read, then `models`: the live reply
 * and every later read of the file price a miss alike.
 */
export function withSessionPrices(entries: readonly SessionEntry[], models?: NoticeModelLookup): NoticeModelLookup {
  const fromSession = sessionCacheReadPrices(entries);
  return {
    getModel: (provider, modelId) => fromSession.getModel(provider, modelId) ?? models?.getModel(provider, modelId),
  };
}

/**
 * A session's notices for the history routes, or undefined while the setting
 * is off. A total miss is priced from the session's own cache reads, then
 * `models` (an open session's runtime); the extension-loaded runtime is never
 * built here, as that runs every extension with no deadline.
 */
export function readSessionTranscriptNotices(options: {
  entries: readonly SessionEntry[];
  cwd: string;
  leafId?: string | null;
  models?: NoticeModelLookup;
}): Map<string, TranscriptNotice[]> | undefined {
  if (!options.cwd || !readShowCacheMissNotices(options.cwd)) return undefined;
  return collectTranscriptNotices(options.entries, withSessionPrices(options.entries, options.models), { leafId: options.leafId });
}

/** `context` with each message carrying the notices of its entry. */
export function attachTranscriptNotices<T extends { messages: unknown[]; entryIds: string[] }>(
  context: T,
  notices: Map<string, TranscriptNotice[]> | undefined,
): T {
  if (!notices || notices.size === 0) return context;
  let messages: unknown[] | undefined;
  context.entryIds.forEach((entryId, index) => {
    const list = notices.get(entryId);
    if (!list) return;
    messages ??= [...context.messages];
    messages[index] = withTranscriptNotices(context.messages[index] as object, list);
  });
  return messages ? { ...context, messages } : context;
}
