import {
  GEMINI_GRAMMAR,
  LITERAL_GRAMMAR,
  type McpImportNote,
  parseValue,
  type Segment,
  ServerDraft,
  timeoutFromMilliseconds,
  UNION_GRAMMAR,
  validationProblem,
  type ValueGrammar,
} from "./mcp-import-core";
import { type EntryOutcome, isRecord, mapServerEntry, mapToolFilters, siblingMcpUrl, sseRefusal } from "./mcp-import-json";
import { parseJsonc } from "./jsonc";
import { literalWord, shellAssignment, type ShellWord, type ShellWordPart } from "./shell-words";

// Command lines: a server's own command (`npx -y @foo/server`, with
// `NAME=value` prefixes), and `pi | claude | codex | gemini mcp add …`, plus
// `code --add-mcp '<json>'`. The words come from `lib/shell-words.ts`, so
// quoting is already removed; a `$NAME` the shell would have expanded is kept
// as a variable part.

export type CommandLineServers = { entries: EntryOutcome[]; notes: McpImportNote[] } | { error: McpImportNote };

/** pi's own reading of a value, or another client's grammar applied after the shell removed its quotes. */
type WordGrammar = ValueGrammar | "pi";

/**
 * A shell word as segments: text through the client's grammar, `$NAME` as a
 * variable the shell would expand. Quoted and unquoted text next to each
 * other is one string by the time the CLI reads it (`'A=$'B` is `A=$B`), so
 * adjacent text parts are joined before the grammar reads them.
 */
function wordSegments(parts: readonly ShellWordPart[], grammar: WordGrammar, resolved: boolean): Segment[] {
  const segments: Segment[] = [];
  let text = "";
  const flush = () => {
    if (!text) return;
    if (grammar === "pi") segments.push({ kind: "pi", text });
    else segments.push(...parseValue(text, grammar, resolved));
    text = "";
  };
  for (const part of parts) {
    if (part.type === "variable") {
      flush();
      segments.push({ kind: "env", name: part.name, from: part.raw, shell: true, ...(part.fallback !== undefined ? { fallback: part.fallback } : {}) });
    } else {
      text += part.value;
    }
  }
  flush();
  return segments;
}

/** Splits a word's parts at the first `separator` in its text; undefined when the text has none. */
function splitWordParts(parts: readonly ShellWordPart[], separator: string): [key: string, value: ShellWordPart[]] | undefined {
  let key = "";
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];
    if (part.type === "variable") {
      key += part.raw;
      continue;
    }
    const at = part.value.indexOf(separator);
    if (at < 0) {
      key += part.value;
      continue;
    }
    key += part.value.slice(0, at);
    const remainder = part.value.slice(at + separator.length);
    return [key, [...(remainder ? [{ ...part, value: remainder }] : []), ...parts.slice(index + 1)]];
  }
  return undefined;
}

function trimParts(parts: ShellWordPart[]): ShellWordPart[] {
  const result = parts.map((part) => ({ ...part }));
  const first = result[0];
  if (first?.type === "text") first.value = first.value.replace(/^\s+/, "");
  const last = result[result.length - 1];
  if (last?.type === "text") last.value = last.value.replace(/\s+$/, "");
  return result;
}

const URL_WORD = /^https?:\/\//i;
const WS_WORD = /^wss?:\/\//i;

function programName(word: ShellWord | undefined): string {
  return (word?.text.split(/[\\/]/).pop() ?? "").replace(/\.(?:cmd|exe|ps1)$/i, "").toLowerCase();
}

/** CLIs reached through a package runner: `npx @earendil-works/pi-coding-agent mcp add …`. */
const CLI_PACKAGES: Record<string, string> = {
  "@earendil-works/pi-coding-agent": "pi",
  "@anthropic-ai/claude-code": "claude",
  "@openai/codex": "codex",
  "@google/gemini-cli": "gemini",
};

/** CLIs whose `mcp` subcommands manage servers; only `claude mcp serve` is a server itself. */
const MANAGEMENT_CLIS = new Set(["pi", "claude", "codex", "gemini"]);
/** `pi install npm:…` and the other package commands of pi's own CLI. */
const PI_PACKAGE_COMMANDS = new Set(["install", "remove", "uninstall", "update", "list", "config"]);

/** Reads one command line already split into words. */
export function readCommandLine(words: ShellWord[]): CommandLineServers {
  let start = 0;
  let cli = programName(words[0]);
  if (["npx", "bunx", "pnpx"].includes(cli)) {
    let index = 1;
    while (words[index]?.text.startsWith("-")) index++;
    const pkg = words[index]?.text.replace(/^(@?[^@]+)@.*$/, "$1");
    if (pkg && CLI_PACKAGES[pkg] && words[index + 1]?.text === "mcp") {
      start = index;
      cli = CLI_PACKAGES[pkg];
    }
  }
  const rest = words.slice(start + 1);
  if (rest[0]?.text === "mcp" && rest.length >= 2) {
    const subcommand = rest[1].text;
    const args = rest.slice(2);
    if (cli === "pi" && subcommand === "add") return single(readPiMcpAdd(args, rest.slice(1)));
    if (cli === "claude" && subcommand === "add") return single(readClaudeMcpAdd(args));
    if (cli === "claude" && subcommand === "add-json") return single(readClaudeMcpAddJson(args));
    if (cli === "claude" && subcommand === "add-from-claude-desktop") return { error: { code: "claude-desktop-import" } };
    if (cli === "codex" && subcommand === "add") return single(readCodexMcpAdd(args));
    if (cli === "gemini" && subcommand === "add") return single(readGeminiMcpAdd(args));
    if (subcommand === "add" || subcommand === "install") return { error: { code: "cli-unsupported", params: { cli } } };
    // `pi mcp remove x`, `claude mcp login x`…: imported as a server, the Test after Add would run it on the host.
    if (MANAGEMENT_CLIS.has(cli) && !subcommand.startsWith("-") && !(cli === "claude" && subcommand === "serve")) {
      return { error: { code: "cli-not-a-server", params: { cli, command: `mcp ${subcommand}` } } };
    }
  }
  if (cli === "pi" && rest[0] && PI_PACKAGE_COMMANDS.has(rest[0].text)) {
    return { error: { code: "cli-not-a-server", params: { cli, command: rest[0].text } } };
  }
  if (["code", "code-insiders", "codium", "cursor"].includes(cli) && words.some((word) => word.text === "--add-mcp" || word.text.startsWith("--add-mcp="))) {
    return readCodeAddMcp(words.slice(1));
  }
  return single(readServerCommand(words));
}

function single(outcome: EntryOutcome | { error: McpImportNote }): CommandLineServers {
  return "error" in outcome ? { error: outcome.error } : { entries: [outcome], notes: [] };
}

// ---------------------------------------------------------------------------
// A server's own command line

function readServerCommand(words: ShellWord[]): EntryOutcome | { error: McpImportNote } {
  const draft = new ServerDraft("command-line", false);
  draft.transport = "stdio";
  let index = 0;
  const assign = () => {
    for (; index < words.length; index++) {
      const assignment = shellAssignment(words[index]);
      if (!assignment) break;
      draft.env.push([assignment.name, wordSegments(assignment.value, LITERAL_GRAMMAR, true)]);
    }
  };
  assign();
  if (words[index]?.text === "env") {
    index++;
    if (words[index]?.text.startsWith("-")) {
      return { error: { code: "cli-unknown-option", params: { cli: "env", option: words[index].text } } };
    }
    assign();
  }
  const command = words[index];
  if (!command) return { error: { code: "no-command-or-url" } };
  draft.command = wordSegments(command.parts, LITERAL_GRAMMAR, false);
  draft.args = words.slice(index + 1).map((word) => wordSegments(word.parts, LITERAL_GRAMMAR, false));
  // `npx mcp-remote <url>` bridges a remote server to stdio; pi can connect to the URL itself.
  const argTexts = words.slice(index + 1).map((word) => word.text);
  const bridged = argTexts.some((arg) => /^mcp-remote(?:@|$)/.test(arg)) ? argTexts.find((arg) => URL_WORD.test(arg)) : undefined;
  if (bridged) draft.note("mcp-remote-bridge", { url: bridged });
  return { draft };
}

// ---------------------------------------------------------------------------
// pi mcp add: a port of the SDK's `parseOptions` / `parsePairs` / `add`
// (dist/extensions/mcp/cli.js), which are module-private and write the file.

type PiOptionKind = "flag" | "value" | "list";
const PI_ADD_OPTIONS: Record<string, PiOptionKind> = {
  local: "flag",
  url: "value",
  env: "list",
  cwd: "value",
  header: "list",
  "bearer-token-env-var": "value",
  "oauth-client-id": "value",
  "oauth-client-secret": "value",
  "oauth-callback-port": "value",
  exposure: "value",
};
const PI_OPTION_ALIASES = new Map([["-l", "--local"]]);
const PI_HTTP_ONLY = ["header", "bearer-token-env-var", "oauth-client-id", "oauth-client-secret", "oauth-callback-port"];
const PI_STDIO_ONLY = ["env", "cwd"];

function readPiMcpAdd(args: ShellWord[], mcpArgs: ShellWord[]): EntryOutcome | { error: McpImportNote } {
  // `pi mcp` prints its help for `--help` or `-h` anywhere, even after `--`.
  if (mcpArgs.some((word) => word.text === "--help" || word.text === "-h")) return { error: { code: "pi-help" } };
  const positional: ShellWord[] = [];
  const values = new Map<string, ShellWord | true>();
  const lists = new Map<string, ShellWord[]>();
  for (let index = 0; index < args.length; index++) {
    const arg = PI_OPTION_ALIASES.get(args[index].text) ?? args[index].text;
    if (arg === "--" || positional.length >= 2) {
      positional.push(...args.slice(arg === "--" ? index + 1 : index));
      break;
    }
    if (!arg.startsWith("--")) {
      positional.push(args[index]);
      continue;
    }
    const name = arg.slice(2);
    const kind = PI_ADD_OPTIONS[name];
    if (!kind) return { error: { code: "cli-unknown-option", params: { cli: "pi", option: arg } } };
    if (kind === "flag") {
      values.set(name, true);
      continue;
    }
    const value = args[++index];
    if (value === undefined) return { error: { code: "cli-option-needs-value", params: { cli: "pi", option: arg } } };
    if (kind === "list") lists.set(name, [...(lists.get(name) ?? []), value]);
    else values.set(name, value);
  }
  const [nameWord, ...command] = positional;
  const url = values.get("url");
  // pi checks `!name`, so an empty name (`pi mcp add "" …`) is a usage error too.
  if (!nameWord || nameWord.text === "" || (url === undefined) === (command.length === 0)) {
    return { error: { code: "cli-usage", params: { cli: "pi" } } };
  }
  const value = (option: string): ShellWord | undefined => {
    const found = values.get(option);
    return found === true ? undefined : found;
  };
  const misplaced = (url === undefined ? PI_HTTP_ONLY : PI_STDIO_ONLY).find((option) => values.has(option) || lists.has(option));
  if (misplaced) {
    return { error: { code: "cli-option-wrong-transport", params: { cli: "pi", option: `--${misplaced}`, transport: url === undefined ? "stdio" : "http" } } };
  }

  const draft = new ServerDraft("pi-mcp-add", true);
  draft.name = nameWord.text;
  draft.scopeHint = values.has("local") ? "project" : "global";
  const pairs = (option: string, separator = "="): [string, ShellWordPart[]][] | { error: McpImportNote } => {
    const result: [string, ShellWordPart[]][] = [];
    for (const word of lists.get(option) ?? []) {
      const split = splitWordParts(word.parts, separator);
      if (!split || split[0] === "") return { error: { code: "cli-invalid-pair", params: { cli: "pi", option: `--${option}`, value: word.text } } };
      // A repeated key keeps its first position and its last value, as in a JavaScript object.
      const existing = result.findIndex(([key]) => key === split[0]);
      if (existing >= 0) result[existing] = split;
      else result.push(split);
    }
    return result;
  };
  const config: Record<string, unknown> = {};
  if (url !== undefined && url !== true) {
    draft.transport = "http";
    draft.url = wordSegments(url.parts, "pi", false);
    const headers = pairs("header");
    if ("error" in headers) return headers;
    for (const [key, parts] of headers) draft.headers.push([key, wordSegments(parts, "pi", true)]);
    const bearer = value("bearer-token-env-var");
    if (bearer !== undefined) {
      const authorization: [string, Segment[]] = ["Authorization", [{ kind: "pi", text: `Bearer \${${bearer.text}}` }]];
      const at = draft.headers.findIndex(([key]) => key === "Authorization");
      if (at >= 0) draft.headers[at] = authorization;
      else draft.headers.push(authorization);
    }
    const clientId = value("oauth-client-id");
    const clientSecret = value("oauth-client-secret");
    const port = value("oauth-callback-port");
    if (clientId) draft.oauth.clientId = wordSegments(clientId.parts, "pi", false);
    if (clientSecret) draft.oauth.clientSecret = wordSegments(clientSecret.parts, "pi", true);
    if (port) draft.oauth.callbackPort = Number(port.text);
    // A variable the shell would have replaced becomes a field; validate the rest.
    config.url = url.parts.some((part) => part.type === "variable") ? "https://placeholder.invalid/" : url.text;
    if (port) config.oauth = { callbackPort: Number(port.text) };
  } else {
    draft.transport = "stdio";
    const env = pairs("env");
    if ("error" in env) return env;
    for (const [key, parts] of env) draft.env.push([key, wordSegments(parts, "pi", true)]);
    const [executable, ...commandArgs] = command;
    draft.command = wordSegments(executable.parts, "pi", false);
    draft.args = commandArgs.map((word) => wordSegments(word.parts, "pi", false));
    const cwd = value("cwd");
    if (cwd) draft.cwd = wordSegments(cwd.parts, "pi", false);
    config.command = executable.text;
  }
  const exposure = value("exposure");
  if (exposure !== undefined) {
    config.exposure = exposure.text;
    draft.exposure = exposure.text as ServerDraft["exposure"];
  }
  // pi validates before writing; the name is checked (and sanitized) by the importer like any other.
  const problem = validationProblem("server", config);
  if (problem) return { note: { code: "invalid-config", params: { server: nameWord.text, ...problem } } };
  return { draft };
}

// ---------------------------------------------------------------------------
// Options of the other CLIs

interface OptionSpec {
  name: string;
  /** `list` takes one value per flag and may repeat; `variadic` takes every following value it accepts. */
  kind: "flag" | "value" | "list" | "variadic";
}

interface ParsedOptions {
  positional: ShellWord[];
  afterDashDash: ShellWord[];
  values: Map<string, ShellWord | true>;
  lists: Map<string, ShellWord[]>;
  /** Options seen, as written, for notes. */
  seen: Map<string, string>;
}

/**
 * Options anywhere before `--` (commander, clap and yargs all allow that),
 * `--name=value` included; the words after `--` are returned separately.
 * `asArgAfter` positionals in, an unknown option is a server argument rather
 * than an error, which is what the user meant. `stopAfter` positionals in,
 * every remaining word is positional, as with pi's own `maxPositionals`.
 */
function parseCliOptions(
  cli: string,
  words: ShellWord[],
  specs: Record<string, OptionSpec>,
  options: { asArgAfter: number; stopAfter?: number; variadic?: (name: string, word: ShellWord) => boolean },
): ParsedOptions | { error: McpImportNote } {
  const parsed: ParsedOptions = { positional: [], afterDashDash: [], values: new Map(), lists: new Map(), seen: new Map() };
  for (let index = 0; index < words.length; index++) {
    const word = words[index];
    const text = word.text;
    if (text === "--") {
      parsed.afterDashDash.push(...words.slice(index + 1));
      break;
    }
    if (options.stopAfter !== undefined && parsed.positional.length >= options.stopAfter) {
      parsed.positional.push(...words.slice(index));
      break;
    }
    if (!text.startsWith("-") || text === "-") {
      parsed.positional.push(word);
      continue;
    }
    const equals = text.startsWith("--") ? text.indexOf("=") : -1;
    const flag = equals > 0 ? text.slice(0, equals) : text;
    const spec = specs[flag];
    if (!spec) {
      if (parsed.positional.length >= options.asArgAfter) {
        parsed.positional.push(word);
        parsed.seen.set(`as-arg:${flag}`, flag);
        continue;
      }
      return { error: { code: "cli-unknown-option", params: { cli, option: flag } } };
    }
    parsed.seen.set(spec.name, flag);
    if (spec.kind === "flag") {
      parsed.values.set(spec.name, true);
      continue;
    }
    const inline: ShellWord | undefined = equals > 0 ? inlineValue(word, equals + 1) : undefined;
    if (spec.kind === "value" || spec.kind === "list") {
      const value = inline ?? words[++index];
      if (value === undefined) return { error: { code: "cli-option-needs-value", params: { cli, option: flag } } };
      if (spec.kind === "value") parsed.values.set(spec.name, value);
      else parsed.lists.set(spec.name, [...(parsed.lists.get(spec.name) ?? []), value]);
      continue;
    }
    const collected: ShellWord[] = inline ? [inline] : [];
    if (!inline) {
      while (index + 1 < words.length && options.variadic!(spec.name, words[index + 1])) collected.push(words[++index]);
    }
    if (collected.length === 0) return { error: { code: "cli-option-needs-value", params: { cli, option: flag } } };
    parsed.lists.set(spec.name, [...(parsed.lists.get(spec.name) ?? []), ...collected]);
  }
  return parsed;
}

/** The value of `--name=value` as its own word, keeping the parts after the `=`. */
function inlineValue(word: ShellWord, offset: number): ShellWord {
  let skipped = 0;
  const parts: ShellWordPart[] = [];
  for (const part of word.parts) {
    const length = part.type === "text" ? part.value.length : part.raw.length;
    if (skipped >= offset) parts.push(part);
    else if (skipped + length > offset && part.type === "text") parts.push({ ...part, value: part.value.slice(offset - skipped) });
    skipped += length;
  }
  return { parts, text: word.text.slice(offset) };
}

const ENV_PAIR = /^[A-Za-z_][A-Za-z0-9_]*=/;
const HEADER_PAIR = /^[^\s:]+:/;

function isEnvPair(word: ShellWord): boolean {
  return ENV_PAIR.test(word.text);
}

function isHeaderPair(word: ShellWord): boolean {
  return HEADER_PAIR.test(word.text) && !/^[a-z][a-z0-9+.-]*:\/\//i.test(word.text);
}

function addEnvPairs(draft: ServerDraft, words: ShellWord[] | undefined, grammar: ValueGrammar, cli: string): McpImportNote | undefined {
  for (const word of words ?? []) {
    const split = splitWordParts(word.parts, "=");
    if (!split || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(split[0])) return { code: "cli-invalid-pair", params: { cli, option: "--env", value: word.text } };
    draft.env.push([split[0], wordSegments(split[1], grammar, true)]);
  }
  return undefined;
}

function addHeaderPairs(draft: ServerDraft, words: ShellWord[] | undefined, grammar: ValueGrammar, cli: string): McpImportNote | undefined {
  for (const word of words ?? []) {
    const split = splitWordParts(word.parts, ":");
    const key = split?.[0].trim();
    if (!split || !key) return { code: "cli-invalid-pair", params: { cli, option: "--header", value: word.text } };
    const parts = trimParts(split[1]);
    if (key.toLowerCase() === "authorization" && parts.every((part) => part.type === "text" && part.value === "")) {
      draft.note("empty-authorization-dropped");
      continue;
    }
    draft.headers.push([key, wordSegments(parts, grammar, true)]);
  }
  return undefined;
}

function scopeHint(value: ShellWord | true | undefined): "global" | "project" | undefined {
  if (value === undefined || value === true) return undefined;
  if (value.text === "user") return "global";
  if (value.text === "project") return "project";
  return undefined;
}

function noteArgOptions(draft: ServerDraft, parsed: ParsedOptions, cli: string): void {
  for (const [key, option] of parsed.seen) {
    if (key.startsWith("as-arg:")) draft.note("cli-option-as-arg", { cli, option });
  }
}

/** `claude mcp add` / `gemini mcp add`: `<name> <commandOrUrl> [args...]` after the options. */
function remoteOrLocal(
  draft: ServerDraft,
  cli: string,
  transportWord: ShellWord | true | undefined,
  positional: ShellWord[],
  grammar: ValueGrammar,
): McpImportNote | "http" | "stdio" {
  const [nameWord, target, ...args] = positional;
  if (!nameWord || !target) return { code: "cli-usage", params: { cli } };
  draft.name = nameWord.text;
  const explicit = transportWord === undefined || transportWord === true ? undefined : transportWord.text.toLowerCase();
  let transport: string;
  if (explicit === undefined) {
    transport = URL_WORD.test(target.text) ? "http" : WS_WORD.test(target.text) ? "ws" : "stdio";
    // A guessed transport for a legacy `/sse` address is refused like a pasted URL, with `/mcp` offered.
    if (transport === "http" && siblingMcpUrl(target.text) !== undefined) return sseRefusal(nameWord.text, target.text);
    if (transport === "http" && cli === "gemini") draft.note("transport-assumed-http");
  } else {
    transport = explicit === "streamable-http" ? "http" : explicit;
  }
  if (transport === "sse") return sseRefusal(nameWord.text, target.text);
  if (transport === "ws") return { code: "websocket-transport", params: { server: nameWord.text, url: target.text } };
  if (transport === "http") {
    draft.transport = "http";
    draft.url = wordSegments(target.parts, grammar, false);
    if (args.length > 0) draft.note("cli-extra-arguments", { cli, arguments: args.map((word) => word.text).join(" ") });
    return "http";
  }
  if (transport !== "stdio") return { code: "unsupported-transport", params: { server: nameWord.text, type: transport } };
  draft.transport = "stdio";
  draft.command = wordSegments(target.parts, grammar, false);
  draft.args = args.map((word) => wordSegments(word.parts, grammar, false));
  return "stdio";
}

// ---------------------------------------------------------------------------
// claude mcp add [options] <name> <commandOrUrl> [args...]

const CLAUDE_OPTIONS: Record<string, OptionSpec> = {
  "-t": { name: "transport", kind: "value" },
  "--transport": { name: "transport", kind: "value" },
  "-e": { name: "env", kind: "variadic" },
  "--env": { name: "env", kind: "variadic" },
  "-H": { name: "header", kind: "variadic" },
  "--header": { name: "header", kind: "variadic" },
  "-s": { name: "scope", kind: "value" },
  "--scope": { name: "scope", kind: "value" },
  "--client-id": { name: "client-id", kind: "value" },
  "--client-secret": { name: "client-secret", kind: "flag" },
  "--callback-port": { name: "callback-port", kind: "value" },
  "--no-browser": { name: "no-browser", kind: "flag" },
};

/**
 * Claude's `-e` and `-H` take several values. Its own parser keeps reading
 * them into the server name (anthropics/claude-code#23365); this one stops at
 * a word that is not `KEY=value` (or `Name: value`, and not a URL).
 */
function claudeVariadic(name: string, word: ShellWord): boolean {
  return name === "env" ? isEnvPair(word) : isHeaderPair(word);
}

function readClaudeMcpAdd(words: ShellWord[]): EntryOutcome | { error: McpImportNote } {
  const parsed = parseCliOptions("claude", words, CLAUDE_OPTIONS, { asArgAfter: 2, variadic: claudeVariadic });
  if ("error" in parsed) return { error: parsed.error };
  const draft = new ServerDraft("claude-mcp-add", false);
  const transport = remoteOrLocal(draft, "claude", parsed.values.get("transport"), [...parsed.positional, ...parsed.afterDashDash], UNION_GRAMMAR);
  if (typeof transport !== "string") return transport.code === "cli-usage" ? { error: transport } : { note: transport };
  noteArgOptions(draft, parsed, "claude");
  draft.scopeHint = scopeHint(parsed.values.get("scope"));
  if (transport === "http") {
    if (parsed.lists.has("env")) draft.note("cli-option-wrong-transport", { cli: "claude", option: "--env", transport: "http" });
    const problem = addHeaderPairs(draft, parsed.lists.get("header"), UNION_GRAMMAR, "claude");
    if (problem) return { error: problem };
    const clientId = parsed.values.get("client-id");
    if (clientId && clientId !== true) draft.oauth.clientId = wordSegments(clientId.parts, UNION_GRAMMAR, false);
    if (parsed.values.has("client-secret")) addClientSecretPrompt(draft);
    const port = parsed.values.get("callback-port");
    if (port && port !== true) setCallbackPort(draft, port.text);
  } else {
    for (const option of ["header", "client-id", "client-secret", "callback-port"]) {
      if (parsed.lists.has(option) || parsed.values.has(option)) {
        draft.note("cli-option-wrong-transport", { cli: "claude", option: parsed.seen.get(option) ?? `--${option}`, transport: "stdio" });
      }
    }
    const problem = addEnvPairs(draft, parsed.lists.get("env"), UNION_GRAMMAR, "claude");
    if (problem) return { error: problem };
  }
  return { draft };
}

/** Claude's `--client-secret` asks for the secret instead of taking it on the command line. */
function addClientSecretPrompt(draft: ServerDraft): void {
  draft.oauth.clientSecret = [{ kind: "prompt", id: "oauth.clientSecret", reason: "client-secret", label: "clientSecret", from: "", secret: true }];
  draft.note("client-secret-prompt");
}

function setCallbackPort(draft: ServerDraft, text: string): void {
  const port = Number(text);
  if (Number.isInteger(port) && port >= 1 && port <= 65535) draft.oauth.callbackPort = port;
  else draft.note("callback-port-dropped", { value: text });
}

// claude mcp add-json <name> '<json>' [--scope <scope>] [--client-secret]
const CLAUDE_ADD_JSON_OPTIONS: Record<string, OptionSpec> = {
  "-s": { name: "scope", kind: "value" },
  "--scope": { name: "scope", kind: "value" },
  "--client-secret": { name: "client-secret", kind: "flag" },
};

function readClaudeMcpAddJson(words: ShellWord[]): EntryOutcome | { error: McpImportNote } {
  const parsed = parseCliOptions("claude", words, CLAUDE_ADD_JSON_OPTIONS, { asArgAfter: Number.POSITIVE_INFINITY });
  if ("error" in parsed) return { error: parsed.error };
  const [nameWord, jsonWord, ...extra] = [...parsed.positional, ...parsed.afterDashDash];
  if (!nameWord || !jsonWord || extra.length > 0) return { error: { code: "cli-usage", params: { cli: "claude" } } };
  const json = parseJsonWord(jsonWord);
  if ("error" in json) return json;
  const outcome = mapServerEntry(nameWord.text, json.value, { source: "claude-mcp-add-json", flavor: "mcp-servers", rawPi: false });
  if ("note" in outcome) return outcome;
  outcome.draft.scopeHint = scopeHint(parsed.values.get("scope"));
  if (parsed.values.has("client-secret") && outcome.draft.transport === "http" && !outcome.draft.oauth.clientSecret) {
    addClientSecretPrompt(outcome.draft);
  }
  return outcome;
}

function parseJsonWord(word: ShellWord): { value: Record<string, unknown> } | { error: McpImportNote } {
  const text = literalWord(word) ?? word.text;
  let value: unknown;
  try {
    value = parseJsonc(text);
  } catch (error) {
    return { error: { code: "invalid-json", params: { detail: error instanceof Error ? error.message : String(error) } } };
  }
  if (!isRecord(value)) return { error: { code: "no-servers-found" } };
  return { value };
}

// ---------------------------------------------------------------------------
// codex mcp add [OPTIONS] <NAME> (--url <URL> | -- <COMMAND>...)

const CODEX_OPTIONS: Record<string, OptionSpec> = {
  "--env": { name: "env", kind: "list" },
  "--url": { name: "url", kind: "value" },
  "--bearer-token-env-var": { name: "bearer-token-env-var", kind: "value" },
  "--oauth-client-id": { name: "oauth-client-id", kind: "value" },
  "--oauth-resource": { name: "oauth-resource", kind: "value" },
  "-c": { name: "config", kind: "value" },
  "--config": { name: "config", kind: "value" },
  "--enable": { name: "enable", kind: "value" },
  "--disable": { name: "disable", kind: "value" },
};

function readCodexMcpAdd(words: ShellWord[]): EntryOutcome | { error: McpImportNote } {
  const parsed = parseCliOptions("codex", words, CODEX_OPTIONS, { asArgAfter: Number.POSITIVE_INFINITY, stopAfter: 2 });
  if ("error" in parsed) return { error: parsed.error };
  const dashDash = parsed.afterDashDash;
  const envWords = parsed.lists.get("env") ?? [];
  const [nameWord, ...extra] = parsed.positional;
  // `--` is required before the command; a command right after the name is read the same way.
  const command = dashDash.length > 0 ? dashDash : extra;
  const url = parsed.values.get("url");
  if (!nameWord || (url === undefined) === (command.length === 0) || (dashDash.length > 0 && extra.length > 0)) {
    return { error: { code: "cli-usage", params: { cli: "codex" } } };
  }
  const draft = new ServerDraft("codex-mcp-add", false);
  draft.name = nameWord.text;
  for (const option of ["config", "enable", "disable"]) {
    if (parsed.values.has(option)) draft.note("cli-option-ignored", { cli: "codex", option: parsed.seen.get(option)! });
  }
  if (parsed.values.has("oauth-resource")) draft.note("oauth-option-dropped", { key: "--oauth-resource" });
  if (url !== undefined && url !== true) {
    if (envWords.length > 0) {
      return { error: { code: "cli-option-wrong-transport", params: { cli: "codex", option: "--env", transport: "http" } } };
    }
    // Codex speaks streamable HTTP only; a legacy `/sse` address is refused with `/mcp` offered.
    if (siblingMcpUrl(url.text) !== undefined) return { note: sseRefusal(nameWord.text, url.text) };
    draft.transport = "http";
    draft.url = wordSegments(url.parts, LITERAL_GRAMMAR, false);
    const bearer = parsed.values.get("bearer-token-env-var");
    if (bearer && bearer !== true) {
      draft.headers.push(["Authorization", [{ kind: "text", text: "Bearer " }, { kind: "env", name: bearer.text, from: `\${${bearer.text}}` }]]);
    }
    const clientId = parsed.values.get("oauth-client-id");
    if (clientId && clientId !== true) draft.oauth.clientId = wordSegments(clientId.parts, LITERAL_GRAMMAR, false);
  } else {
    for (const option of ["bearer-token-env-var", "oauth-client-id", "oauth-resource"]) {
      if (parsed.values.has(option)) {
        return { error: { code: "cli-option-wrong-transport", params: { cli: "codex", option: `--${option}`, transport: "stdio" } } };
      }
    }
    draft.transport = "stdio";
    const problem = addEnvPairs(draft, envWords, LITERAL_GRAMMAR, "codex");
    if (problem) return { error: problem };
    draft.command = wordSegments(command[0].parts, LITERAL_GRAMMAR, false);
    draft.args = command.slice(1).map((word) => wordSegments(word.parts, LITERAL_GRAMMAR, false));
  }
  return { draft };
}

// ---------------------------------------------------------------------------
// gemini mcp add [options] <name> <commandOrUrl> [args...]

const GEMINI_OPTIONS: Record<string, OptionSpec> = {
  "-s": { name: "scope", kind: "value" },
  "--scope": { name: "scope", kind: "value" },
  "-t": { name: "transport", kind: "value" },
  "--transport": { name: "transport", kind: "value" },
  "--type": { name: "transport", kind: "value" },
  "-e": { name: "env", kind: "list" },
  "--env": { name: "env", kind: "list" },
  "-H": { name: "header", kind: "list" },
  "--header": { name: "header", kind: "list" },
  "--timeout": { name: "timeout", kind: "value" },
  "--trust": { name: "trust", kind: "flag" },
  "--description": { name: "description", kind: "value" },
  "--include-tools": { name: "include-tools", kind: "value" },
  "--includeTools": { name: "include-tools", kind: "value" },
  "--exclude-tools": { name: "exclude-tools", kind: "value" },
  "--excludeTools": { name: "exclude-tools", kind: "value" },
};

function readGeminiMcpAdd(words: ShellWord[]): EntryOutcome | { error: McpImportNote } {
  // yargs gives `-e` and `-H` one value each (`nargs: 1`); repeating the flag adds more.
  const parsed = parseCliOptions("gemini", words, GEMINI_OPTIONS, { asArgAfter: 2 });
  if ("error" in parsed) return { error: parsed.error };
  const draft = new ServerDraft("gemini-mcp-add", false);
  const transport = remoteOrLocal(draft, "gemini", parsed.values.get("transport"), [...parsed.positional, ...parsed.afterDashDash], GEMINI_GRAMMAR);
  if (typeof transport !== "string") return transport.code === "cli-usage" ? { error: transport } : { note: transport };
  draft.scopeHint = scopeHint(parsed.values.get("scope"));
  if (transport === "http") {
    if (parsed.lists.has("env")) draft.note("cli-option-wrong-transport", { cli: "gemini", option: "--env", transport: "http" });
    const problem = addHeaderPairs(draft, parsed.lists.get("header"), GEMINI_GRAMMAR, "gemini");
    if (problem) return { error: problem };
  } else {
    if (parsed.lists.has("header")) draft.note("cli-option-wrong-transport", { cli: "gemini", option: "--header", transport: "stdio" });
    const problem = addEnvPairs(draft, parsed.lists.get("env"), GEMINI_GRAMMAR, "gemini");
    if (problem) return { error: problem };
  }
  const timeout = parsed.values.get("timeout");
  if (timeout && timeout !== true) timeoutFromMilliseconds(draft, Number(timeout.text));
  for (const option of ["trust", "description"]) {
    if (parsed.values.has(option)) draft.note("cli-option-ignored", { cli: "gemini", option: `--${option}` });
  }
  const csv = (name: string) => {
    const word = parsed.values.get(name);
    return word && word !== true ? word.text.split(",").map((tool) => tool.trim()).filter(Boolean) : undefined;
  };
  mapToolFilters(draft, csv("include-tools"), csv("exclude-tools"));
  return { draft };
}

// ---------------------------------------------------------------------------
// code --add-mcp '{"name": …}' (VS Code's command line)

function readCodeAddMcp(words: ShellWord[]): CommandLineServers {
  const entries: EntryOutcome[] = [];
  for (let index = 0; index < words.length; index++) {
    const text = words[index].text;
    let jsonWord: ShellWord | undefined;
    if (text === "--add-mcp") jsonWord = words[++index];
    else if (text.startsWith("--add-mcp=")) jsonWord = inlineValue(words[index], "--add-mcp=".length);
    else continue;
    if (!jsonWord) return { error: { code: "cli-option-needs-value", params: { cli: "code", option: "--add-mcp" } } };
    const json = parseJsonWord(jsonWord);
    if ("error" in json) return json;
    entries.push(mapServerEntry(undefined, json.value, { source: "vscode-add-mcp", flavor: "vscode", rawPi: false }));
  }
  return { entries, notes: [] };
}

