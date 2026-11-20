// Pure helpers for the chat input's # session autocomplete. Mirrors the @ file
// autocomplete (lib/file-fuzzy.ts): a `#` at line start or after whitespace
// opens the picker, entries are ranked by name / first message / cwd, and
// selecting one inserts a compact `[title](#session:uuid)` reference that the
// server expands to the session's transcript at send time.

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
 * token), so Markdown headings never trigger: `##` matches only as a single
 * `#` whose query starts with `#`, and `# foo` (a heading) has whitespace
 * inside the token, which closes the menu.
 */
export function extractHashQuery(textBeforeCursor: string): HashQueryMatch | null {
  const plain = /(?:^|\s)#([^\s]*)$/.exec(textBeforeCursor);
  if (plain) {
    return {
      start: textBeforeCursor.length - (plain[1].length + 1),
      query: plain[1],
    };
  }
  return null;
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
  const lowerQuery = query.toLowerCase();
  const inProject = (session: SessionInfo) => !!currentRoot && (session.projectRoot ?? session.cwd) === currentRoot;
  if (!lowerQuery) {
    return [...sessions]
      .sort((a, b) => Number(inProject(b)) - Number(inProject(a)) || b.modified.localeCompare(a.modified))
      .slice(0, limit);
  }
  const scored = sessions
    .map((session) => ({ session, score: scoreSession(session, lowerQuery) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) =>
      Number(inProject(b.session)) - Number(inProject(a.session))
      || b.score - a.score
      || b.session.modified.localeCompare(a.session.modified));
  return scored.slice(0, limit).map((entry) => entry.session);
}
