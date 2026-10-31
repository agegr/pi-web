/**
 * Find-in-file over the source view's loaded text (components/FileViewer.tsx).
 * The viewer renders only the lines around the viewport, so the browser's own
 * find would see a window; this searches every loaded line and the viewer
 * scrolls to a match, rendering it on arrival.
 */

/** One occurrence: `line` is 0-based, `start`/`end` are UTF-16 offsets in that line. */
export interface SourceMatch {
  line: number;
  start: number;
  end: number;
}

/** Matches kept in memory; the total is still counted. */
export const SOURCE_SEARCH_MAX_MATCHES = 5_000;

/** How much of a truncated file find loads before it stops (8 MB). */
export const SOURCE_SEARCH_MAX_BYTES = 8 * 1024 * 1024;

export interface SourceSearchResult {
  matches: SourceMatch[];
  /** Every occurrence, including ones past `SOURCE_SEARCH_MAX_MATCHES`. */
  total: number;
  /** True when the stored list stopped short of `total`. */
  truncated: boolean;
}

/** Non-overlapping, case-insensitive by default. An empty query finds nothing. */
export function findSourceMatches(
  lines: readonly string[],
  query: string,
  caseSensitive = false,
  limit: number = SOURCE_SEARCH_MAX_MATCHES,
): SourceSearchResult {
  const matches: SourceMatch[] = [];
  if (!query) return { matches, total: 0, truncated: false };
  // A literal RegExp keeps every index on the original line (lowercasing would
  // move them for text whose case folds to a different length) and handles the
  // case-insensitive comparison, escaped so a `.` or `*` stays a character.
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), caseSensitive ? "g" : "gi");
  const max = Math.max(0, Math.floor(limit));
  let total = 0;
  for (let line = 0; line < lines.length; line += 1) {
    pattern.lastIndex = 0;
    for (let at = pattern.exec(lines[line]); at; at = pattern.exec(lines[line])) {
      total += 1;
      if (matches.length < max) matches.push({ line, start: at.index, end: at.index + at[0].length });
      if (at[0].length === 0) pattern.lastIndex += 1;
    }
  }
  return { matches, total, truncated: total > matches.length };
}
