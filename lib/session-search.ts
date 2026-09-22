import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import type { SessionInfo } from "./types";
import { readSessionIndexSettings } from "./index-settings";
import { isIndexAvailable, initSchema, searchEntries, getAllSessions } from "./session-index";

const MAX_FILES = 500;
const MAX_RESULTS = 30;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_LINE_CHARS = 1024 * 1024;
const TIME_BUDGET_MS = 3000;

export interface SessionSearchResult {
  session: SessionInfo;
  entryId?: string;
  blockIndex: number;
  before: string;
  match: string;
  after: string;
}

export interface SessionSearchResponse {
  results: SessionSearchResult[];
  truncated: boolean;
}

// Try FTS5 index first; fall back to readline scan.
async function trySearchFromIndex(query: string, sessions: readonly SessionInfo[]): Promise<SessionSearchResponse | null> {
  try {
    const settings = await readSessionIndexSettings();
    if (!settings.enabled || !isIndexAvailable()) return null;
    initSchema();
    const indexedSessions = getAllSessions();
    if (indexedSessions.length === 0) return null;

    // The index is only authoritative when it covers every requested session.
    // If some sessions are not in the index (e.g. freshly created, not yet
    // indexed), fall back to the readline scan so their contents are searched.
    const indexedIds = new Set(indexedSessions.map((s) => s.id));
    const allCovered = sessions.every((s) => indexedIds.has(s.id));
    if (!allCovered) return null;

    const ftsResults = searchEntries(query, { limit: 30 });
    if (ftsResults.length === 0) {
      // No matches in the index — and the index covers all sessions, so the
      // readline scan would find nothing either. Return an empty result.
      return { results: [], truncated: false };
    }

    // Map session IDs to SessionInfo objects
    const sessionMap = new Map(sessions.map((s) => [s.id, s]));
    const results = ftsResults
      .filter((r) => sessionMap.has(r.sessionId))
      .map((r) => {
        const session = sessionMap.get(r.sessionId)!;
        return {
          session,
          ...(r.entryId ? { entryId: r.entryId } : {}),
          blockIndex: 0,
          before: "",
          match: r.snippet?.replace(/<mark>/g, "").replace(/<\/mark>/g, "") || r.content?.slice(0, 80) || "",
          after: "",
        };
      });

    return { results, truncated: results.length >= 30 };
  } catch {
    return null;
  }
}

export async function searchSessionContents(
  sessions: readonly SessionInfo[],
  query: string,
  requestSignal?: AbortSignal,
): Promise<SessionSearchResponse> {
  const indexedResult = await trySearchFromIndex(query, sessions);
  if (indexedResult) return indexedResult;

  // Fallback: readline scan
  const response: SessionSearchResponse = { results: [], truncated: false };
  const needle = query.trim();
  if (!needle) return response;
  if (needle.length > 200) throw new RangeError("Search query exceeds 200 characters");
  // Escape every operator: this is literal search, with offsets in the original text.
  const matcher = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  const deadline = Date.now() + TIME_BUDGET_MS;
  const timeout = AbortSignal.timeout(TIME_BUDGET_MS);
  const signal = requestSignal ? AbortSignal.any([requestSignal, timeout]) : timeout;
  const candidates = sessions
    .filter((session) => !session.transient && session.path)
    .sort((a, b) => b.modified.localeCompare(a.modified));

  for (const [index, session] of candidates.entries()) {
    if (index >= MAX_FILES || response.results.length >= MAX_RESULTS || signal.aborted || Date.now() >= deadline) {
      response.truncated = true;
      break;
    }
    const stream = createReadStream(session.path, { encoding: "utf8", end: MAX_FILE_BYTES - 1, signal });
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    let found = false;
    try {
      for await (const line of lines) {
        if (signal.aborted || Date.now() >= deadline) {
          response.truncated = true;
          break;
        }
        if (line.length > MAX_LINE_CHARS) {
          response.truncated = true;
          continue;
        }
        let entry;
        try { entry = JSON.parse(line); } catch { continue; }
        if (entry?.type !== "message" || !["user", "assistant"].includes(entry.message?.role)) continue;
        const content: unknown = entry.message.content;
        const blocks = typeof content === "string" ? [{ type: "text", text: content }] : Array.isArray(content) ? content : [];
        const textBlocks = blocks.flatMap((block, blockIndex) => block?.type === "text" && typeof block.text === "string" ? [{ text: block.text as string, blockIndex }] : []);
        const text = textBlocks.map((block) => block.text).join("\n");
        const match = matcher.exec(text);
        if (!match) continue;
        const start = match.index;
        const end = start + match[0].length;
        let blockOffset = 0;
        const matchedBlock = textBlocks.find((block) => {
          const blockEnd = blockOffset + block.text.length;
          blockOffset = blockEnd + 1;
          return start <= blockEnd;
        });
        response.results.push({
          session,
          ...(typeof entry.id === "string" ? { entryId: entry.id } : {}),
          blockIndex: matchedBlock!.blockIndex,
          before: (start > 80 ? "..." : "") + text.slice(Math.max(0, start - 80), start).replace(/\s+/g, " ").trimStart(),
          match: match[0].replace(/\s+/g, " "),
          after: text.slice(end, end + 80).replace(/\s+/g, " ").trimEnd() + (end + 80 < text.length ? "..." : ""),
        });
        found = true;
        break;
      }
    } catch {
      // Missing/unreadable files and interrupted reads must not hide other results.
      response.truncated = true;
    } finally {
      lines.close();
      stream.destroy();
    }
    if (!found && stream.bytesRead >= MAX_FILE_BYTES) response.truncated = true;
  }
  return response;
}
