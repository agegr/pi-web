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
