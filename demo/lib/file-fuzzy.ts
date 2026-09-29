// Pure helpers for the chat input's @ file autocomplete. Mirrors the pi TUI's
// behavior: @ triggers at line start or after whitespace, entries are ranked
// with the TUI's scoreEntry ladder, and completions insert "@relative/path ".

export interface AtQueryMatch {
  /** Index of the "@" character in the text */
  start: number;
  /** Text typed after the "@" (quotes stripped); may be empty */
  query: string;
  /** True when the token uses the @"..." quoted form */
  quoted: boolean;
}

export interface FileIndexEntry {
  /** Path relative to the session cwd, "/"-separated, no trailing slash */
  path: string;
  isDir: boolean;
}

/**
 * Detect an @ file token immediately before the cursor. The @ must be at the
 * start of the text or preceded by whitespace (same rule as the TUI), so
 * emails like foo@bar never trigger. Supports the in-progress quoted form
 * @"my dir/fi so drill-down into space-containing paths keeps working.
 */
export function extractAtQuery(textBeforeCursor: string): AtQueryMatch | null {
  const quoted = /(?:^|\s)@"([^"\n]*)$/.exec(textBeforeCursor);
  if (quoted) {
    return {
      start: textBeforeCursor.length - (quoted[1].length + 2),
      query: quoted[1],
      quoted: true,
    };
  }
  const plain = /(?:^|\s)@([^\s"]*)$/.exec(textBeforeCursor);
  if (plain) {
    return {
      start: textBeforeCursor.length - (plain[1].length + 1),
      query: plain[1],
      quoted: false,
    };
  }
  return null;
}

function pathDepth(p: string): number {
  let depth = 0;
  for (let i = 0; i < p.length; i++) {
    if (p[i] === "/") depth++;
  }
  return depth;
}

/**
 * Build the entry list from the server's flat file list, deriving directory
 * entries from file paths (the index API only returns files). Base order is
 * shallow-first then alphabetical, which is what an empty @ query shows.
 */
export function buildEntriesFromFiles(files: string[]): FileIndexEntry[] {
  const dirs = new Set<string>();
  for (const f of files) {
    let idx = f.indexOf("/");
    while (idx !== -1) {
      dirs.add(f.slice(0, idx));
      idx = f.indexOf("/", idx + 1);
    }
  }
  const entries: FileIndexEntry[] = [];
  for (const d of dirs) entries.push({ path: d, isDir: true });
  for (const f of files) {
    if (!f) continue;
    entries.push({ path: f, isDir: false });
  }
  entries.sort((a, b) => pathDepth(a.path) - pathDepth(b.path) || a.path.localeCompare(b.path));
  return entries;
}

function isSubsequence(needle: string, haystack: string): boolean {
  if (!needle) return true;
  let i = 0;
  for (let j = 0; j < haystack.length && i < needle.length; j++) {
    if (haystack[j] === needle[i]) i++;
  }
  return i === needle.length;
}

/**
 * TUI scoreEntry ladder (exact 100 / prefix 80 / substring 50 / path substring
 * 30, directories +10) plus a low-weight subsequence fallback so genuinely
 * fuzzy queries like "chinp" still find components/ChatInput.tsx.
 *
 * Queries containing "/" are ranked against the full relative path instead of
 * the basename — this is what makes drill-down work: after inserting "@src/",
 * the query "src/" prefix-matches every entry inside src/ (and excludes the
 * src directory itself, since "src" does not start with "src/").
 */
function scoreEntry(entry: FileIndexEntry, lowerQuery: string): number {
  const lowerPath = entry.path.toLowerCase();
  let score = 0;
  if (lowerQuery.includes("/")) {
    if (lowerPath === lowerQuery) score = 100;
    else if (lowerPath.startsWith(lowerQuery)) score = 80;
    else if (lowerPath.includes(lowerQuery)) score = 50;
    else if (isSubsequence(lowerQuery, lowerPath)) score = 10;
  } else {
    const slash = lowerPath.lastIndexOf("/");
    const lowerName = slash === -1 ? lowerPath : lowerPath.slice(slash + 1);
    if (lowerName === lowerQuery) score = 100;
    else if (lowerName.startsWith(lowerQuery)) score = 80;
    else if (lowerName.includes(lowerQuery)) score = 50;
    else if (lowerPath.includes(lowerQuery)) score = 30;
    else if (isSubsequence(lowerQuery, lowerPath)) score = 10;
  }
  if (entry.isDir && score > 0) score += 10;
  return score;
}

export const AT_RESULT_LIMIT = 20;

export function filterFileEntries(
  entries: FileIndexEntry[],
  query: string,
  limit: number = AT_RESULT_LIMIT,
): FileIndexEntry[] {
  const lowerQuery = query.toLowerCase();
  if (!lowerQuery) return entries.slice(0, limit);

  const scored: Array<{ entry: FileIndexEntry; score: number }> = [];
  for (const entry of entries) {
    const score = scoreEntry(entry, lowerQuery);
    if (score > 0) scored.push({ entry, score });
  }
  scored.sort((a, b) =>
    b.score - a.score
    || pathDepth(a.entry.path) - pathDepth(b.entry.path)
    || a.entry.path.localeCompare(b.entry.path));
  return scored.slice(0, limit).map((s) => s.entry);
}

export interface AtInsertion {
  /** Text that replaces the @token */
  text: string;
  /** Caret position relative to the start of `text` after insertion */
  cursorOffset: number;
}

/**
 * Replacement for the @token when a suggestion is confirmed. Mirrors the
 * TUI's buildCompletionValue/applyCompletion:
 * - Files close the token: "@path " (quoted when the path contains spaces),
 *   caret after the trailing space.
 * - Directories keep the menu open for drill-down: "@dir/" with no trailing
 *   space. Quoted directories are inserted CLOSED (@"my dir/") with the caret
 *   placed before the closing quote, so both further typing and manual
 *   completion keep the token well-formed.
 */
export function buildAtInsertText(entryPath: string, isDir: boolean, forceQuotes = false): AtInsertion {
  const p = isDir ? `${entryPath}/` : entryPath;
  const needsQuotes = forceQuotes || p.includes(" ");
  if (isDir) {
    const text = needsQuotes ? `@"${p}"` : `@${p}`;
    return { text, cursorOffset: needsQuotes ? text.length - 1 : text.length };
  }
  const text = needsQuotes ? `@"${p}" ` : `@${p} `;
  return { text, cursorOffset: text.length };
}

/**
 * Closed @mention for one-shot inserts (e.g. the file explorer's @ button).
 * Unlike buildAtInsertText there is no drill-down: directories are closed
 * too, with a trailing "/" and a trailing space.
 */
export function buildAtMentionText(entryPath: string, isDir: boolean): string {
  const p = isDir ? `${entryPath}/` : entryPath;
  return p.includes(" ") ? `@"${p}" ` : `@${p} `;
}

/** Closed file @mention scoped to one logical line or an inclusive line range. */
export function buildFileLineMentionText(entryPath: string, startLine: number, endLine: number): string {
  const firstLine = Math.max(1, Math.min(startLine, endLine));
  const lastLine = Math.max(1, Math.max(startLine, endLine));
  const pathMention = entryPath.includes(" ") ? `@"${entryPath}"` : `@${entryPath}`;
  const lineSuffix = firstLine === lastLine ? `:${firstLine}` : `:${firstLine}-${lastLine}`;
  return `${pathMention}${lineSuffix} `;
}

export function buildFileAtMentionsText(entryPaths: string[]): string {
  return entryPaths.map((entryPath) => buildAtMentionText(entryPath, false)).join("");
}
