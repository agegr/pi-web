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

/** A nested value's first readable text: an object's first primitive, an array's items joined. */
function nestedText(value: unknown): string | null {
  if (Array.isArray(value)) {
    const items = value
      .map((item) => primitiveText(item) ?? (item && typeof item === "object" && !Array.isArray(item)
        ? Object.values(item).map(primitiveText).find((text) => text !== null) ?? null
        : null))
      .filter((text): text is string => text !== null);
    return items.length > 0 ? items.join(", ") : null;
  }
  if (value && typeof value === "object") {
    for (const inner of Object.values(value)) {
      const text = primitiveText(inner) ?? nestedText(inner);
      if (text !== null) return text;
    }
  }
  return null;
}

/**
 * The one line a collapsed tool card shows after the tool's name: the path,
 * command or query when the call has one, else its first readable argument.
 * An argument that is a list or an object (an `ask_user_question` call's
 * `questions[]`) is read for its text instead of printing `[object Object]`.
 */
export function toolInputPreview(input: unknown, resultPatchPath: string | null = null): string {
  if (!input || typeof input !== "object" || Array.isArray(input)) return "";
  const record = input as Record<string, unknown>;
  const clip = (text: string) => text.slice(0, PREVIEW_MAX);
  for (const key of ["command", "path", "file_path"]) {
    const text = primitiveText(record[key]);
    if (text !== null) return clip(text);
  }
  if (resultPatchPath) return clip(resultPatchPath);
  for (const key of ["pattern", "query"]) {
    const text = primitiveText(record[key]);
    if (text !== null) return clip(text);
  }
  const values = Object.values(record);
  for (const value of values) {
    const text = primitiveText(value);
    if (text !== null) return clip(text);
  }
  for (const value of values) {
    const text = nestedText(value);
    if (text !== null) return clip(text);
  }
  return "";
}
