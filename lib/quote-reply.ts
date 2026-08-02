/**
 * Quote-reply helpers: detect questions/options in an assistant message and
 * format a quoted reply (markdown blockquote + optional pre-filled answer)
 * for insertion into the input box. The user then decides how to send it
 * (prompt / steer / followUp) — these helpers never send.
 */

export interface QuoteOption {
  /** Short label for the button. */
  label: string;
  /** Pre-filled answer line under the quote. */
  value: string;
}

/** Strip light markdown emphasis so matching works on plain text. */
function clean(text: string): string {
  return text.replace(/[*_`~]/g, "").trim();
}

/** Truncate to `n` chars with an ellipsis. */
function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n).trimEnd() + "…" : s;
}

/** Trim filler words from an option fragment pulled out of a sentence. */
function cleanOption(s: string): string {
  return s
    .replace(/^(我要|我想我?|你想要?|你想我?|你想要?|想要?|需要|你来|你来?|用|使用|选|选择|我|你)\s*/u, "")
    .replace(/[吗吧呢]?$/u, "")
    .replace(/[？?，,。.!！、]$/gu, "")
    .trim();
}

/**
 * Split a paragraph into question/segment chunks by terminal punctuation and
 * choice connectors. Returns [] for non-question paragraphs (caller decides
 * whether to still offer a plain quote).
 */
export function splitQuestions(text: string): string[] {
  const t = clean(text);
  if (!t) return [];
  // Split AFTER ？/? and on ；; — but NOT before 还是/或者, so that an
  // "A 还是 B" choice stays whole for detectOptions to match as one segment.
  const parts = t
    .split(/(?<=[？?])|[；;]/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return parts;
}

/** Whether a segment looks like a question at all (used to decide engagement). */
export function isQuestion(seg: string): boolean {
  return /[？?]\s*$|吗[？?]?\s*$|是否|要不要|能不能|可不可以|还是|或者/u.test(seg);
}

/**
 * Detect concrete options in a question segment.
 * Returns null when no clear options can be extracted (caller falls back to a
 * plain quote with an empty answer line).
 */
export function detectOptions(seg: string): QuoteOption[] | null {
  const t = clean(seg);
  if (!t) return null;

  // 1) Explicit choice: "A 还是 B" / "A 或者 B" / "A or B" (\bor\b so
  //    "store"/"word" don't split at their internal "or").
  const choice = t.match(/^(.+?)\s*(?:还是|或者|或者还是|\bor\b)\s*(.+?)[？?]?\s*$/iu);
  if (choice) {
    const a = cleanOption(choice[1]);
    const b = cleanOption(choice[2]);
    if (a && b && a !== b) {
      return [
        { label: truncate(a, 12), value: a },
        { label: truncate(b, 12), value: b },
      ];
    }
  }

  // 2) Yes/no question (Chinese cues + trailing ？). But NOT open-ended
  // questions (怎么做/哪个/什么/…) — those have no yes/no answer, so fall
  // through to the plain-quote fallback.
  const openEnded = /怎么|如何|怎样|哪个|哪些|什么|为什么|为何|谁|多少|几(个|点|时)?|what|how|why|who|where/u.test(t);
  const yesNo = !openEnded && (/[？?]\s*$/u.test(t) || /(?:吗|吧|呢)[？?]?\s*$/u.test(t) || /是否|要不要|能不能|可不可以|要不要我|需要我/u.test(t));
  if (yesNo) {
    // Try to surface the action ("要我X吗" → "好，X") for a more concrete button.
    const action = t
      .replace(/^(要我|需要我|要不要我?|是否|能不能|可不可以|要不要|或者|还是|你能|你可以|请|麻烦)\s*/u, "")
      .replace(/[吗吧呢啊呀]?[？?]+$/u, "")  // trailing 吗？/？
      .replace(/[吗吧呢啊呀]$/u, "")           // bare trailing 吗/吧/呢
      .trim();
    if (action && action.length <= 16) {
      return [
        { label: `好，${truncate(action, 10)}`, value: "是的" },
        { label: "不用", value: "不用了" },
      ];
    }
    return [
      { label: "是", value: "是的" },
      { label: "否", value: "不用了" },
    ];
  }

  // 3) Not a recognizable closed question.
  return null;
}

/**
 * Format a quoted reply. Each source line is prefixed with "> "; an optional
 * pre-filled answer line follows (empty line if none) so the user types under
 * the quote, email-reply style.
 */
export function formatQuote(seg: string, value?: string): string {
  const quote = clean(seg)
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n");
  return value ? `${quote}\n${value}` : `${quote}\n`;
}

/**
 * Extract candidate file paths from plain text (e.g. "design/foo.md" written
 * inline by the assistant, not as a markdown link). Returns de-duplicated
 * paths without trailing punctuation. The caller should verify existence via
 * the backend before offering them as "open" actions.
 */
export function extractFilePaths(text: string): string[] {
  // 1) Paths containing a slash with an extension: dir/name.ext, ./dir/name.ext
  // 2) Bare filenames with a common source/doc extension
  const re = /(?:\.[\w-]+\/|[\w-]+\/)+[\w.@-]+\.\w+|\b[A-Za-z0-9_.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|md|mdx|json|py|go|rs|css|scss|html|sh|yml|yaml|toml|lock|txt|sql|env)\b/gu;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of text.matchAll(re)) {
    let p = m[0];
    // Strip trailing punctuation that the regex might have swallowed.
    p = p.replace(/[），。、；：!！?？)>"'`]$/u, "");
    if (p.length >= 3 && !seen.has(p)) {
      seen.add(p);
      out.push(p);
    }
  }
  return out;
}

export interface ParsedSegment {
  /** The cleaned segment text. */
  text: string;
  /** Detected options, or null when unclear (fallback to plain quote). */
  options: QuoteOption[] | null;
}

/**
 * Parse a whole paragraph into per-segment results (used by the popover to
 * list each question with its own button row).
 */
export function parseParagraph(text: string): ParsedSegment[] {
  return splitQuestions(text).map((seg) => ({
    text: seg,
    options: detectOptions(seg),
  }));
}
