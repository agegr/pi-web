// What `JSON.parse` said about an `mcp.json`, without the source text it
// quotes. Settings › MCP shows a file's parse error (`lib/mcp-config-read.ts`),
// the writer refuses with it (`lib/mcp-config-file.ts`), and the MCP host logs
// what the SDK's `loadMcpConfig()` reports (`lib/mcp-host.ts`). The host cannot
// import `mcp-config-read`, whose module chain leads back to it, so the rule
// lives here, with no imports.

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// V8's message for an unexpected token quotes the source around it instead of
// giving a position: the whole text when it is shorter than 21 characters,
// else up to 10 characters on either side, with `...` where it was cut.
const UNEXPECTED_TOKEN = /^Unexpected token '([\s\S])', ([\s\S]*) is not valid JSON$/;
const TOKEN_CONTEXT = 10;

/** Where V8's quoted context puts the unexpected token in `text`, or undefined when it cannot be told. */
function unexpectedTokenPosition(text: string, token: string, quoted: string): number | undefined {
  const cutBefore = quoted.startsWith('..."');
  const cutAfter = quoted.endsWith('"...');
  const inner = quoted.slice(cutBefore ? 3 : 0, cutAfter ? -3 : undefined);
  if (inner.length < 2 || !inner.startsWith('"') || !inner.endsWith('"')) return undefined;
  // The whole text: V8 says nothing about where in it.
  if (!cutBefore && !cutAfter) return undefined;
  const context = inner.slice(1, -1);
  let position: number;
  if (!cutBefore) {
    if (!text.startsWith(context)) return undefined;
    position = context.length - TOKEN_CONTEXT;
  } else if (!cutAfter) {
    if (!text.endsWith(context)) return undefined;
    position = text.length - context.length + TOKEN_CONTEXT;
  } else {
    position = text.indexOf(context);
    while (position >= 0 && text[position + TOKEN_CONTEXT] !== token) position = text.indexOf(context, position + 1);
    if (position < 0) return undefined;
    position += TOKEN_CONTEXT;
  }
  return text[position] === token ? position : undefined;
}

/** `at position 62 (line 5 column 7)`, as V8 words the messages that give one. */
function describePosition(text: string, position: number): string {
  const before = text.slice(0, position);
  const line = before.split("\n").length;
  const column = position - before.lastIndexOf("\n");
  return `at position ${position} (line ${line} column ${column})`;
}

/**
 * The parser's message without the source text it quotes. For an unexpected
 * token V8 quotes up to twenty characters around it (`Unexpected token ''',
 * ..."B_TOKEN": 'ghp_abcde"... is not valid JSON`), and that text is often a
 * literal secret — a single-quoted value is the usual mistake. The message
 * keeps the token only when it is punctuation, never a letter or a digit of
 * a value, and gives the position the quote stood for. Messages that already
 * give a position quote nothing and are kept.
 */
export function jsonErrorMessage(error: unknown, text: string): string {
  const message = errorMessage(error);
  if (!message.includes('"')) return message;
  const match = UNEXPECTED_TOKEN.exec(message);
  if (!match) return "Not valid JSON";
  const [, token, quoted] = match;
  const code = token.charCodeAt(0);
  const shown = /[\p{L}\p{N}]/u.test(token)
    ? ""
    : /[\p{P}\p{S}]/u.test(token)
      ? ` '${token}'`
      : ` U+${code.toString(16).toUpperCase().padStart(4, "0")}`;
  const position = unexpectedTokenPosition(text, token, quoted);
  return `Unexpected token${shown} in JSON${position === undefined ? "" : ` ${describePosition(text, position)}`}`;
}

/** How V8 ends a parse error that quotes the source (`... is not valid JSON`). */
const QUOTES_SOURCE = /is not valid JSON$/;

/**
 * One of `loadMcpConfig().errors`, safe to log. The SDK words a file it
 * cannot parse as `${path}: ${error.message}`, and V8's message for an
 * unexpected token quotes up to twenty characters around it, often part of a
 * literal secret; such a message is reworded by `jsonErrorMessage()`, keeping
 * the path. Everything else is kept as it is: the validator's messages name
 * servers and fields, never values, and a read error names the path and errno.
 * `paths` are the files the SDK read, which prefix its messages.
 */
export function scrubMcpLoadError(message: string, paths: readonly string[]): string {
  const prefix = paths.map((path) => `${path}: `).find((candidate) => message.startsWith(candidate)) ?? "";
  const rest = message.slice(prefix.length);
  return QUOTES_SOURCE.test(rest) ? `${prefix}${jsonErrorMessage(rest, "")}` : message;
}
