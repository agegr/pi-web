/**
 * A tool call's arguments as flat fields, for the card that shows them as a
 * table instead of a JSON blob.
 *
 * The rule is structural, so it covers every tool — built-in, package and MCP —
 * without a list of names or keys to keep current: **all of the arguments or
 * none of them.** A value that is an object or an array (an `edit` call's
 * `edits[]`, an MCP tool's nested argument) takes the whole card back to the
 * JSON view, because a one-level table cannot show a tree and a row that
 * quietly drops a subtree is an argument the user never sees.
 */

export interface ToolField {
  key: string;
  value: string;
  /** The value has newlines of its own, so its row keeps them as a block. */
  multiline: boolean;
}

/** What an empty argument is worth in a table: something the eye can find. */
export const EMPTY_FIELD_VALUE = "(empty)";

/**
 * The arguments as rows, in the order the tool received them, or `null` when
 * this call is not a flat record — nested, streamed, empty, or not an object.
 */
export function toolFieldsOfInput(input: unknown): ToolField[] | null {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return null;
  const entries = Object.entries(input);
  if (entries.length === 0) return null;

  const fields: ToolField[] = [];
  for (const [key, value] of entries) {
    if (value !== null && typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
      return null;
    }
    const text = value === null ? "null" : String(value);
    fields.push({ key, value: text === "" ? EMPTY_FIELD_VALUE : text, multiline: text.includes("\n") });
  }
  return fields;
}

const PREVIEW_MAX = 120;

function primitiveText(value: unknown): string | null {
  if (typeof value === "string") return value.trim() ? value : null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

/**
 * A value that reads as itself: a non-empty string, a number or boolean, or a
 * list of only those (`web_search`'s `queries[]`, `fetch_content`'s `urls[]`,
 * an argv-style `command`), its items joined.
 */
function firstRankText(value: unknown, separator = ", "): string | null {
  if (!Array.isArray(value)) return primitiveText(value);
  if (value.length === 0 || !value.every((item) => item === null || typeof item !== "object")) return null;
  const items = value.map(primitiveText).filter((text): text is string => text !== null);
  return items.length > 0 ? items.join(separator) : null;
}

/** A nested value's first readable text: an object's first value that reads, a list's items' texts joined. */
function nestedText(value: unknown): string | null {
  if (Array.isArray(value)) {
    const items = value
      .map((item) => primitiveText(item) ?? nestedText(item))
      .filter((text): text is string => text !== null);
    return items.length > 0 ? items.join(", ") : null;
  }
  if (value && typeof value === "object") {
    for (const inner of Object.values(value)) {
      const text = firstRankText(inner) ?? nestedText(inner);
      if (text !== null) return text;
    }
  }
  return null;
}

/**
 * The one line a collapsed tool card shows after the tool's name: the path,
 * command or query when the call has one, else its first argument that reads
 * as itself (a string, number, boolean or list of those), else the text inside
 * its first object argument (an `ask_user_question` call's `questions[]`)
 * instead of `[object Object]`.
 */
export function toolInputPreview(input: unknown, resultPatchPath: string | null = null, toolName?: string): string {
  if (!input || typeof input !== "object" || Array.isArray(input)) return "";
  const record = input as Record<string, unknown>;
  const clip = (text: string) => {
    if (text.length <= PREVIEW_MAX) return text;
    const last = text.charCodeAt(PREVIEW_MAX - 1);
    return text.slice(0, last >= 0xd800 && last <= 0xdbff ? PREVIEW_MAX - 1 : PREVIEW_MAX);
  };
  // pi's own grep and find cards lead with the pattern ("grep /TODO/ in src").
  if (toolName === "grep" || toolName === "find") {
    const pattern = firstRankText(record.pattern);
    if (pattern !== null) return clip(pattern);
  }
  for (const key of ["command", "path", "file_path"]) {
    // An argv-style command reads as the command line it is.
    const text = firstRankText(record[key], key === "command" ? " " : ", ");
    if (text !== null) return clip(text);
  }
  if (resultPatchPath) return clip(resultPatchPath);
  for (const key of ["pattern", "query"]) {
    const text = firstRankText(record[key]);
    if (text !== null) return clip(text);
  }
  const values = Object.values(record);
  for (const value of values) {
    const text = firstRankText(value);
    if (text !== null) return clip(text);
  }
  for (const value of values) {
    const text = nestedText(value);
    if (text !== null) return clip(text);
  }
  return "";
}
