import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import type { SessionInfo } from "./types";

// Kept as literals: this module imports nothing at run time, so its test loads
// it with Node's type stripping alone. Canonical definitions: session-family.ts.
const SIDE_BOUNDARY_MESSAGE_TYPE = "pi-web:side-boundary";
const SIDE_SESSION_NAME = "Side chat";

const MAX_FILES = 500;
const MAX_RESULTS = 30;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_LINE_CHARS = 1024 * 1024;
const TIME_BUDGET_MS = 3000;

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

/** One message's searchable text, with the content-array indexes the viewer needs. */
interface SessionMessage {
  entryId?: string;
  blocks: { blockIndex: number; text: string }[];
}

/**
 * One session's text, kept while the file's size and mtime stay put. The front end
 * searches on every keystroke, so re-reading unchanged transcripts is the whole cost.
 */
interface CachedSession {
  mtimeMs: number;
  size: number;
  modified: string;
  textChars: number;
  messages: SessionMessage[];
  /** Whether the file holds the side-chat boundary: without it no title may match. */
  pastBoundary: boolean;
  /** The file is larger than MAX_FILE_BYTES: its tail was never searched. */
  capped: boolean;
}

/** What a scan learned beyond the messages it yielded. */
interface ScanFlags {
  truncated: boolean;
  capped: boolean;
  pastBoundary: boolean;
}

// 32 Mi units of text plus the flat per-message and per-block allowance below, about
// three times the largest library measured (10.4 M text units), and the cap the issue
// asked to keep low. A scan runs newest first and usually stops on its budget, so the
// newest sessions are the ones every keystroke reuses.
const CACHE_TEXT_CHARS = 32 * 1024 * 1024;
const cache = { sessions: new Map<string, CachedSession>(), textChars: 0 };

function dropCached(path: string) {
  const entry = cache.sessions.get(path);
  if (!entry) return;
  cache.sessions.delete(path);
  cache.textChars -= entry.textChars;
}

/** Forget the sessions the current listing no longer shows. */
function pruneCache(live: ReadonlySet<string>) {
  for (const path of cache.sessions.keys()) if (!live.has(path)) dropCached(path);
}

/** A cached session whose file still holds the bytes that were read. */
async function cachedScan(path: string): Promise<CachedSession | undefined> {
  const entry = cache.sessions.get(path);
  if (!entry) return undefined;
  const stamp = await fileStamp(path);
  if (!stamp || stamp.mtimeMs !== entry.mtimeMs || stamp.size !== entry.size) {
    dropCached(path);
    return undefined;
  }
  return entry;
}

async function fileStamp(path: string) {
  try {
    const value = await stat(path);
    return { mtimeMs: value.mtimeMs, size: value.size };
  } catch {
    return undefined;
  }
}

function rememberMessages(path: string, stamp: { mtimeMs: number; size: number }, modified: string, messages: SessionMessage[], flags: ScanFlags) {
  // Text plus what each message and block costs to hold, so a file of one-word
  // messages cannot hide its overhead behind a small character count.
  const textChars = messages.reduce(
    (total, message) => total + 64 + (message.entryId?.length ?? 0) + message.blocks.reduce((sum, block) => sum + 16 + block.text.length, 0),
    0,
  );
  // Never evict the rest for one session that would not fit on its own.
  if (textChars > CACHE_TEXT_CHARS) return;
  const existing = cache.sessions.get(path);
  const projected = cache.textChars - (existing?.textChars ?? 0) + textChars;
  if (projected > CACHE_TEXT_CHARS) {
    // Only sessions older than this one may be dropped. `modified` is the UTC ISO
    // string session-reader builds, so comparing strings orders it. A session read
    // twice is not old because it was stored last, and once a library outgrows the
    // bound, dropping a newer session makes the next keystroke read it again: the
    // thrash the bound exists to prevent. If the older entries cannot free enough,
    // store nothing else. Nothing is copied until some entry qualifies.
    const older: [string, CachedSession][] = [];
    for (const entry of cache.sessions) if (entry[0] !== path && entry[1].modified < modified) older.push(entry);
    older.sort((left, right) => (left[1].modified < right[1].modified ? -1 : left[1].modified > right[1].modified ? 1 : 0));
    let needed = projected - CACHE_TEXT_CHARS;
    let count = 0;
    while (count < older.length && needed > 0) needed -= older[count++][1].textChars;
    if (needed > 0) return;
    for (let index = 0; index < count; index++) dropCached(older[index][0]);
  }
  dropCached(path);
  cache.sessions.set(path, { mtimeMs: stamp.mtimeMs, size: stamp.size, modified, textChars, messages, pastBoundary: flags.pastBoundary, capped: flags.capped });
  cache.textChars += textChars;
}

/** The text blocks of a message, with their index in the original content array. */
function textBlocks(content: unknown) {
  const blocks = typeof content === "string" ? [{ type: "text", text: content }] : Array.isArray(content) ? content : [];
  return blocks.flatMap((block, blockIndex) =>
    block?.type === "text" && typeof block.text === "string" ? [{ blockIndex, text: block.text as string }] : [],
  );
}

function messageText(message: SessionMessage): string {
  return message.blocks.length === 1 ? message.blocks[0].text : message.blocks.map((block) => block.text).join("\n");
}

/** Where a match sits: its block, plus 80 characters either side with whitespace folded. */
function snippet(text: string, match: RegExpExecArray, blocks: readonly { blockIndex: number; text: string }[]) {
  const start = match.index;
  const end = start + match[0].length;
  let blockOffset = 0;
  const block = blocks.find((item) => {
    const blockEnd = blockOffset + item.text.length;
    blockOffset = blockEnd + 1;
    return start <= blockEnd;
  });
  return {
    blockIndex: block!.blockIndex,
    before: (start > 80 ? "..." : "") + text.slice(Math.max(0, start - 80), start).replace(/\s+/g, " ").trimStart(),
    match: match[0].replace(/\s+/g, " "),
    after: text.slice(end, end + 80).replace(/\s+/g, " ").trimEnd() + (end + 80 < text.length ? "..." : ""),
  };
}

/**
 * Matches one session's messages, from a fresh scan or from the cache: the row shows
 * the first term's first hit, the other terms only have to appear somewhere.
 */
function sessionMatcher(session: SessionInfo, matchers: readonly RegExp[]) {
  let hit: SessionSearchResult | undefined;
  let pending = matchers.slice(1);
  return {
    step(message: SessionMessage): boolean {
      const text = messageText(message);
      pending = pending.filter((matcher) => !matcher.test(text));
      if (!hit) {
        const match = matchers[0].exec(text);
        if (match) {
          hit = {
            session,
            ...(message.entryId !== undefined ? { entryId: message.entryId } : {}),
            ...snippet(text, match, message.blocks),
          };
        }
      }
      return hit !== undefined && pending.length === 0;
    },
    result(): SessionSearchResult | undefined {
      return hit && pending.length === 0 ? hit : undefined;
    },
  };
}

/**
 * One session's messages in file order. A side chat copies its parent's whole history
 * first, so lines before its boundary are dropped before parsing; other sessions have
 * no boundary and search everything.
 */
async function* readSessionMessages(path: string, signal: AbortSignal, deadline: number, flags: ScanFlags): AsyncGenerator<SessionMessage> {
  const stream = createReadStream(path, { encoding: "utf8", end: MAX_FILE_BYTES - 1, signal });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (signal.aborted || Date.now() >= deadline) {
        flags.truncated = true;
        return;
      }
      if (!flags.pastBoundary && !line.includes(SIDE_BOUNDARY_MESSAGE_TYPE)) continue;
      if (line.length > MAX_LINE_CHARS) {
        flags.truncated = true;
        continue;
      }
      let entry;
      try { entry = JSON.parse(line); } catch { continue; }
      // The boundary itself is boilerplate, never a hit.
      if (entry?.type === "custom_message" && entry?.customType === SIDE_BOUNDARY_MESSAGE_TYPE) {
        flags.pastBoundary = true;
        continue;
      }
      if (!flags.pastBoundary) continue;
      if (entry?.type !== "message" || !["user", "assistant"].includes(entry.message?.role)) continue;
      const blocks = textBlocks(entry.message.content);
      if (!blocks.length) continue;
      yield { ...(typeof entry.id === "string" ? { entryId: entry.id } : {}), blocks };
    }
  } catch {
    // Missing/unreadable files and interrupted reads must not hide other results.
    flags.truncated = true;
  } finally {
    flags.capped = stream.bytesRead >= MAX_FILE_BYTES;
    lines.close();
    stream.destroy();
  }
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

// ponytail: scan recent files without an index; add indexing if measured latency warrants it.
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

  // The scan window and the cache window are the same listing: the bound the issue
  // asked for is exactly the sessions the next query could still reach.
  const scoped = candidates.slice(0, MAX_FILES);
  pruneCache(new Set(scoped.map((session) => session.path)));
  if (candidates.length > scoped.length) response.truncated = true;

  for (const session of scoped) {
    if (response.results.length >= MAX_RESULTS || signal.aborted || Date.now() >= deadline) {
      response.truncated = true;
      break;
    }
    const matcher = sessionMatcher(session, matchers);
    const cached = await cachedScan(session.path);
    let found = false;
    let tailUnread = false;
    let pastBoundary = session.relation?.kind !== "side";

    if (cached) {
      tailUnread = cached.capped;
      pastBoundary = cached.pastBoundary;
      for (const message of cached.messages) {
        if (signal.aborted || Date.now() >= deadline) {
          response.truncated = true;
          break;
        }
        if (matcher.step(message)) {
          found = true;
          break;
        }
      }
    } else {
      const flags: ScanFlags = { truncated: false, capped: false, pastBoundary };
      const collected: SessionMessage[] = [];
      // Stamp before reading: an append that lands mid-read belongs to the next read,
      // not to the entry stored under this stamp.
      const before = await fileStamp(session.path);
      for await (const message of readSessionMessages(session.path, signal, deadline, flags)) {
        collected.push(message);
        if (matcher.step(message)) {
          found = true;
          break;
        }
      }
      if (flags.truncated) response.truncated = true;
      tailUnread = flags.capped;
      pastBoundary = flags.pastBoundary;
      // Only a read that reached the end of the file and skipped no line is worth
      // keeping: a partial scan would report hits the next query should not miss.
      if (before && !found && !flags.truncated) rememberMessages(session.path, before, session.modified, collected, flags);
    }

    const hit = found ? matcher.result() : undefined;
    if (hit) response.results.push(hit);
    if (!found && tailUnread) response.truncated = true;
    // Preserve message navigation when both body and title match. The catalogue
    // already carries the displayed name (including session_info names), so a
    // title hit is a fallback only when the transcript has no match.
    if (!found && pastBoundary && !signal.aborted && Date.now() < deadline) {
      // A side chat's firstMessage is its inherited first question, and its name
      // may still be the app's placeholder: neither stands in for a title hit.
      const title = session.relation?.kind === "side"
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
