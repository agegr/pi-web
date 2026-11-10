import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import type { SessionInfo } from "./types";

const MAX_FILES = 500;
const MAX_RESULTS = 30;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_LINE_CHARS = 1024 * 1024;
/** Bound on one result's snippet, including margins and any appended excerpts. */
const MAX_SNIPPET_CHARS = 200;
/** Past this many terms the per-message width expansion turns quadratic; search the whole query literally. */
const MAX_TERMS = 8;
/** Anchor margin of a multi-term query: it keeps room for terms found in other messages. */
const MULTI_TERM_MARGIN = 40;
/** Excerpt sizes tried in order, largest first, for a term outside the anchor's window. */
const EXCERPT_SIZES = [30, 20, 12] as const;
/** Room kept free for the " … (+N)" tail counting terms that no longer fit. */
const OMITTED_MARK_RESERVE = 10;
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
  /**
   * Every term's highlight, as offsets into `before + match + after`, so an AND
   * query marks each of its words instead of only the first one. Overlapping
   * terms are merged; a term that only occurs outside the snippet window has no
   * range. Absent means "just `match`", which is what older payloads implied.
   */
  highlights?: HighlightRange[];
}

/** One term's first hit; the snippet and its ranges are assembled from these. */
type TermHit = Omit<SessionSearchResult, "session" | "titleMatch" | "highlights">;

export interface HighlightRange {
  start: number;
  end: number;
}

// Slicing by UTF-16 index can cut a surrogate pair in half, which renders as a
// replacement character; move the boundary out of the pair.
function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

function head(text: string, length: number): string {
  if (text.length <= length) return text;
  return text.slice(0, isLowSurrogate(text.charCodeAt(length)) ? length - 1 : length);
}

function tail(text: string, length: number): string {
  const start = text.length - length;
  if (start <= 0) return text;
  return text.slice(isLowSurrogate(text.charCodeAt(start)) ? start - 1 : start);
}

// One range per term: the primary hit for the first term, its earliest occurrence
// for the rest. Sorted and merged so overlapping terms paint a single mark.
function highlightRanges(before: string, match: string, after: string, matchers: readonly RegExp[]): HighlightRange[] {
  const text = before + match + after;
  const ranges: HighlightRange[] = [{ start: before.length, end: before.length + match.length }];
  for (const matcher of matchers.slice(1)) {
    const hit = matcher.exec(text);
    if (hit) ranges.push({ start: hit.index, end: hit.index + hit[0].length });
  }
  ranges.sort((left, right) => left.start - right.start);
  const merged: HighlightRange[] = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

export interface SessionSearchResponse {
  results: SessionSearchResult[];
  truncated: boolean;
}

// Space separates terms and every term must match somewhere in the session
// (session-level AND, any order); double quotes keep a phrase exact. Each term
// stays literal, so `C++` and `foo(bar)` need no escaping from the user.
// A quote only delimits a phrase at the start of a term or to close one, so a
// quote inside a word (`foo"bar`) stays literal and stays searchable.
function parseTerms(query: string): string[] {
  const terms: string[] = [];
  let current = "";
  let quoted = false;
  for (const char of query) {
    if (char === '"') {
      if (quoted) {
        if (current) terms.push(current);
        current = "";
        quoted = false;
        continue;
      }
      if (!current) {
        quoted = true;
        continue;
      }
    }
    if (!quoted && /\s/.test(char)) {
      if (current) terms.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current) terms.push(current);
  return terms;
}

// Raw JSONL keeps text as UTF-8 (only quotes, backslashes and control characters are
// escaped), so a plain term can be spotted in the raw line and JSON.parse skipped for
// every line that cannot contribute a still-missing term. A forward slash is included
// because other tools' exporters escape it as `\/`. Terms containing escaped
// characters, or whitespace that the joined text obscures, keep the full path.
function rawPrefilter(term: string): RegExp | null {
  if (!/^[^\s"/\\\u0000-\u001f]+$/.test(term)) return null;
  return new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
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
  // Escape every operator: this is literal search, with offsets in the original text.
  const parsed = parseTerms(needle);
  // A query of only quotes, e.g. `""`, parses to no term at all and a pathological one
  // can parse to dozens; both fall back to the whole string as a single literal term,
  // which is exactly the search this change must never narrow.
  const terms = parsed.length && parsed.length <= MAX_TERMS ? parsed : [needle];
  const matchers = terms.map((term) => new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  const prefilters = terms.map(rawPrefilter);
  // A term outside ASCII could in principle be stored as \uXXXX escapes; keep a
  // guard so such a line is still parsed. pi writes UTF-8, so this rarely fires.
  const escapedSafe = terms.map((term) => /[^\x00-\x7f]/.test(term));
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
    // First hit per term; a session qualifies once every term has one.
    // (map, not new Array(n): every() skips holes in a sparse array.)
    const hits: Array<TermHit | undefined> = matchers.map(() => undefined);
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
        // Two cheap rejections before the expensive JSON.parse: only message entries
        // are searched, and a line worth parsing must carry a term we still need.
        if (!line.includes('"type":"message"')) continue;
        let candidate = false;
        for (let termIndex = 0; termIndex < matchers.length; termIndex++) {
          if (hits[termIndex]) continue;
          const prefilter = prefilters[termIndex];
          if (!prefilter || prefilter.test(line)) { candidate = true; break; }
          if (escapedSafe[termIndex] && line.includes("\\u")) { candidate = true; break; }
        }
        if (!candidate) continue;
        let entry;
        try { entry = JSON.parse(line); } catch { continue; }
        if (entry?.type !== "message" || !["user", "assistant"].includes(entry.message?.role)) continue;
        const content: unknown = entry.message.content;
        const blocks = typeof content === "string" ? [{ type: "text", text: content }] : Array.isArray(content) ? content : [];
        const textBlocks = blocks.flatMap((block, blockIndex) => block?.type === "text" && typeof block.text === "string" ? [{ text: block.text as string, blockIndex }] : []);
        const text = textBlocks.map((block) => block.text).join("\n");
        for (const [termIndex, matcher] of matchers.entries()) {
          if (hits[termIndex]) continue;
          const match = matcher.exec(text);
          if (!match) continue;
          const anchorStart = match.index;
          const anchorEnd = anchorStart + match[0].length;
          // Widen around the anchor to the other terms of this message, so a
          // two-word query usually shows two marks instead of one. Bounded: a
          // couple of far-apart hits must not turn the row into a paragraph.
          let spanStart = anchorStart;
          let spanEnd = anchorEnd;
          for (const other of matchers) {
            const hit = other.exec(text);
            if (!hit) continue;
            spanStart = Math.min(spanStart, hit.index);
            spanEnd = Math.max(spanEnd, hit.index + hit[0].length);
          }
          // Prefer the historical 80/80 margins; tighten them only when a long term
          // or a wide span would push the row past MAX_SNIPPET_CHARS ("..." costs six
          // characters). A single term never widens, so it keeps the old window.
          const span = spanEnd - spanStart;
          const needsWiden = spanStart < anchorStart || spanEnd > anchorEnd;
          const marginWithin = (contentLength: number) =>
            Math.max(0, Math.min(80, Math.floor((MAX_SNIPPET_CHARS - contentLength - 6) / 2)));
          const widenMargin = marginWithin(span);
          const widened = needsWiden && widenMargin >= 20;
          const baseMargin = widened ? widenMargin : marginWithin(match[0].length);
          // A multi-term query whose other terms sit in another message still has to
          // fit their excerpts; a single term keeps the historical 80/80 window.
          const margin = widened || matchers.length === 1 ? baseMargin : Math.min(baseMargin, MULTI_TERM_MARGIN);
          const start = Math.max(0, (widened ? spanStart : anchorStart) - margin);
          const end = Math.min(text.length, (widened ? spanEnd : anchorEnd) + margin);
          let blockOffset = 0;
          const matchedBlock = textBlocks.find((block) => {
            const blockEnd = blockOffset + block.text.length;
            blockOffset = blockEnd + 1;
            return anchorStart <= blockEnd;
          });
          // Keep window boundaries out of surrogate pairs as well.
          const safeStart = isLowSurrogate(text.charCodeAt(start)) ? start + 1 : start;
          const safeEnd = end < text.length && isLowSurrogate(text.charCodeAt(end)) ? end - 1 : end;
          const before = (safeStart > 0 ? "..." : "") + text.slice(safeStart, anchorStart).replace(/\s+/g, " ").trimStart();
          const matchText = match[0].replace(/\s+/g, " ");
          const after = text.slice(anchorEnd, safeEnd).replace(/\s+/g, " ").trimEnd() + (safeEnd < text.length ? "..." : "");
          hits[termIndex] = {
            ...(typeof entry.id === "string" ? { entryId: entry.id } : {}),
            blockIndex: matchedBlock!.blockIndex,
            before,
            match: matchText,
            after,
          };
        }
        // Terms may sit on different lines of one session.
        if (hits.every(Boolean)) {
          found = true;
          break;
        }
      }
    } catch {
      // Missing/unreadable files and interrupted reads must not hide other results.
      response.truncated = true;
    } finally {
      lines.close();
      stream.destroy();
    }
    if (found) {
      // The row is anchored on the first term's earliest hit (for a single term
      // that is exactly the previous behaviour), then grows an excerpt for every
      // term that hit nowhere inside it — typically a word from another message.
      const primary = hits[0]!;
      const before = primary.before;
      const matchText = primary.match;
      let after = primary.after;
      const snippet = () => before + matchText + after;
      let omitted = 0;
      for (let index = 1; index < hits.length; index++) {
        const hit = hits[index]!;
        if (matchers[index].test(snippet())) continue;
        // Shrink the excerpt before dropping it: a silent drop makes a two-word query
        // look like a one-word one and hides why the session matched at all.
        let appended = false;
        for (const size of EXCERPT_SIZES) {
          // No leading ellipsis: the separator already marks the gap in front of it.
          const excerpt =
            tail(hit.before, size) + hit.match + head(hit.after, size) +
            (hit.after.length > size ? "..." : "");
          // Drop the anchor's trailing ellipsis: the separator already marks the gap.
          const base = after.endsWith("...") ? after.slice(0, -3) : after;
          const joined = base + " … " + excerpt;
          if (before.length + matchText.length + joined.length > MAX_SNIPPET_CHARS - OMITTED_MARK_RESERVE) continue;
          after = joined;
          appended = true;
          break;
        }
        if (!appended) omitted += 1;
      }
      // Count what no longer fits, so a row never pretends every term is visible.
      if (omitted) {
        const base = after.endsWith("...") ? after.slice(0, -3) : after;
        after = base + ` … (+${omitted})`;
      }
      // Ranges are recomputed over the assembled snippet so the appended excerpts
      // are marked like the anchor.
      response.results.push({ session, ...primary, before, match: matchText, after, highlights: highlightRanges(before, matchText, after, matchers) });
    }
    if (!found && stream.bytesRead >= MAX_FILE_BYTES) response.truncated = true;
    // Preserve message navigation when both body and title match. The catalogue
    // already carries the displayed name (including session_info names), so a
    // title hit is a fallback only when the transcript has no match.
    if (!found && !signal.aborted && Date.now() < deadline) {
      const title = session.name || session.firstMessage || "";
      // Every term has to be in the title; highlighting one of them alone would
      // make the result look like a partial match.
      const titleHit = matchers.every((matcher) => matcher.test(title)) ? matchers[0].exec(title) : null;
      if (titleHit) {
        const before = title.slice(0, titleHit.index);
        const matchText = titleHit[0];
        const after = title.slice(titleHit.index + titleHit[0].length);
        response.results.push({
          session,
          blockIndex: 0,
          titleMatch: true,
          before,
          match: matchText,
          after,
          highlights: highlightRanges(before, matchText, after, matchers),
        });
      }
    }
  }
  return response;
}
