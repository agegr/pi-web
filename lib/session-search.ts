import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import type { SessionInfo } from "./types";

// Kept as literals: this module imports nothing but Node builtins at run time, so its
// test loads it with Node's type stripping alone. Canonical definitions: session-family.ts.
const SIDE_BOUNDARY_MESSAGE_TYPE = "pi-web:side-boundary";
const SIDE_SESSION_NAME = "Side chat";

const MAX_FILES = 500;
const MAX_RESULTS = 30;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_LINE_CHARS = 1024 * 1024;
const TIME_BUDGET_MS = 3000;
/** Cached session text is at most this much, and at most this many sessions. */
const CACHE_MAX_BYTES = 32 * 1024 * 1024;
const CACHE_LIMIT = 256;

export interface SessionSearchResult {
  session: SessionInfo;
  entryId?: string;
  blockIndex: number;
  /** A title hit has no message entry to reveal. */
  titleMatch?: boolean;
  before: string;
  match: string;
  after: string;
}

export interface SessionSearchResponse {
  results: SessionSearchResult[];
  truncated: boolean;
}

/** One searchable message: its own text, already stripped of a side chat's inherited part. */
interface SearchableEntry {
  entryId?: string;
  blocks: { blockIndex: number; text: string }[];
  text: string;
}

interface ReadStats {
  overlong: boolean;
  overCap: boolean;
  sawBoundary: boolean;
}

interface CacheEntry {
  size: number;
  mtimeMs: number;
  /** Whether the file was parsed as a side chat (its inherited prefix cut). */
  sideChat: boolean;
  entries: SearchableEntry[];
  bytes: number;
  sawBoundary: boolean;
}

/**
 * Parsed session text, keyed by path and validated by size + mtime.
 *
 * Without it, every keystroke in the search box re-reads and re-parses the whole
 * library, so latency tracks the number of sessions rather than the answer. Kept in
 * least-recently-used order under a byte budget: the sessions someone keeps opening
 * stay parsed, and a large library cannot pin itself in memory.
 */
const fileCache = new Map<string, CacheEntry>();
let cachedBytes = 0;

function entryBytes(entries: readonly SearchableEntry[]): number {
  let bytes = 0;
  for (const entry of entries) bytes += Buffer.byteLength(entry.text, "utf8");
  return bytes;
}

function forget(path: string): void {
  const hit = fileCache.get(path);
  if (!hit) return;
  fileCache.delete(path);
  cachedBytes -= hit.bytes;
}

/** A hit refreshes the entry's place in the LRU order. */
function cachedRead(path: string, size: number, mtimeMs: number, sideChat: boolean): CacheEntry | undefined {
  const hit = fileCache.get(path);
  if (!hit) return undefined;
  if (hit.size !== size || hit.mtimeMs !== mtimeMs || hit.sideChat !== sideChat) {
    forget(path);
    return undefined;
  }
  fileCache.delete(path);
  fileCache.set(path, hit);
  return hit;
}

function remember(path: string, size: number, mtimeMs: number, sideChat: boolean, entries: SearchableEntry[], sawBoundary: boolean): void {
  forget(path);
  const bytes = entryBytes(entries);
  // Caching one huge file would evict everything else and still not fit: skip it.
  if (bytes > CACHE_MAX_BYTES) return;
  fileCache.set(path, { size, mtimeMs, sideChat, entries, bytes, sawBoundary });
  cachedBytes += bytes;
  while (fileCache.size > CACHE_LIMIT || cachedBytes > CACHE_MAX_BYTES) {
    const oldest = fileCache.keys().next();
    if (oldest.done) break;
    forget(oldest.value);
  }
}

/** Keep the cache inside the session listing: memory tracks the sidebar, not the disk. */
function pruneTo(paths: ReadonlySet<string>): void {
  for (const path of [...fileCache.keys()]) {
    if (!paths.has(path)) forget(path);
  }
}

/** Test hook: drop everything cached. */
export function clearSessionSearchCache(): void {
  fileCache.clear();
  cachedBytes = 0;
}

/** Test hook: sessions currently cached. */
export function sessionSearchCacheSize(): number {
  return fileCache.size;
}

/** Test hook: cached text bytes. */
export function sessionSearchCacheBytes(): number {
  return cachedBytes;
}

/**
 * Yields searchable messages in file order, so a caller that already has its answer can
 * stop reading. `stats.overCap` reports a read that stopped at the byte cap.
 */
async function* streamEntries(
  path: string,
  sideChat: boolean,
  signal: AbortSignal,
  deadline: number,
  stats: ReadStats,
): AsyncGenerator<SearchableEntry> {
  const stream = createReadStream(path, { encoding: "utf8", end: MAX_FILE_BYTES - 1, signal });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  // A side chat carries its parent's whole transcript before the boundary message, and
  // nothing in that prefix is its own. Other sessions have no boundary and search all.
  let pastBoundary = !sideChat;
  try {
    for await (const line of lines) {
      if (signal.aborted || Date.now() >= deadline) return;
      // Before the boundary only the boundary line itself matters: inherited lines are
      // dropped before parsing, so a prefix that never mentions it costs reads only.
      if (!pastBoundary && !line.includes(SIDE_BOUNDARY_MESSAGE_TYPE)) continue;
      if (line.length > MAX_LINE_CHARS) {
        stats.overlong = true;
        continue;
      }
      let entry;
      try { entry = JSON.parse(line); } catch { continue; }
      // The boundary itself is boilerplate, never a hit; everything before it is
      // inherited and already searchable in the parent session.
      if (entry?.type === "custom_message" && entry?.customType === SIDE_BOUNDARY_MESSAGE_TYPE) {
        pastBoundary = true;
        stats.sawBoundary = true;
        continue;
      }
      if (!pastBoundary) continue;
      if (entry?.type !== "message" || !["user", "assistant"].includes(entry.message?.role)) continue;
      const content: unknown = entry.message.content;
      const blocks = typeof content === "string" ? [{ type: "text", text: content }] : Array.isArray(content) ? content : [];
      const textBlocks = blocks.flatMap((block, blockIndex) =>
        block?.type === "text" && typeof block.text === "string" ? [{ text: block.text as string, blockIndex }] : []);
      if (!textBlocks.length) continue;
      yield {
        ...(typeof entry.id === "string" ? { entryId: entry.id } : {}),
        blocks: textBlocks,
        text: textBlocks.map((block) => block.text).join("\n"),
      };
    }
  } finally {
    lines.close();
    stream.destroy();
  }
  // `end` caps the stream: a file that filled the cap was not read to the end.
  if (stream.bytesRead >= MAX_FILE_BYTES) stats.overCap = true;
}
// Whitespace separates terms and every term must appear somewhere in the session; a
// double-quoted run stays one exact phrase. A quote opens a phrase only at the start of
// a term, so `foo"bar` stays literal; an unclosed quote reads to the end of the query.
function parseTerms(query: string): string[] {
  const terms: string[] = [];
  let current = "";
  let quoted = false;
  for (const char of query) {
    if (char === '"' && (quoted || !current)) {
      if (quoted && current) terms.push(current);
      if (quoted) current = "";
      quoted = !quoted;
    } else if (!quoted && /\s/.test(char)) {
      if (current) terms.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  if (current) terms.push(current);
  return terms;
}

// ponytail: scan recent files without an index; keep the parsed text of the sessions
// that get read to the end, so refining a query costs the answer and not the library.
export async function searchSessionContents(
  sessions: readonly SessionInfo[],
  query: string,
  requestSignal?: AbortSignal,
): Promise<SessionSearchResponse> {
  const response: SessionSearchResponse = { results: [], truncated: false };
  const needle = query.trim();
  if (!needle) return response;
  if (needle.length > 200) throw new RangeError("Search query exceeds 200 characters");
  // A query of nothing but quotes (`""`) holds no term: search it as one literal string.
  const terms = parseTerms(needle);
  // Escape every operator: each term is literal, with offsets in the original text.
  const matchers = [...new Set(terms.length ? terms : [needle])]
    .map((term) => new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  const deadline = Date.now() + TIME_BUDGET_MS;
  const timeout = AbortSignal.timeout(TIME_BUDGET_MS);
  const signal = requestSignal ? AbortSignal.any([requestSignal, timeout]) : timeout;
  const sessionIds = new Set(sessions.map((session) => session.id));
  const candidates = sessions
    .filter((session) => !session.transient && session.path)
    // A side chat whose parent is gone has no family row in the sidebar either:
    // a hit here could not be opened.
    .filter((session) => session.relation?.kind !== "side" || sessionIds.has(session.relation.parentSessionId))
    .sort((a, b) => b.modified.localeCompare(a.modified));

  pruneTo(new Set(candidates.map((session) => session.path)));

  for (const [index, session] of candidates.entries()) {
    if (index >= MAX_FILES || response.results.length >= MAX_RESULTS || signal.aborted || Date.now() >= deadline) {
      response.truncated = true;
      break;
    }
    // A side chat copies its parent's whole text: only what follows the boundary
    // message is its own, and without that message it has nothing of its own to match.
    const isSide = session.relation?.kind === "side";
    const stats: ReadStats = { overlong: false, overCap: false, sawBoundary: false };
    let hit: SessionSearchResult | undefined;
    let found = false;
    // The row shows the first term's first hit; the other terms only have to appear somewhere.
    let pending = matchers.slice(1);

    const consider = (entry: SearchableEntry): boolean => {
      const text = entry.text;
      pending = pending.filter((matcher) => !matcher.test(text));
      const match = hit ? null : matchers[0].exec(text);
      if (!match) return Boolean(hit) && !pending.length;
      const start = match.index;
      const end = start + match[0].length;
      let blockOffset = 0;
      const matchedBlock = entry.blocks.find((block) => {
        const blockEnd = blockOffset + block.text.length;
        blockOffset = blockEnd + 1;
        return start <= blockEnd;
      });
      hit = {
        session,
        ...(entry.entryId ? { entryId: entry.entryId } : {}),
        blockIndex: matchedBlock!.blockIndex,
        before: (start > 80 ? "..." : "") + text.slice(Math.max(0, start - 80), start).replace(/\s+/g, " ").trimStart(),
        match: match[0].replace(/\s+/g, " "),
        after: text.slice(end, end + 80).replace(/\s+/g, " ").trimEnd() + (end + 80 < text.length ? "..." : ""),
      };
      return !pending.length;
    };

    let size = 0;
    let mtimeMs = 0;
    let sawBoundary = false;
    let readable = true;
    try {
      const info = await stat(session.path);
      size = info.size;
      mtimeMs = info.mtimeMs;
    } catch {
      // Missing/unreadable files must not hide other results.
      readable = false;
      response.truncated = true;
    }

    if (readable) {
      const cached = cachedRead(session.path, size, mtimeMs, isSide);
      sawBoundary = cached ? cached.sawBoundary : false;
      if (cached) {
        for (const entry of cached.entries) {
          if (consider(entry)) break;
        }
      } else {
        // Parsed once and kept only if the read ran to the end: a scan that stopped at a
        // hit, the deadline or the byte cap says nothing about the rest of the file.
        const collected: SearchableEntry[] = [];
        let drained = true;
        let earlyExit = false;
        try {
          for await (const entry of streamEntries(session.path, isSide, signal, deadline, stats)) {
            collected.push(entry);
            if (consider(entry)) { earlyExit = true; break; }
          }
        } catch {
          drained = false;
          response.truncated = true;
        }
        if (earlyExit || signal.aborted || Date.now() >= deadline) drained = false;
        sawBoundary = stats.sawBoundary;
        if (drained && !stats.overlong && !stats.overCap && !signal.aborted && Date.now() < deadline) {
          remember(session.path, size, mtimeMs, isSide, collected, stats.sawBoundary);
        }
      }
    }
    if (stats.overlong || stats.overCap) response.truncated = true;
    if (hit && !pending.length) {
      response.results.push(hit);
      found = true;
    }
    // Preserve message navigation when both body and title match. The catalogue
    // already carries the displayed name (including session_info names), so a
    // title hit is a fallback only when the transcript has no match.
    const pastBoundary = !isSide || sawBoundary;
    if (!found && pastBoundary && !signal.aborted && Date.now() < deadline) {
      // A side chat's firstMessage is its inherited first question, and its name
      // may still be the app's placeholder: neither stands in for a title hit.
      const title = isSide
        ? (session.name && session.name !== SIDE_SESSION_NAME ? session.name : "")
        : session.name || session.firstMessage || "";
      // Every term has to be in the title too: half the terms there and half in the body is no hit.
      const titleHit = matchers.every((matcher) => matcher.test(title)) ? matchers[0].exec(title) : null;
      if (titleHit) {
        response.results.push({
          session,
          blockIndex: 0,
          titleMatch: true,
          before: title.slice(0, titleHit.index),
          match: titleHit[0],
          after: title.slice(titleHit.index + titleHit[0].length),
        });
      }
    }
  }
  return response;
}
