/**
 * JSON with comments and trailing commas, as hand-edited config files use it
 * (pi's `models.json`, VS Code's and Zed's settings, `opencode.jsonc`, and the
 * snippets people paste from them). Runs in the browser and on the server.
 */

/**
 * Drops `//` line comments, `/* … *\/` block comments and trailing commas,
 * leaving string literals untouched.
 *
 * It extends pi's own `stripJsonComments` (SDK `dist/utils/json.js`, not
 * exported), which knows only line comments and trailing commas, and returns
 * the same text for every input pi accepts: both scan left to right and try a
 * string literal first, so they consume the same strings and line comments,
 * and a `/*` outside them is a JSON syntax error pi rejects anyway. A block
 * comment becomes one space, the way JSONC parsers read it, so it never joins
 * the tokens on either side (`1/**\/2` stays two numbers and fails to parse).
 */
export function stripJsonComments(input: string): string {
  return input
    .replace(/"(?:\\.|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (match) => {
      if (match[0] === '"') return match;
      return match[1] === "*" ? " " : "";
    })
    .replace(/"(?:\\.|[^"\\])*"|,(\s*[}\]])/g, (match, tail?: string) => tail ?? (match[0] === '"' ? match : ""));
}

/**
 * Parses JSONC: a leading byte-order mark, comments and trailing commas are
 * allowed. Throws the `SyntaxError` of `JSON.parse` for anything else,
 * including an unterminated block comment.
 */
export function parseJsonc(text: string): unknown {
  return JSON.parse(stripJsonComments(text.replace(/^\uFEFF/, "")));
}
