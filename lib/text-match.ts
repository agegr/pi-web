// Text matching shared by the server-side session content search and the
// client-side keyword highlight in the chat. Pure and DOM-free on purpose: the
// search module pulls in `node:fs`, so the browser cannot import it.

export type MatchMode = "substring" | "words" | "regex";

export interface MatchSpan {
  start: number;
  end: number;
}

export interface TextMatcher {
  /** Ascending, non-overlapping match ranges, capped at `limit`. */
  find(text: string, limit: number): MatchSpan[];
}

/**
 * Build the matcher for one query.
 * - `substring`: the whole query is one literal needle.
 * - `words`: every whitespace-separated term must appear in the same text.
 * - `regex`: user-supplied pattern; an invalid pattern throws `SyntaxError`.
 */
export function buildMatcher(
  query: string,
  mode: MatchMode,
  caseSensitive: boolean,
): TextMatcher {
  if (mode === "regex") {
    // Validated once here so a bad pattern surfaces at build time, not per text.
    const source = new RegExp(query, caseSensitive ? "g" : "gi");
    return {
      find(text, limit) {
        source.lastIndex = 0;
        const out: MatchSpan[] = [];
        let match: RegExpExecArray | null;
        while ((match = source.exec(text)) !== null) {
          const length = match[0].length;
          out.push({ start: match.index, end: match.index + Math.max(1, length) });
          if (length === 0) source.lastIndex += 1;
          if (out.length >= limit) break;
        }
        return out;
      },
    };
  }

  const terms = (mode === "words" ? query.split(/\s+/) : [query]).filter(Boolean);
  const needles = caseSensitive ? terms : terms.map((term) => term.toLowerCase());

  return {
    find(text, limit) {
      if (needles.length === 0) return [];
      const haystack = caseSensitive ? text : text.toLowerCase();
      if (needles.length > 1 && !needles.every((needle) => haystack.includes(needle))) {
        return [];
      }
      const out: MatchSpan[] = [];
      for (const needle of needles) {
        let index = haystack.indexOf(needle);
        while (index !== -1 && out.length < limit) {
          out.push({ start: index, end: index + needle.length });
          index = haystack.indexOf(needle, index + needle.length);
        }
        if (out.length >= limit) break;
      }
      return out.sort((a, b) => a.start - b.start);
    },
  };
}
