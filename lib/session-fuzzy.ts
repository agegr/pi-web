// Pure helpers for the chat input's # session autocomplete. Mirrors the @ file
// autocomplete (lib/file-fuzzy.ts): a `#` at line start or after whitespace
// opens the picker, entries are ranked by name / first message / cwd, and
// picking one adds a session reference to the composer
// (lib/session-reference-target.ts), which the server quotes at send time.

import type { SessionInfo } from "@/lib/types";

export interface HashQueryMatch {
  /** Index of the "#" character in the text */
  start: number;
  /** Text typed after the "#"; may be empty */
  query: string;
}

/**
 * Detect a # session token immediately before the cursor. The # must be at the
 * start of the text or preceded by whitespace (the same rule as the @ file
 * token), so Markdown headings never trigger: `# ` and `## foo` are headings,
 * and the menu closes as soon as the hashes are followed by a space.
 *
 * Once the query has begun it may hold spaces, so several words narrow the list
 * (#1716 asked for the sidebar's multi-word search): `#agent harness` stays one
 * token, while a space right after the `#` is still a heading.
 */
export function extractHashQuery(textBeforeCursor: string): HashQueryMatch | null {
  // One line only: a token never spans a line break.
  const token = /(?:^|\s)#([^\n]*)$/.exec(textBeforeCursor);
  if (!token) return null;
  const query = token[1];
  // `# ` (and `## `) is a Markdown heading: a space right after the hashes is
  // the title being typed, not a session search.
  if (query.startsWith(" ") || query.startsWith("# ")) return null;
  return {
    start: textBeforeCursor.length - (query.length + 1),
    query,
  };
}

export const HASH_RESULT_LIMIT = 20;

function scoreSession(session: SessionInfo, lowerQuery: string): number {
  const name = (session.name ?? "").toLowerCase();
  const firstMessage = session.firstMessage.toLowerCase();
  const cwdBase = (session.cwd.split(/[\\/]/).pop() ?? session.cwd).toLowerCase();
  if (name === lowerQuery) return 100;
  if (name.startsWith(lowerQuery)) return 80;
  if (firstMessage.startsWith(lowerQuery)) return 70;
  if (name.includes(lowerQuery)) return 50;
  if (firstMessage.includes(lowerQuery)) return 40;
  if (cwdBase.startsWith(lowerQuery)) return 30;
  if (cwdBase.includes(lowerQuery)) return 20;
  return 0;
}

/** Rank sessions by name / first message / cwd; an empty query shows the most
 *  recent first (the catalogue arrives in `modified` descending order). A
 *  `currentRoot` (the composer's project root) puts that project's sessions
 *  before every other, as OpenCode ranks its @ session search. */
export function filterSessionEntries(
  sessions: SessionInfo[],
  query: string,
  limit: number = HASH_RESULT_LIMIT,
  currentRoot?: string,
): SessionInfo[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const inProject = (session: SessionInfo) => !!currentRoot && (session.projectRoot ?? session.cwd) === currentRoot;
  if (!terms.length) {
    return [...sessions]
      .sort((a, b) => Number(inProject(b)) - Number(inProject(a)) || b.modified.localeCompare(a.modified))
      .slice(0, limit);
  }
  const scored = sessions
    .map((session) => {
      let score = 0;
      for (const term of terms) {
        const termScore = scoreSession(session, term);
        // A word that matches nothing drops the session: the words narrow together.
        if (termScore === 0) return { session, score: 0 };
        score += termScore;
      }
      return { session, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) =>
      Number(inProject(b.session)) - Number(inProject(a.session))
      || b.score - a.score
      || b.session.modified.localeCompare(a.session.modified));
  return scored.slice(0, limit).map((entry) => entry.session);
}
