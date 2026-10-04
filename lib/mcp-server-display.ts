import type { McpConfigFieldRef, McpConfigFileProblem, McpServerInfo, McpVariableReference } from "./api-types";

// Display helpers for MCP server descriptions (`McpServerInfo`), shared by the
// trust dialog and Settings › MCP. Client-safe: types only, no Node imports.
// What they format was masked on the server already; nothing here reveals or
// resolves a value.

// Characters that would make the text shown differ from the text that runs,
// in a value a repository wrote: controls (a newline can push the rest of an
// argument out of view), format characters (bidi overrides that reorder what
// follows, zero-width spaces, word joiners, tag characters), line and
// paragraph separators, variation selectors, the blank fillers Hangul and
// Braille define, and every space but U+0020, which CSS does not collapse and
// which reads as an ordinary space.
const HIDDEN_CHARACTERS =
  "\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}\\u00A0\\u1680\\u2000-\\u200A\\u202F\\u205F\\u3000"
  + "\\uFE00-\\uFE0F\\u{E0100}-\\u{E01EF}\\u115F\\u1160\\u3164\\uFFA0\\u2800";
const HIDDEN_CHARACTER = new RegExp(`[${HIDDEN_CHARACTERS}]`, "gu");
const HAS_HIDDEN_CHARACTER = new RegExp(`[${HIDDEN_CHARACTERS}]`, "u");

/** Whether `text` holds a character `revealHiddenCharacters()` would replace. */
export function hasHiddenCharacters(text: string): boolean {
  return HAS_HIDDEN_CHARACTER.test(text);
}

/**
 * `text` with each invisible, control or unusual space character replaced by
 * a visible `\u{XXXX}` escape. Not `\n` or `\t`: a Windows path such as
 * `C:\new\tools` is written with backslashes and must not read as escapes.
 */
export function revealHiddenCharacters(text: string): string {
  return text.replace(HIDDEN_CHARACTER, (character) => {
    const code = character.codePointAt(0) ?? 0;
    return `\\u{${code.toString(16).toUpperCase().padStart(4, "0")}}`;
  });
}

// Backslashes are left alone, so a Windows path reads as written.
const NEEDS_QUOTES = /[\s"'`$|&;<>()*?#~]/;

/**
 * One argument as a reader would retype it: double-quoted when it is empty or
 * holds whitespace, shell syntax or a hidden character, which is shown escaped.
 */
function displayArgument(argument: string): string {
  const hidden = hasHiddenCharacters(argument);
  const shown = revealHiddenCharacters(argument);
  if (shown !== "" && !hidden && !NEEDS_QUOTES.test(shown)) return shown;
  return `"${shown.replace(/"/g, '\\"')}"`;
}

/**
 * A stdio entry's command line, for display only, each part quoted when
 * needed so `["a b"]` and `["a", "b"]` read differently. The command is
 * quoted by the same rule: the SDK spawns it without a shell, so it is one
 * executable path, and `./tools/lint --check` names a file called
 * `lint --check`, not `lint` with an option.
 */
export function formatMcpCommandLine(command: string, args: readonly string[] = []): string {
  return [command, ...args].map(displayArgument).join(" ");
}

/**
 * What an entry would connect to: the URL of an HTTP entry, the command line of
 * a stdio entry, and for an entry the validator refused (no transport) its URL
 * or command, whichever it has. Hidden characters are shown escaped.
 */
export function mcpServerTarget(server: Pick<McpServerInfo, "transport" | "command" | "args" | "url">): string | undefined {
  const commandLine = server.command !== undefined ? formatMcpCommandLine(server.command, server.args) : undefined;
  const url = server.url !== undefined ? revealHiddenCharacters(server.url) : undefined;
  if (server.transport === "http") return url;
  if (server.transport === "stdio") return commandLine;
  return url ?? commandLine;
}

/**
 * Whether anything the entry names — its name, command, arguments, working
 * directory, URL, env and header names — holds a hidden character, so the
 * reader can be told that the escapes they see are not literal text.
 */
export function mcpServerHasHiddenCharacters(
  server: Pick<McpServerInfo, "name" | "command" | "args" | "cwd" | "url" | "envNames" | "headerNames">,
): boolean {
  return [server.name, server.command, server.cwd, server.url, ...(server.args ?? []), ...server.envNames, ...server.headerNames]
    .some((text) => text !== undefined && hasHiddenCharacters(text));
}

/** The i18n key and params naming a value the SDK resolves: `env NAME`, `header NAME`, `oauth.clientSecret`. */
export function mcpFieldLabel(field: McpConfigFieldRef): { key: string; params?: { name: string } } {
  if (field.kind === "oauth-client-secret") return { key: "mcp.field.oauthClientSecret" };
  return {
    key: field.kind === "env" ? "mcp.field.env" : "mcp.field.header",
    params: { name: revealHiddenCharacters(field.name ?? "") },
  };
}

/**
 * The i18n key for the line above an entry's variable references: an HTTP
 * entry sends them to its URL, a stdio entry hands them to its process.
 */
export function mcpVariableReferencesKey(server: Pick<McpServerInfo, "transport">): string {
  return server.transport === "http" ? "mcp.server.sendsVariables" : "mcp.server.passesVariables";
}

/** One chip per variable: the variable, and the field that reads it. */
export function mcpVariableChips(references: readonly McpVariableReference[]): { variable: string; field: McpConfigFieldRef }[] {
  return references.flatMap(({ variables, ...field }) => variables.map((variable) => ({ variable, field })));
}

/**
 * The diagnostic worth showing under a file problem's translated text: the
 * parser's position for an unparsable file, the system's reason for an
 * unreadable one, and where an outside link leads. The other reasons say all
 * there is in their translation.
 */
export function mcpFileProblemDetail(problem: McpConfigFileProblem, realPath?: string): string | undefined {
  if (problem.reason === "unparsable" || problem.reason === "unreadable") return revealHiddenCharacters(problem.error);
  if (problem.reason === "link-outside") return realPath === undefined ? undefined : revealHiddenCharacters(realPath);
  return undefined;
}
