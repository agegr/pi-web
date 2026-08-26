// Full-text search across stored session JSONL files.
//
// Session browsing elsewhere in Pi Web goes through `listAllSessions()`, and so
// does this module: the session list supplies the authoritative path, cwd,
// projectKey, and title for every session, and this file only adds the content
// scan on top. That keeps project grouping consistent with the sidebar and
// means no request can ever name a file outside the sessions directory.
//
// The scan is deliberately streaming and bounded (see the caps below): sessions
// grow without limit, and this runs on every debounced keystroke.

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { listAllSessions } from "./session-reader";
import { buildMatcher, type MatchMode, type TextMatcher } from "./text-match";
import type { SessionInfo } from "./types";

export const SESSION_SEARCH_ROLES = [
  "user",
  "assistant",
  "thinking",
  "toolCall",
  "toolResult",
  "bash",
  "custom",
  "summary",
] as const;

export type SessionSearchRole = (typeof SESSION_SEARCH_ROLES)[number];

/** Conversation text only. Tool traffic is opt-in because it dominates hits. */
export const DEFAULT_SESSION_SEARCH_ROLES: SessionSearchRole[] = ["user", "assistant"];

/** Search modes are the shared text-match modes. */
export type SessionSearchMode = MatchMode;
export { buildMatcher as buildSessionMatcher } from "./text-match";

export const MAX_QUERY_LENGTH = 200;
/** Hard cap on session files opened for one request. */
export const MAX_FILES_SCANNED = 500;
/** Wall-clock budget for one request; partial results are returned on timeout. */
export const SEARCH_TIME_BUDGET_MS = 8000;
export const MAX_RESULT_SESSIONS = 50;
export const DEFAULT_RESULT_SESSIONS = 20;
export const MAX_HITS_PER_SESSION = 20;
export const DEFAULT_HITS_PER_SESSION = 3;
export const DEFAULT_SNIPPET_CONTEXT = 160;
/** Guard against a single pathological entry (huge tool result). */
const MAX_SEGMENT_CHARS = 200_000;

export interface SessionSearchHit {
  entryId: string;
  timestamp: string;
  role: SessionSearchRole;
  /** Tool name for toolCall/toolResult, customType for custom entries. */
  tool?: string;
  /** Text before the match, whitespace-collapsed. */
  prefix: string;
  /** The matched text itself. */
  match: string;
  /** Text after the match, whitespace-collapsed. */
  suffix: string;
  /** True when text was cut at the start/end of the snippet window. */
  clippedStart: boolean;
  clippedEnd: boolean;
}

export interface SessionSearchResult {
  sessionId: string;
  path: string;
  cwd: string;
  projectKey?: string;
  name?: string;
  firstMessage: string;
  modified: string;
  messageCount: number;
  matchCount: number;
  hits: SessionSearchHit[];
  /** True when matchCount exceeds the returned hits. */
  moreHits: boolean;
}

export interface SessionSearchStats {
  sessionsScanned: number;
  /** Sessions with at least one match, including those cut by `limit`. */
  sessionsMatched: number;
  elapsedMs: number;
  /** True when the scan stopped on the time budget or the file cap. */
  truncated: boolean;
}

export interface SessionSearchResponse {
  results: SessionSearchResult[];
  totalMatches: number;
  stats: SessionSearchStats;
}

export interface SessionSearchQuery {
  query: string;
  mode: SessionSearchMode;
  caseSensitive: boolean;
  roles: SessionSearchRole[];
  /** Restrict to one project (sidebar project key). Empty means all projects. */
  projectKey?: string;
  limit: number;
  hitsPerSession: number;
}

export interface SessionSearchOptions extends SessionSearchQuery {
  signal?: AbortSignal;
  /** Injected in tests. Defaults to `listAllSessions()`. */
  loadSessions?: () => Promise<SessionInfo[]>;
  now?: () => number;
}

// ---------------------------------------------------------------------------
// request parsing
// ---------------------------------------------------------------------------

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function parseRoles(raw: string | null): SessionSearchRole[] {
  if (!raw) return [...DEFAULT_SESSION_SEARCH_ROLES];
  const allowed = new Set<string>(SESSION_SEARCH_ROLES);
  const picked = raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => allowed.has(value)) as SessionSearchRole[];
  return picked.length > 0 ? [...new Set(picked)] : [...DEFAULT_SESSION_SEARCH_ROLES];
}

function parseMode(raw: string | null): SessionSearchMode {
  return raw === "words" || raw === "regex" ? raw : "substring";
}

/** Parse and clamp the query string of `GET /api/sessions/search`. */
export function parseSessionSearchQuery(params: URLSearchParams): SessionSearchQuery {
  return {
    query: (params.get("q") ?? "").slice(0, MAX_QUERY_LENGTH),
    mode: parseMode(params.get("mode")),
    caseSensitive: params.get("case") === "1",
    roles: parseRoles(params.get("roles")),
    projectKey: params.get("projectKey")?.trim() || undefined,
    limit: clampInt(params.get("limit"), DEFAULT_RESULT_SESSIONS, 1, MAX_RESULT_SESSIONS),
    hitsPerSession: clampInt(params.get("hits"), DEFAULT_HITS_PER_SESSION, 1, MAX_HITS_PER_SESSION),
  };
}

// ---------------------------------------------------------------------------
// matching
// ---------------------------------------------------------------------------

/**
 * Build the display snippet around one match. Whitespace is collapsed so a
 * snippet stays on one line, but the single space next to the match is kept so
 * words never get glued to the highlighted text.
 */
export function buildSnippet(
  text: string,
  match: { start: number; end: number },
  contextChars = DEFAULT_SNIPPET_CONTEXT,
): Pick<SessionSearchHit, "prefix" | "match" | "suffix" | "clippedStart" | "clippedEnd"> {
  const pad = Math.max(20, Math.floor(contextChars / 2));
  const start = Math.max(0, match.start - pad);
  const end = Math.min(text.length, match.end + pad);
  return {
    prefix: text.slice(start, match.start).replace(/\s+/g, " ").replace(/^ /, ""),
    match: text.slice(match.start, match.end).replace(/\s+/g, " "),
    suffix: text.slice(match.end, end).replace(/\s+/g, " ").replace(/ $/, ""),
    clippedStart: start > 0,
    clippedEnd: end < text.length,
  };
}

// ---------------------------------------------------------------------------
// entry -> searchable segments
// ---------------------------------------------------------------------------

export interface SessionSearchSegment {
  role: SessionSearchRole;
  text: string;
  tool?: string;
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const typed = block as { type?: string; text?: string };
    // Images and other binary blocks are intentionally not searchable.
    if (typed.type === "text" && typeof typed.text === "string") parts.push(typed.text);
  }
  return parts.join("\n");
}

function thinkingOf(content: unknown): string {
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const typed = block as { type?: string; thinking?: string };
    if (typed.type === "thinking" && typeof typed.thinking === "string") parts.push(typed.thinking);
  }
  return parts.join("\n");
}

function toolCallsOf(content: unknown): SessionSearchSegment[] {
  if (!Array.isArray(content)) return [];
  const out: SessionSearchSegment[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const typed = block as { type?: string; name?: string; arguments?: unknown };
    if (typed.type !== "toolCall") continue;
    let args = "";
    try {
      args = JSON.stringify(typed.arguments ?? {});
    } catch {
      args = "";
    }
    out.push({ role: "toolCall", tool: typed.name, text: `${typed.name ?? "tool"} ${args}` });
  }
  return out;
}

/**
 * Map one raw session entry to the text segments a search can match against.
 * Unknown entry types yield nothing, so new pi entry types degrade quietly.
 */
export function searchableSegments(entry: unknown): SessionSearchSegment[] {
  if (!entry || typeof entry !== "object") return [];
  const typed = entry as { type?: string; message?: Record<string, unknown>; [key: string]: unknown };

  if (typed.type === "message") {
    const message = (typed.message ?? {}) as Record<string, unknown>;
    switch (message.role) {
      case "user":
        return [{ role: "user", text: textOf(message.content) }];
      case "assistant": {
        const segments: SessionSearchSegment[] = [];
        const text = textOf(message.content);
        if (text) segments.push({ role: "assistant", text });
        const thinking = thinkingOf(message.content);
        if (thinking) segments.push({ role: "thinking", text: thinking });
        segments.push(...toolCallsOf(message.content));
        return segments;
      }
      case "toolResult":
        return [{
          role: "toolResult",
          tool: typeof message.toolName === "string" ? message.toolName : undefined,
          text: textOf(message.content),
        }];
      case "bashExecution":
        return [{ role: "bash", text: `$ ${String(message.command ?? "")}\n${String(message.output ?? "")}` }];
      case "custom":
        return [{
          role: "custom",
          tool: typeof message.customType === "string" ? message.customType : undefined,
          text: textOf(message.content),
        }];
      case "branchSummary":
      case "compactionSummary":
        return [{ role: "summary", text: String(message.summary ?? "") }];
      default:
        return [];
    }
  }

  if (typed.type === "custom_message") {
    return [{
      role: "custom",
      tool: typeof typed.customType === "string" ? typed.customType : undefined,
      text: textOf(typed.content),
    }];
  }
  if (typed.type === "compaction" || typed.type === "branch_summary") {
    return [{ role: "summary", text: String(typed.summary ?? "") }];
  }
  // `custom` state entries hold arbitrary extension data; searching their JSON
  // is opt-in through the "custom" role.
  if (typed.type === "custom") {
    let data = "";
    try {
      data = typeof typed.data === "string" ? typed.data : JSON.stringify(typed.data ?? {});
    } catch {
      data = "";
    }
    return [{
      role: "custom",
      tool: typeof typed.customType === "string" ? typed.customType : undefined,
      text: data,
    }];
  }
  return [];
}

// ---------------------------------------------------------------------------
// scan
// ---------------------------------------------------------------------------

interface FileScan {
  matchCount: number;
  hits: SessionSearchHit[];
}

async function scanSessionFile(
  filePath: string,
  matcher: TextMatcher,
  roles: ReadonlySet<SessionSearchRole>,
  hitsPerSession: number,
  signal?: AbortSignal,
): Promise<FileScan> {
  const hits: SessionSearchHit[] = [];
  let matchCount = 0;

  const stream = createReadStream(filePath, { encoding: "utf8" });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (signal?.aborted) break;
      // Every session line is a JSON object; skip blanks and partial writes.
      if (!line || line.charCodeAt(0) !== 0x7b) continue;
      let entry: unknown;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      const id = String((entry as { id?: unknown }).id ?? "");
      const timestamp = String((entry as { timestamp?: unknown }).timestamp ?? "");

      for (const segment of searchableSegments(entry)) {
        if (!roles.has(segment.role) || !segment.text) continue;
        const text = segment.text.length > MAX_SEGMENT_CHARS
          ? segment.text.slice(0, MAX_SEGMENT_CHARS)
          : segment.text;
        const found = matcher.find(text, hitsPerSession * 4);
        if (found.length === 0) continue;
        matchCount += found.length;
        for (const range of found) {
          if (hits.length >= hitsPerSession) break;
          hits.push({
            entryId: id,
            timestamp,
            role: segment.role,
            tool: segment.tool,
            ...buildSnippet(text, range),
          });
        }
      }
    }
  } finally {
    lines.close();
    stream.destroy();
  }

  return { matchCount, hits };
}

function byModifiedDesc(a: SessionInfo, b: SessionInfo): number {
  return Date.parse(b.modified) - Date.parse(a.modified) || a.id.localeCompare(b.id);
}

/**
 * Search session contents, newest session first.
 *
 * Results are capped by `limit`, and the scan itself is capped by
 * `MAX_FILES_SCANNED` and `SEARCH_TIME_BUDGET_MS`; either cap sets
 * `stats.truncated` so the UI can tell the user to narrow the search.
 */
export async function searchSessionContents(
  options: SessionSearchOptions,
): Promise<SessionSearchResponse> {
  const now = options.now ?? Date.now;
  const startedAt = now();
  const query = options.query.trim();
  if (!query) {
    return {
      results: [],
      totalMatches: 0,
      stats: { sessionsScanned: 0, sessionsMatched: 0, elapsedMs: 0, truncated: false },
    };
  }

  const matcher = buildMatcher(query, options.mode, options.caseSensitive);
  const roles = new Set<SessionSearchRole>(
    options.roles.length > 0 ? options.roles : DEFAULT_SESSION_SEARCH_ROLES,
  );

  const loadSessions = options.loadSessions ?? (() => listAllSessions());
  const candidates = (await loadSessions())
    // Transient sessions exist only in memory; there is no file to scan yet.
    .filter((session) => !session.transient && Boolean(session.path))
    .filter((session) => !options.projectKey || session.projectKey === options.projectKey)
    .sort(byModifiedDesc);

  const results: SessionSearchResult[] = [];
  const stats: SessionSearchStats = {
    sessionsScanned: 0,
    sessionsMatched: 0,
    elapsedMs: 0,
    truncated: false,
  };

  for (const session of candidates) {
    if (options.signal?.aborted) {
      stats.truncated = true;
      break;
    }
    if (stats.sessionsScanned >= MAX_FILES_SCANNED || now() - startedAt > SEARCH_TIME_BUDGET_MS) {
      stats.truncated = true;
      break;
    }

    let scan: FileScan;
    try {
      scan = await scanSessionFile(
        session.path,
        matcher,
        roles,
        options.hitsPerSession,
        options.signal,
      );
    } catch {
      // Deleted mid-scan or unreadable: skip, keep the rest of the search alive.
      continue;
    }
    stats.sessionsScanned += 1;
    if (scan.matchCount === 0) continue;

    stats.sessionsMatched += 1;
    if (results.length < options.limit) {
      results.push({
        sessionId: session.id,
        path: session.path,
        cwd: session.cwd,
        projectKey: session.projectKey,
        name: session.name,
        firstMessage: session.firstMessage,
        modified: session.modified,
        messageCount: session.messageCount,
        matchCount: scan.matchCount,
        hits: scan.hits,
        moreHits: scan.matchCount > scan.hits.length,
      });
    }
  }

  stats.elapsedMs = now() - startedAt;
  return {
    results,
    totalMatches: results.reduce((total, result) => total + result.matchCount, 0),
    stats,
  };
}
