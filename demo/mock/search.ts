/** GET /api/sessions/search — every space-separated term must match; "a quoted run" stays one phrase. */
import type { SessionEntry } from "@/lib/types";
import { allSessions, sessionInfo } from "./sessions/store";

function blocksOf(entry: SessionEntry): string[] {
  if (entry.type !== "message") return [];
  const message = entry.message as { role: string; content?: unknown };
  if (message.role !== "user" && message.role !== "assistant") return [];
  if (typeof message.content === "string") return [message.content];
  if (!Array.isArray(message.content)) return [];
  return message.content.map((block: { type?: string; text?: string }) => (block?.type === "text" ? block.text ?? "" : ""));
}

// Same split as lib/session-search.ts: whitespace separates terms, double quotes keep
// a phrase, and a quote inside a word stays literal so literal queries keep matching.
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

// One range per term into before + match + after, sorted and merged so overlapping
// terms paint one mark. Mirrors highlightRanges() in lib/session-search.ts.
function highlightRanges(before: string, match: string, after: string, terms: readonly string[]): Array<{ start: number; end: number }> {
  const text = before + match + after;
  const lowered = text.toLowerCase();
  const ranges = [{ start: before.length, end: before.length + match.length }];
  for (const term of terms.slice(1)) {
    const index = lowered.indexOf(term);
    if (index >= 0) ranges.push({ start: index, end: index + term.length });
  }
  ranges.sort((left, right) => left.start - right.start);
  const merged: Array<{ start: number; end: number }> = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

export async function searchSessions(query: string) {
  const terms = parseTerms(query.trim()).map((term) => term.toLowerCase());
  const results: unknown[] = [];
  if (!terms.length) return { results, truncated: false };
  for (const session of allSessions()) {
    if (session.transient) continue;
    const info = sessionInfo(session);
    // First hit per term; a session qualifies once every term has one.
    const hits: unknown[] = terms.map(() => undefined);
    for (const entry of session.entries) {
      const blocks = blocksOf(entry);
      for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
        const block = blocks[blockIndex];
        const text = block.toLowerCase();
        for (const [termIndex, term] of terms.entries()) {
          if (hits[termIndex]) continue;
          const index = text.indexOf(term);
          if (index < 0) continue;
          const before = block.slice(Math.max(0, index - 60), index).replace(/\s+/g, " ");
          const matchText = block.slice(index, index + term.length);
          const after = block.slice(index + term.length, index + term.length + 80).replace(/\s+/g, " ");
          hits[termIndex] = {
            session: info,
            entryId: entry.id,
            blockIndex,
            before,
            match: matchText,
            after,
            highlights: highlightRanges(before, matchText, after, terms),
          };
        }
        if (hits.every(Boolean)) break;
      }
      if (hits.every(Boolean)) break;
    }
    if (hits.every(Boolean)) {
      // As lib/session-search.ts: anchor on the first term, then append a short
      // excerpt for any term the anchor window does not contain.
      const primary = hits[0] as {
        before: string; match: string; after: string;
        highlights: Array<{ start: number; end: number }>;
      };
      let after = primary.after;
      const snippet = () => primary.before + primary.match + after;
      for (let termIndex = 1; termIndex < terms.length; termIndex++) {
        if (snippet().toLowerCase().includes(terms[termIndex])) continue;
        const hit = hits[termIndex] as { before: string; match: string; after: string };
        const excerpt =
          (hit.before.length > 30 ? "..." : "") + hit.before.slice(-30) + hit.match +
          hit.after.slice(0, 30) + (hit.after.length > 30 ? "..." : "");
        const base = after.endsWith("...") ? after.slice(0, -3) : after;
        const joined = base + " … " + excerpt;
        if (primary.before.length + primary.match.length + joined.length > 200) continue;
        after = joined;
      }
      results.push({
        ...primary,
        after,
        highlights: highlightRanges(primary.before, primary.match, after, terms),
      });
      if (results.length >= 50) return { results, truncated: true };
      continue;
    }
    // As lib/session-search.ts: the displayed title only when no message matched,
    // and only when the title carries every term.
    const title = info.name || info.firstMessage;
    const lowerTitle = title.toLowerCase();
    if (!terms.every((term) => lowerTitle.includes(term))) continue;
    const index = lowerTitle.indexOf(terms[0]);
    const before = title.slice(0, index);
    const matchText = title.slice(index, index + terms[0].length);
    const after = title.slice(index + terms[0].length);
    results.push({
      session: info,
      blockIndex: 0,
      titleMatch: true,
      before,
      match: matchText,
      after,
      highlights: highlightRanges(before, matchText, after, terms),
    });
    if (results.length >= 50) return { results, truncated: true };
  }
  return { results, truncated: false };
}
