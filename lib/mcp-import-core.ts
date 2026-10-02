import type { McpExposure, McpServerConfig } from "@earendil-works/pi-coding-agent";
import { isSecretName, maskArgs, maskUrl, SECRET_MASK } from "./mcp-secrets";

// Shared parts of the paste importer (`lib/mcp-import.ts`): the result types,
// how a value written for another client becomes a pi value, the draft every
// format fills in, server names, and a port of the SDK's validator. Pure, so
// it runs in the browser preview and in the server's re-parse alike.

/** Where a pasted server came from. */
export type McpImportFormat =
  | "url"
  | "command-line"
  | "pi-mcp-add"
  | "claude-mcp-add"
  | "claude-mcp-add-json"
  | "codex-mcp-add"
  | "gemini-mcp-add"
  | "vscode-add-mcp"
  | "mcp-servers-json"
  | "vscode-json"
  | "zed-json"
  | "opencode-json"
  | "server-object"
  | "server-map"
  | "registry-server-json"
  | "cursor-install-link"
  | "vscode-install-link"
  | "visual-studio-install-link"
  | "copilot-app-install-link";

/**
 * Every note the importer writes, with how much it matters. Notes carry a code
 * and parameters, never a sentence; the panel renders them through i18n.
 */
export const MCP_IMPORT_NOTE_SEVERITY = {
  // The paste as a whole could not be imported.
  "empty-input": "error",
  "unrecognized-input": "error",
  "invalid-json": "error",
  "no-servers-found": "error",
  "shell-operator": "error",
  "shell-command-substitution": "error",
  "shell-multiple-commands": "error",
  "shell-unterminated-quote": "error",
  "shell-parameter": "error",
  "shell-expansion": "error",
  "unsupported-url-scheme": "error",
  "github-repo-link": "error",
  "github-mcp-page": "error",
  "github-page": "error",
  "by-name-link": "error",
  "badge-image": "error",
  "install-link-invalid": "error",
  "claude-desktop-import": "error",
  "cli-unsupported": "error",
  "cli-usage": "error",
  "cli-unknown-option": "error",
  "cli-option-needs-value": "error",
  "cli-option-wrong-transport": "error",
  "cli-invalid-pair": "error",
  "cli-not-a-server": "error",
  "pi-help": "error",
  // A value left to fill in (`fillMcpImportFields`).
  "field-required": "error",
  "field-invalid-option": "error",
  "field-reference-invalid": "error",
  // One server could not be imported (top-level notes name it with `server`).
  "sse-transport": "error",
  "websocket-transport": "error",
  "unsupported-transport": "error",
  "ambiguous-command-and-url": "error",
  "no-command-or-url": "error",
  "zed-extension-server": "error",
  "registry-packages-unsupported": "error",
  "invalid-config": "error",
  // The server was imported, with something to check.
  "dropped-key": "warning",
  "variable-unsupported-here": "warning",
  "variable-fallback-dropped": "warning",
  "bare-dollar-literal": "warning",
  "header-env-reference": "warning",
  "client-secret-env-reference": "warning",
  "shell-command-value": "warning",
  "shell-variable": "warning",
  "unsupported-variable": "warning",
  "input-undefined": "warning",
  "input-command-unsupported": "warning",
  "timeout-clamped": "warning",
  "timeout-dropped": "warning",
  "timeout-unit-guessed": "warning",
  "env-null-dropped": "warning",
  "oauth-option-dropped": "warning",
  "oauth-disable-unsupported": "warning",
  "callback-url-dropped": "warning",
  "callback-port-dropped": "warning",
  "invalid-exposure-dropped": "warning",
  "tool-filter-imported": "warning",
  "transport-guessed": "warning",
  "insecure-http": "warning",
  "literal-secret": "warning",
  "cli-option-ignored": "warning",
  "cli-option-as-arg": "warning",
  "cli-extra-arguments": "warning",
  "mcp-remote-bridge": "warning",
  "looks-like-pi-config": "warning",
  "workspace-folder-relative": "warning",
  "home-variable-translated": "warning",
  "name-taken": "warning",
  // Informational: what the importer changed so pi reads the same thing.
  "escaped-value": "info",
  "variable-translated": "info",
  "home-translated": "info",
  "timeout-converted": "info",
  "env-value-stringified": "info",
  "empty-authorization-dropped": "info",
  "imported-disabled": "info",
  "name-derived": "info",
  "name-sanitized": "info",
  "name-deduplicated": "info",
  "command-split": "info",
  "transport-assumed-http": "info",
  "scheme-assumed": "info",
  "client-secret-prompt": "info",
  "userinfo-moved-to-header": "info",
} as const;

export type McpImportNoteCode = keyof typeof MCP_IMPORT_NOTE_SEVERITY;
export type McpImportNoteSeverity = (typeof MCP_IMPORT_NOTE_SEVERITY)[McpImportNoteCode];
export const MCP_IMPORT_NOTE_CODES = Object.keys(MCP_IMPORT_NOTE_SEVERITY) as McpImportNoteCode[];

export interface McpImportNote {
  code: McpImportNoteCode;
  params?: Record<string, string | number>;
}

/** A config value a field fills in. */
export type McpImportPath =
  | ["command"]
  | ["args", number]
  | ["cwd"]
  | ["url"]
  | ["env", string]
  | ["headers", string]
  | ["oauth", "clientId" | "clientSecret" | "clientName" | "callbackUrl" | "scope" | "authServerMetadataUrl"];

/** One config value built from fixed text and fields. */
export interface McpImportTarget {
  path: McpImportPath;
  /** Strings are final (already escaped where pi resolves the value); `{ field }` is a field's value. */
  parts: (string | { field: string })[];
  /** Encode field values with `encodeURIComponent` (a placeholder inside a URL's query or path). */
  encoding?: "uri-component";
}

export type McpImportFieldReason =
  | "placeholder"
  | "placeholder-path"
  | "empty"
  | "input"
  | "variable"
  | "home"
  | "workspace-basename"
  | "unsupported-variable"
  | "client-secret"
  | "registry-header"
  | "registry-variable";

/** A value the paste did not supply and the user has to type. */
export interface McpImportField {
  /** Unique within the server; `fillMcpImportFields` takes values keyed by it. */
  id: string;
  kind: "password" | "text" | "select";
  reason: McpImportFieldReason;
  /** What the value is called where it comes from: an env or header name, a variable, an input id. */
  label: string;
  /** Text the source itself gives (a VS Code input or a registry header description), shown as is. */
  description?: string;
  /** The placeholder text found in the paste (`YOUR_GITHUB_PAT`, `${input:token}`). */
  placeholder?: string;
  defaultValue?: string;
  options?: string[];
  /** Left blank, the value it belongs to is removed (an `Authorization` header: pi then signs in with OAuth). */
  optional?: boolean;
  targets: McpImportTarget[];
}

export interface McpImportServer {
  /** Sanitized to `[A-Za-z0-9_-]` and unique within the paste. */
  name: string;
  /** The name as the source spelled it, when sanitizing changed it (a registry's full name, `My Server!`). */
  originalName?: string;
  /** A fresh pi config built from known keys only; fields still hold their placeholder text. */
  config: McpServerConfig;
  fields: McpImportField[];
  notes: McpImportNote[];
  source: McpImportFormat;
  /** True when values were taken as pi syntax (`pi mcp add`, or the "this is a pi config" toggle). */
  rawPi: boolean;
  /** The scope the source asked for (`pi mcp add -l`, `--scope user|project`); the panel decides. */
  scopeHint?: "global" | "project";
}

export type McpImportResult =
  | { ok: true; servers: McpImportServer[]; notes: McpImportNote[] }
  | { ok: false; notes: McpImportNote[] };

export interface McpImportOptions {
  /** Treat JSON values as pi syntax: keep `${VAR}`, `$$` and `!command` as written. */
  rawPi?: boolean;
  /** Names already in use, so derived names avoid them. */
  takenNames?: Iterable<string>;
}

// ---------------------------------------------------------------------------
// Values

/** Which references a source client replaces in its values. */
export interface ValueGrammar {
  /** `${NAME}`, `${NAME:-x}`, `${env:NAME}`, `${input:id}`, `${userHome}`, `${workspaceFolder}`… */
  dollarBrace: boolean;
  /** `$NAME` (Gemini). */
  bareDollar: boolean;
  /** `%NAME%` (Gemini on Windows), read only in values pi resolves. */
  percent: boolean;
  /** `{env:NAME}` and `{file:path}` (opencode). */
  braceEnv: boolean;
}

export const LITERAL_GRAMMAR: ValueGrammar = { dollarBrace: false, bareDollar: false, percent: false, braceEnv: false };
export const UNION_GRAMMAR: ValueGrammar = { dollarBrace: true, bareDollar: false, percent: true, braceEnv: true };
export const GEMINI_GRAMMAR: ValueGrammar = { ...UNION_GRAMMAR, bareDollar: true };
export const OPENCODE_GRAMMAR: ValueGrammar = { ...LITERAL_GRAMMAR, braceEnv: true };

/** A piece of a value as the source meant it. */
export type Segment =
  | { kind: "text"; text: string }
  /** Already pi syntax, kept as written. */
  | { kind: "pi"; text: string }
  | { kind: "env"; name: string; from: string; fallback?: string; shell?: boolean }
  | { kind: "input"; id: string; from: string }
  | { kind: "home"; from: string }
  | { kind: "workspace"; from: string }
  | { kind: "workspace-basename"; from: string }
  | { kind: "unsupported"; from: string }
  /** A value the source asks the user for: `--client-secret`, a registry header or URL variable. */
  | {
    kind: "prompt";
    id: string;
    reason: McpImportFieldReason;
    label: string;
    from: string;
    secret: boolean;
    description?: string;
    defaultValue?: string;
    optional?: boolean;
    options?: string[];
  };

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const VALUE_TOKEN = /\$\{([^{}]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)|%([A-Za-z_][A-Za-z0-9_]*)%|\{(env|file):([^{}]*)\}/g;

function pushText(segments: Segment[], text: string): void {
  if (!text) return;
  const last = segments[segments.length - 1];
  if (last?.kind === "text") last.text += text;
  else segments.push({ kind: "text", text });
}

function dollarBraceSegment(body: string, from: string): Segment | string {
  const env = /^env:([A-Za-z_][A-Za-z0-9_]*)$/.exec(body);
  if (env) return { kind: "env", name: env[1], from };
  const input = /^input:(.+)$/.exec(body);
  if (input) return { kind: "input", id: input[1], from };
  if (body === "userHome") return { kind: "home", from };
  if (body === "workspaceFolder" || body === "workspaceRoot" || body === "CLAUDE_PROJECT_DIR") {
    return { kind: "workspace", from };
  }
  if (body === "workspaceFolderBasename") return { kind: "workspace-basename", from };
  if (body === "pathSeparator" || body === "/") return "/";
  if (body === "CLAUDE_PLUGIN_ROOT" || body === "CLAUDE_PLUGIN_DATA") return { kind: "unsupported", from };
  if (ENV_NAME.test(body)) return { kind: "env", name: body, from };
  const fallback = /^([A-Za-z_][A-Za-z0-9_]*):?-([\s\S]*)$/.exec(body);
  if (fallback) return { kind: "env", name: fallback[1], from, fallback: fallback[2] };
  // `${command:…}`, `${config:…}` and the like are VS Code variables pi has no equivalent for.
  if (/^[A-Za-z]+:/.test(body)) return { kind: "unsupported", from };
  return from;
}

/** Splits a source value into literal text and the references the source would replace. */
export function parseValue(value: string, grammar: ValueGrammar, resolved: boolean): Segment[] {
  const segments: Segment[] = [];
  let last = 0;
  VALUE_TOKEN.lastIndex = 0;
  for (let match = VALUE_TOKEN.exec(value); match; match = VALUE_TOKEN.exec(value)) {
    const [from, braceBody, bareName, percentName, braceKind, braceArg] = match;
    let segment: Segment | string = from;
    if (braceBody !== undefined && grammar.dollarBrace) {
      segment = dollarBraceSegment(braceBody, from);
    } else if (bareName !== undefined && grammar.bareDollar) {
      segment = { kind: "env", name: bareName, from };
    } else if (percentName !== undefined && grammar.percent && resolved) {
      segment = { kind: "env", name: percentName, from };
    } else if (braceKind !== undefined && grammar.braceEnv) {
      segment = braceKind === "env" && ENV_NAME.test(braceArg)
        ? { kind: "env", name: braceArg, from }
        : { kind: "unsupported", from };
    } else if (percentName !== undefined || braceKind !== undefined) {
      // Not a reference in this grammar; a `$NAME` inside it may still be one.
      pushText(segments, value.slice(last, match.index + 1));
      last = match.index + 1;
      VALUE_TOKEN.lastIndex = match.index + 1;
      continue;
    }
    pushText(segments, value.slice(last, match.index));
    if (typeof segment === "string") pushText(segments, segment);
    else segments.push(segment);
    last = match.index + from.length;
  }
  pushText(segments, value.slice(last));
  return segments;
}

/**
 * Literal text as pi stores it in a value it resolves: `$` doubled, a leading
 * `!` escaped as `$!`. `atStart: false` for text that follows other parts of
 * the value (a field after a prefix), where a `!` is no command. The one rule
 * every encoder of the importer goes through, so the SDK round-trip test of it
 * sweeps what is written.
 */
export function escapeConfigValue(value: string, { atStart = true }: { atStart?: boolean } = {}): string {
  const doubled = value.replace(/\$/g, "$$$$");
  return atStart && doubled.startsWith("!") ? `$${doubled}` : doubled;
}

/** Whether pi runs this resolved value as a shell command (SDK `isCommandConfigValue`). */
export function isCommandConfigValue(value: string): boolean {
  return value.startsWith("!");
}

/**
 * The environment variables a resolved value reads, as the SDK's
 * `getConfigValueEnvVarNames` finds them: `${NAME}` and `$NAME`, skipping the
 * `$$` and `$!` escapes. A `!command` reads none it declares.
 */
export function configValueEnvVarNames(value: string): string[] {
  if (isCommandConfigValue(value)) return [];
  const names: string[] = [];
  for (let index = 0; index < value.length; index++) {
    if (value[index] !== "$") continue;
    const next = value[index + 1];
    if (next === "$" || next === "!") {
      index++;
      continue;
    }
    if (next === "{") {
      const end = value.indexOf("}", index + 2);
      if (end < 0) continue;
      const name = value.slice(index + 2, end);
      if (ENV_NAME.test(name) && !names.includes(name)) names.push(name);
      index = end;
      continue;
    }
    const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(value.slice(index + 1));
    if (match) {
      if (!names.includes(match[0])) names.push(match[0]);
      index += match[0].length;
    }
  }
  return names;
}

/** A trailing `$` pi reads as a literal dollar sign, sealed so text appended after it cannot start a reference. */
function sealPiText(text: string): string {
  const run = /\$+$/.exec(text)?.[0].length ?? 0;
  return run % 2 === 1 ? `${text}$` : text;
}

// ---------------------------------------------------------------------------
// Placeholders

// The `…_here` alternative bounds its run (`{0,80}`): unbounded, a long `a-a-a-…` took quadratic time to refuse.
const PLACEHOLDER_TOKEN =
  /<[A-Za-z][^<>\n]{0,80}>|\{\{\s*[A-Za-z_][\w.-]*\s*\}\}|\b[Yy][Oo][Uu][Rr][_-][A-Za-z0-9_.-]*[A-Za-z0-9]|\b[A-Za-z0-9_-]{0,80}[A-Za-z0-9][_-](?:HERE|[Hh]ere)\b|\b(?:REPLACE[_-]?ME|CHANGE[_-]?ME|PLACEHOLDER)\b|\bMY_[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PAT)\b|\b(?:sk|pk|ghp|gho|github_pat|glpat|xoxb|xoxp)[_-][xX*]{4,}\b|\b[xX]{6,}\b/g;
const WHOLE_PLACEHOLDER = /^(?:\.\.\.|…|\*{3,}|x{3,}|TODO|FIXME|changeme|change[-_]me|replace[-_]?me|placeholder|redacted|\[[^\]]+\])$/i;
const PLACEHOLDER_PATH =
  /(?:^|[\\/])(?:path[\\/]to(?:[\\/]|$)|Users[\\/](?:username|yourname|your[-_][A-Za-z_-]+|user[-_]?name|<[^>]+>)(?:[\\/]|$)|home[\\/](?:username|yourname|your[-_][A-Za-z_-]+|<[^>]+>)(?:[\\/]|$))/i;
const AUTH_SCHEME = /^(Bearer|Basic|Token|Bot|ApiKey|Api-Key)\s+(.+)$/i;

/** Spans of placeholder text inside a literal: `YOUR_TOKEN`, `<api-key>`, `{{KEY}}`, `api_key_here`… */
export function placeholderSpans(text: string): [start: number, end: number][] {
  const trimmed = text.trim();
  if (WHOLE_PLACEHOLDER.test(trimmed)) {
    const start = text.indexOf(trimmed);
    return [[start, start + trimmed.length]];
  }
  const scheme = AUTH_SCHEME.exec(trimmed);
  if (scheme && WHOLE_PLACEHOLDER.test(scheme[2].trim())) {
    const start = text.lastIndexOf(scheme[2].trim());
    return [[start, start + scheme[2].trim().length]];
  }
  const spans: [number, number][] = [];
  PLACEHOLDER_TOKEN.lastIndex = 0;
  for (let match = PLACEHOLDER_TOKEN.exec(text); match; match = PLACEHOLDER_TOKEN.exec(text)) {
    // `@scope/your-thing` names a package; only an upper-case `YOUR_…` is a placeholder there.
    if (/^your[-_]/.test(match[0]) && /[@/]/.test(text[match.index - 1] ?? "")) continue;
    spans.push([match.index, match.index + match[0].length]);
  }
  return spans;
}

/** Example paths from someone else's machine: `/Users/username/…`, `/path/to/…`, `C:\Users\<you>\…`. */
export function isPlaceholderPath(value: string): boolean {
  return PLACEHOLDER_PATH.test(value);
}

// ---------------------------------------------------------------------------
// Paths

export function pathKey(path: McpImportPath): string {
  return path.join("\u0000");
}

/** `env.API_KEY`, `headers.Authorization`, `args[2]`, `oauth.clientSecret`: a technical label, not prose. */
export function pathLabel(path: McpImportPath): string {
  if (path[0] === "args") return `args[${path[1]}]`;
  return path.join(".");
}

/** Values the SDK resolves (`${NAME}`, `$NAME`, `!command`, `$$`, `$!`); everything else is used raw. */
export function isResolvedPath(path: McpImportPath): boolean {
  return path[0] === "env" || path[0] === "headers" || (path[0] === "oauth" && path[1] === "clientSecret");
}

/** Values in which pi expands a leading `~` to the home directory. */
function expandsHome(path: McpImportPath): boolean {
  return path[0] === "command" || path[0] === "args" || path[0] === "cwd";
}

const HOME_VARIABLES = new Set(["HOME", "USERPROFILE"]);

// ---------------------------------------------------------------------------
// Draft

export interface DraftOAuth {
  clientId?: Segment[];
  clientSecret?: Segment[];
  callbackPort?: number;
  clientName?: Segment[];
  callbackUrl?: Segment[];
  scope?: Segment[];
  authServerMetadataUrl?: Segment[];
}

export interface VsCodeInput {
  id: string;
  type?: string;
  description?: string;
  password?: boolean;
  default?: string;
  options?: string[];
}

/**
 * One server as a format reads it. Formats fill it with source segments;
 * `finishDraft()` encodes them into a pi config, the fields the user still has
 * to fill in, and notes.
 */
export class ServerDraft {
  name: string | undefined;
  originalName: string | undefined;
  scopeHint: "global" | "project" | undefined;
  transport: "stdio" | "http" | undefined;
  command: Segment[] | undefined;
  args: Segment[][] = [];
  env: [string, Segment[]][] = [];
  cwd: Segment[] | undefined;
  url: Segment[] | undefined;
  headers: [string, Segment[]][] = [];
  oauth: DraftOAuth = {};
  exposure: McpExposure | undefined;
  toolExposure: Record<string, McpExposure> | undefined;
  enabled: false | undefined;
  timeout: number | undefined;
  /** pi's `description`, as written: pi resolves nothing in it. Read only from pi syntax, which the user writes. */
  description: string | undefined;
  /** Input definitions of a VS Code config, by id. */
  inputs: Map<string, VsCodeInput> | undefined;
  readonly notes: McpImportNote[] = [];

  constructor(
    readonly source: McpImportFormat,
    readonly rawPi: boolean,
  ) {}

  /** Adds a note once. */
  note(code: McpImportNoteCode, params?: Record<string, string | number>): void {
    const key = JSON.stringify([code, params ?? {}]);
    if (this.notes.some((note) => JSON.stringify([note.code, note.params ?? {}]) === key)) return;
    this.notes.push(params ? { code, params } : { code });
  }
}

/** Text as one segment: pi syntax for a pi source, literal text otherwise. */
export function sourceText(text: string, rawPi: boolean): Segment[] {
  return text ? [{ kind: rawPi ? "pi" : "text", text }] : [];
}

/** The value as the source wrote it, for previews and context checks. */
export function previewText(segments: readonly Segment[]): string {
  return segments.map((segment) => ("text" in segment ? segment.text : segment.from)).join("");
}

type TargetPart = string | { field: string };
const PI_REFERENCE = /\$\{[^{}]*\}/g;
const SHARED_REASONS = new Set<McpImportFieldReason>(["variable", "home", "workspace-basename", "unsupported-variable", "input"]);

class Encoder {
  readonly fields = new Map<string, McpImportField>();
  private readonly argTexts: string[];
  private readonly urlText: string;

  constructor(private readonly draft: ServerDraft) {
    this.argTexts = draft.args.map(previewText);
    this.urlText = previewText(draft.url ?? []);
  }

  /** Encodes one value: records its fields and returns the preview string the config holds. */
  encode(path: McpImportPath, segments: readonly Segment[]): string {
    const resolved = isResolvedPath(path);
    const label = pathLabel(path);
    const whole = previewText(segments);
    const parts: TargetPart[] = [];
    let encoding: McpImportTarget["encoding"];
    let escaped = false;
    const atStart = () => parts.every((part) => part === "");

    const literal = (text: string) => {
      if (!resolved) {
        parts.push(text);
        return;
      }
      // The source passes `$NAME` on as text; pi would have read it as a variable.
      const bare = /\$([A-Za-z_][A-Za-z0-9_]*)/.exec(text);
      if (bare) this.draft.note("bare-dollar-literal", { field: label, name: bare[1] });
      const value = escapeConfigValue(text, { atStart: atStart() });
      if (value !== text) escaped = true;
      parts.push(value);
    };
    const raw = (text: string) => parts.push(text);
    const field = (id: string) => parts.push({ field: id });

    if (!resolved && expandsHome(path) && segments.length === 1 && "text" in segments[0] && isPlaceholderPath(whole)) {
      // `--root=/path/to/dir` and `ROOT=/path/to/dir` keep their prefix; only the path is asked for.
      const prefix = path[0] === "args" ? /^(?:--?[A-Za-z][A-Za-z0-9_.-]*|[A-Za-z_][A-Za-z0-9_]*)=/.exec(whole)?.[0] ?? "" : "";
      const example = whole.slice(prefix.length);
      if (isPlaceholderPath(example)) {
        if (prefix) raw(prefix);
        field(this.field(path, "placeholder-path", example, example, "text"));
        return this.target(path, parts, undefined);
      }
    }

    let offset = 0;
    segments.forEach((segment, index) => {
      const next = segments[index + 1];
      const followedBySeparator = next === undefined || ("text" in next && /^[\\/]/.test(next.text));
      const placeholders = (text: string, push: (text: string) => void, skip: [number, number][]) => {
        let last = 0;
        for (const [start, end] of placeholderSpans(text)) {
          if (skip.some(([from, to]) => start < to && end > from)) continue;
          if (start > last) push(text.slice(last, start));
          if (path[0] === "url" && isInUrlComponent(whole, offset + start)) encoding = "uri-component";
          const placeholder = text.slice(start, end);
          field(this.field(path, "placeholder", placeholderLabel(path, placeholder), placeholder));
          last = end;
        }
        if (last < text.length) push(text.slice(last));
      };
      switch (segment.kind) {
        case "text":
          placeholders(segment.text, literal, []);
          break;
        case "pi": {
          const text = next ? sealPiText(segment.text) : segment.text;
          if (resolved && atStart() && isCommandConfigValue(text)) {
            this.draft.note("shell-command-value", { field: label });
            raw(text);
            break;
          }
          const references = [...text.matchAll(PI_REFERENCE)].map((match): [number, number] => [match.index!, match.index! + match[0].length]);
          placeholders(text, raw, references);
          break;
        }
        case "env":
          if (resolved) {
            raw(`\${${segment.name}}`);
            if (segment.fallback !== undefined) {
              this.draft.note("variable-fallback-dropped", { field: label, name: segment.name, fallback: segment.fallback });
            }
            if (segment.shell) this.draft.note("shell-variable", { field: label, name: segment.name });
            else if (segment.from !== `\${${segment.name}}`) {
              this.draft.note("variable-translated", { field: label, from: segment.from, to: `\${${segment.name}}` });
            }
          } else if (expandsHome(path) && atStart() && HOME_VARIABLES.has(segment.name) && followedBySeparator) {
            raw("~");
            this.draft.note("home-translated", { field: label, from: segment.from });
          } else {
            field(this.field(path, "variable", segment.name, segment.from, undefined, segment.fallback));
            this.draft.note(segment.shell ? "shell-variable" : "variable-unsupported-here", { field: label, name: segment.name });
          }
          break;
        case "input":
          field(this.inputField(path, segment));
          break;
        case "home":
          if (resolved) {
            // pi reads `${HOME}`, which Windows does not set by default: the connection then fails to resolve it.
            raw("${HOME}");
            this.draft.note("home-variable-translated", { field: label, from: segment.from, to: "${HOME}" });
          } else if (expandsHome(path) && atStart() && followedBySeparator) {
            raw("~");
            this.draft.note("home-translated", { field: label, from: segment.from });
          } else {
            field(this.field(path, "home", "userHome", segment.from, "text"));
          }
          break;
        case "workspace":
          if (path[0] === "url" || path[0] === "oauth") {
            field(this.field(path, "variable", "workspaceFolder", segment.from, "text"));
          } else {
            raw(".");
            this.draft.note("workspace-folder-relative", { field: label, from: segment.from });
          }
          break;
        case "workspace-basename":
          field(this.field(path, "workspace-basename", "workspaceFolderBasename", segment.from, "text"));
          break;
        case "unsupported":
          field(this.field(path, "unsupported-variable", segment.from, segment.from));
          this.draft.note("unsupported-variable", { field: label, variable: segment.from });
          break;
        case "prompt":
          if (path[0] === "url" && isInUrlComponent(whole, offset)) encoding = "uri-component";
          field(this.promptField(path, segment));
          break;
      }
      offset += ("text" in segment ? segment.text : segment.from).length;
    });
    if (escaped) this.draft.note("escaped-value", { field: label });
    return this.target(path, parts, encoding);
  }

  /** Records the value at `path` as a target of its fields; returns the preview string. */
  private target(path: McpImportPath, parts: TargetPart[], encoding: McpImportTarget["encoding"]): string {
    const compact = parts.filter((part) => part !== "");
    for (const id of new Set(compact.flatMap((part) => (typeof part === "string" ? [] : [part.field])))) {
      const field = this.fields.get(id)!;
      if (!field.targets.some((target) => pathKey(target.path) === pathKey(path))) {
        field.targets.push({ path, parts: compact, ...(encoding ? { encoding } : {}) });
      }
    }
    return compact.map((part) => (typeof part === "string" ? part : (this.fields.get(part.field)!.placeholder ?? ""))).join("");
  }

  /** A field for `path`; variables and the like are shared by every value that uses them. */
  private field(
    path: McpImportPath,
    reason: McpImportFieldReason,
    label: string,
    placeholder: string,
    kind?: McpImportField["kind"],
    defaultValue?: string,
  ): string {
    let id = SHARED_REASONS.has(reason) ? `${reason}.${label}` : pathLabel(path);
    if (!SHARED_REASONS.has(reason)) {
      for (let count = 2; this.fields.has(id); count++) id = `${pathLabel(path)}#${count}`;
    } else if (this.fields.has(id)) {
      return id;
    }
    const secret = this.isSecretContext(path, placeholder) || isSecretName(label);
    const authorization = path[0] === "headers" && path[1].toLowerCase() === "authorization";
    this.fields.set(id, {
      id,
      kind: kind ?? (secret ? "password" : "text"),
      reason,
      label,
      placeholder,
      ...(defaultValue !== undefined ? { defaultValue } : {}),
      // Left blank, the header is removed and pi signs in with OAuth instead.
      ...(reason === "placeholder" && authorization ? { optional: true } : {}),
      targets: [],
    });
    return id;
  }

  private inputField(path: McpImportPath, segment: Extract<Segment, { kind: "input" }>): string {
    const id = `input.${segment.id}`;
    if (this.fields.has(id)) return id;
    const input = this.draft.inputs?.get(segment.id);
    if (!input) this.draft.note("input-undefined", { id: segment.id });
    else if (input.type === "command") this.draft.note("input-command-unsupported", { id: segment.id });
    const options = input?.type === "pickString" && input.options && input.options.length > 0 ? input.options : undefined;
    const secret = input?.password === true || this.isSecretContext(path, segment.from);
    this.fields.set(id, {
      id,
      kind: options ? "select" : secret ? "password" : "text",
      reason: "input",
      label: segment.id,
      placeholder: segment.from,
      ...(input?.description ? { description: input.description } : {}),
      ...(input?.default !== undefined ? { defaultValue: input.default } : {}),
      ...(options ? { options } : {}),
      targets: [],
    });
    return id;
  }

  private promptField(path: McpImportPath, segment: Extract<Segment, { kind: "prompt" }>): string {
    if (this.fields.has(segment.id)) return segment.id;
    this.fields.set(segment.id, {
      id: segment.id,
      kind: segment.options ? "select" : segment.secret || this.isSecretContext(path, segment.from) ? "password" : "text",
      reason: segment.reason,
      label: segment.label,
      placeholder: segment.from,
      ...(segment.description ? { description: segment.description } : {}),
      ...(segment.defaultValue !== undefined ? { defaultValue: segment.defaultValue } : {}),
      ...(segment.options ? { options: segment.options } : {}),
      ...(segment.optional ? { optional: true } : {}),
      targets: [],
    });
    return segment.id;
  }

  /** Whether the value at `path` is a credential by where it sits, by the rules of `lib/mcp-secrets.ts`. */
  private isSecretContext(path: McpImportPath, placeholder: string): boolean {
    switch (path[0]) {
      case "env":
      case "headers":
        return isSecretName(path[1]);
      case "oauth":
        return path[1] === "clientSecret";
      case "args": {
        // `--token=…`, `TOKEN=…`, `Authorization: Bearer …` as one argument, or the value after `--token`.
        if (maskArgs([this.argTexts[path[1]] ?? ""]).masked) return true;
        const previous = this.argTexts[path[1] - 1];
        return previous !== undefined && flagTakesSecret(previous);
      }
      case "url": {
        const at = this.urlText.indexOf(placeholder);
        const param = at < 0 ? undefined : /[?&]([^=&?#]+)=[^&#]*$/.exec(this.urlText.slice(0, at))?.[1];
        return param !== undefined && isSecretQueryParameter(param);
      }
      default:
        return false;
    }
  }
}

/** Whether the argument after `flag` is a credential (`--token X`, `-k X`), as `maskArgs` reads it. */
function flagTakesSecret(flag: string): boolean {
  return maskArgs([flag, "x"]).args[1] === SECRET_MASK;
}

/** Whether a query parameter of this name carries a credential (`key`, `token`, `sig`…), as `maskUrl` reads it. */
function isSecretQueryParameter(name: string): boolean {
  return maskUrl(`https://host.invalid/?${name}=x`).masked;
}

function placeholderLabel(path: McpImportPath, placeholder: string): string {
  if (path[0] === "env" || path[0] === "headers") return path[1];
  return placeholder.replace(/^[<{\s]+|[>}\s]+$/g, "") || pathLabel(path);
}

/** Whether `offset` in a URL falls after its authority, in the path, query or fragment. */
function isInUrlComponent(url: string, offset: number): boolean {
  const scheme = url.indexOf("//");
  const authorityEnd = url.slice(scheme < 0 ? 0 : scheme + 2).search(/[/?#]/);
  return authorityEnd >= 0 && offset >= (scheme < 0 ? 0 : scheme + 2) + authorityEnd;
}

/** Encodes a draft into a server, or a note saying why it cannot be one. */
export function finishDraft(draft: ServerDraft): { server: McpImportServer } | { note: McpImportNote } {
  const encoder = new Encoder(draft);
  let config: Record<string, unknown>;
  // Encoded in config order, so fields are listed in the order the values appear.
  if (draft.transport === "stdio" && draft.command && previewText(draft.command) !== "") {
    const command = encoder.encode(["command"], draft.command);
    const args = draft.args.map((segments, index) => encoder.encode(["args", index], segments));
    const env: Record<string, string> = {};
    for (const [key, segments] of draft.env) env[key] = encoder.encode(["env", key], segments);
    config = {
      command,
      ...(args.length > 0 ? { args } : {}),
      ...(Object.keys(env).length > 0 ? { env } : {}),
      ...(draft.cwd ? { cwd: encoder.encode(["cwd"], draft.cwd) } : {}),
    };
  } else if (draft.transport === "http" && draft.url && previewText(draft.url) !== "") {
    const url = encoder.encode(["url"], draft.url);
    const headers: Record<string, string> = {};
    for (const [key, segments] of draft.headers) headers[key] = encoder.encode(["headers", key], segments);
    const oauth: Record<string, unknown> = {};
    const { clientId, clientSecret, callbackPort, clientName, callbackUrl, scope, authServerMetadataUrl } = draft.oauth;
    if (clientId) oauth.clientId = encoder.encode(["oauth", "clientId"], clientId);
    if (clientSecret) oauth.clientSecret = encoder.encode(["oauth", "clientSecret"], clientSecret);
    if (callbackPort !== undefined) oauth.callbackPort = callbackPort;
    if (clientName) oauth.clientName = encoder.encode(["oauth", "clientName"], clientName);
    if (callbackUrl) oauth.callbackUrl = encoder.encode(["oauth", "callbackUrl"], callbackUrl);
    if (scope) oauth.scope = encoder.encode(["oauth", "scope"], scope);
    if (authServerMetadataUrl) oauth.authServerMetadataUrl = encoder.encode(["oauth", "authServerMetadataUrl"], authServerMetadataUrl);
    config = {
      url,
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
      ...(Object.keys(oauth).length > 0 ? { oauth } : {}),
    };
  } else {
    return { note: { code: "no-command-or-url", ...(draft.name ? { params: { server: draft.name } } : {}) } };
  }
  if (draft.exposure !== undefined) config.exposure = draft.exposure;
  if (draft.toolExposure !== undefined) config.toolExposure = draft.toolExposure;
  if (draft.enabled === false) config.enabled = false;
  if (draft.timeout !== undefined) config.timeout = draft.timeout;
  if (draft.description !== undefined) config.description = draft.description;
  return {
    server: {
      name: draft.name ?? "",
      ...(draft.originalName !== undefined ? { originalName: draft.originalName } : {}),
      config: config as unknown as McpServerConfig,
      fields: [...encoder.fields.values()],
      notes: draft.notes,
      source: draft.source,
      rawPi: draft.rawPi,
      ...(draft.scopeHint ? { scopeHint: draft.scopeHint } : {}),
    },
  };
}

/**
 * pi's fetch refuses a URL with credentials in it (`https://user:pass@host`),
 * so they move into a Basic `Authorization` header. Returns undefined for a
 * URL without userinfo or one that does not parse.
 */
export function splitUrlUserinfo(text: string): { url: string; authorization: string } | undefined {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return undefined;
  }
  if (url.username === "" && url.password === "") return undefined;
  const decode = (part: string) => {
    try {
      return decodeURIComponent(part);
    } catch {
      return part;
    }
  };
  const bytes = new TextEncoder().encode(`${decode(url.username)}:${decode(url.password)}`);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  url.username = "";
  url.password = "";
  return { url: url.toString(), authorization: `Basic ${btoa(binary)}` };
}

/** Sets a draft's URL from literal text, moving userinfo into the Authorization header. */
export function setLiteralUrl(draft: ServerDraft, text: string, hasAuthorization: boolean): void {
  const split = hasAuthorization ? undefined : splitUrlUserinfo(text);
  if (!split) {
    draft.url = [{ kind: "text", text }];
    return;
  }
  draft.url = [{ kind: "text", text: split.url }];
  draft.headers.push(["Authorization", [{ kind: "text", text: split.authorization }]]);
  draft.note("userinfo-moved-to-header");
}

// ---------------------------------------------------------------------------
// Names

const SERVER_NAME = /^[A-Za-z0-9_-]+$/;
const MAX_NAME_LENGTH = 48;

/** A name pi accepts (`[A-Za-z0-9_-]`), or `""` when nothing usable is left. */
export function sanitizeServerName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, MAX_NAME_LENGTH)
    .replace(/[-_]+$/g, "");
}

/** Whether pi accepts `name` as a server name (SDK `validateMcpServerConfig`). */
export function isValidServerName(name: string): boolean {
  return SERVER_NAME.test(name);
}

/** `name`, or `name-2`, `name-3`… whichever is not taken. */
export function suggestFreeName(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(name)) return name;
  for (let count = 2; ; count++) {
    const candidate = `${name}-${count}`;
    if (!used.has(candidate)) return candidate;
  }
}

const GENERIC_NAMES = new Set(["mcp", "server", "mcp-server", "mcpserver", "cli", "index", "main", "app", "src", "dist", "build", "bin", "lib"]);

/** `@modelcontextprotocol/server-filesystem` → `filesystem`, `@playwright/mcp@latest` → `playwright`. */
export function nameFromPackage(spec: string): string {
  let rest = spec.trim();
  const versionAt = rest.lastIndexOf("@");
  if (versionAt > 0) rest = rest.slice(0, versionAt);
  rest = rest.replace(/==.*$|\[.*\]$/, "");
  let scope = "";
  const scoped = /^@([^/]+)\/(.+)$/.exec(rest);
  if (scoped) {
    scope = scoped[1];
    rest = scoped[2];
  } else if (rest.includes("/")) {
    const segments = rest.split("/").filter(Boolean);
    rest = segments[segments.length - 1] ?? rest;
  }
  const stripped = stripMcpAffixes(rest);
  if (stripped && !GENERIC_NAMES.has(stripped.toLowerCase())) return stripped;
  return stripMcpAffixes(scope) || scope || stripped || rest;
}

const MCP_AFFIXES = [/^mcp[-_]server[-_]/i, /^server[-_]/i, /^mcp[-_]/i, /[-_]mcp[-_]server$/i, /[-_]mcp$/i, /[-_]server$/i];

/** `mcp-server-git` → `git`, `context7-mcp` → `context7`; never strips a name down to nothing. */
function stripMcpAffixes(name: string): string {
  let result = name;
  for (let changed = true; changed;) {
    changed = false;
    for (const affix of MCP_AFFIXES) {
      const next = result.replace(affix, "");
      if (next !== result && next) {
        result = next;
        changed = true;
      }
    }
  }
  return result;
}

const URL_NOISE_LABELS = new Set(["mcp", "www", "api", "app", "server", "servers", "remote", "gateway"]);

/** `https://mcp.notion.com/mcp` → `notion`; loopback hosts → `local`. */
export function nameFromUrl(url: string): string {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return "";
  }
  if (host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1") return "local";
  if (/^\d+(?:\.\d+){3}$/.test(host)) return "";
  const labels = host.split(".").filter(Boolean);
  if (labels.length > 1) labels.pop();
  if (labels.length > 1 && /^(?:co|com|org|net|ac|gov)$/.test(labels[labels.length - 1])) labels.pop();
  const meaningful = labels.filter((label) => !URL_NOISE_LABELS.has(label.toLowerCase()));
  return meaningful[meaningful.length - 1] ?? labels[labels.length - 1] ?? "";
}

/** Options of `docker run` that take a value, so the image can be found after them. */
const DOCKER_VALUE_OPTIONS = new Set([
  "-e", "--env", "--env-file", "-v", "--volume", "-p", "--publish", "--name", "--network", "--net", "-w", "--workdir",
  "-u", "--user", "--mount", "--entrypoint", "-l", "--label", "--platform", "--pull", "-h", "--hostname", "--add-host",
  "--cpus", "-m", "--memory", "--restart", "--runtime", "--cap-add", "--cap-drop", "--device", "--dns", "--ipc",
  "--pid", "--security-opt", "--tmpfs", "--ulimit", "--log-driver", "--log-opt", "--gpus",
]);

function firstOperand(args: readonly string[], valueOptions: ReadonlySet<string>): string | undefined {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--") return args[index + 1];
    if (arg.startsWith("-")) {
      if (!arg.includes("=") && valueOptions.has(arg)) index++;
      continue;
    }
    return arg;
  }
  return undefined;
}

/** A name for a stdio server from its command line; `""` when nothing fits. */
export function nameFromCommand(command: string, args: readonly string[]): string {
  const base = command.split(/[\\/]/).pop()?.replace(/\.(?:cmd|exe|bat|ps1)$/i, "").toLowerCase() ?? "";
  const operand = (options: string[]) => firstOperand(args, new Set(options));
  switch (base) {
    case "npx":
    case "bunx":
    case "pnpx": {
      const pkg = operand(["-p", "--package", "-c", "--call"]);
      return pkg ? nameFromPackage(pkg) : "";
    }
    case "pnpm":
    case "yarn":
    case "bun":
    case "npm": {
      const start = args.findIndex((arg) => arg === "dlx" || arg === "exec" || arg === "x");
      const pkg = start >= 0 ? firstOperand(args.slice(start + 1), new Set(["-p", "--package"])) : undefined;
      return pkg ? nameFromPackage(pkg) : "";
    }
    case "uvx":
    case "pipx": {
      const rest = base === "pipx" && args[0] === "run" ? args.slice(1) : args;
      const pkg = firstOperand(rest, new Set(["--from", "--with", "--python", "-p", "--index-url", "--spec"]));
      return pkg ? nameFromPackage(pkg) : "";
    }
    case "uv": {
      const start = args.indexOf("run");
      const pkg = start >= 0 ? firstOperand(args.slice(start + 1), new Set(["--with", "--directory", "--python", "-p", "--from", "--project"])) : undefined;
      return pkg ? nameFromScript(pkg) : "";
    }
    case "docker":
    case "podman": {
      const start = args.indexOf("run");
      const image = start >= 0 ? firstOperand(args.slice(start + 1), DOCKER_VALUE_OPTIONS) : undefined;
      if (!image) return "";
      const last = image.split("/").pop()!.replace(/[:@].*$/, "");
      return stripMcpAffixes(last) || last;
    }
    case "python":
    case "python3":
    case "py": {
      const moduleFlag = args.indexOf("-m");
      if (moduleFlag >= 0 && args[moduleFlag + 1]) return nameFromPackage(args[moduleFlag + 1].replace(/_/g, "-"));
      const script = firstOperand(args, new Set(["-X", "-W"]));
      return script ? nameFromScript(script) : "";
    }
    case "node":
    case "deno":
    case "tsx":
    case "ts-node": {
      const rest = base === "deno" && args[0] === "run" ? args.slice(1) : args;
      const script = firstOperand(rest, new Set(["-r", "--require", "--import", "--loader"]));
      return script ? nameFromScript(script) : "";
    }
    default:
      return stripMcpAffixes(base.replace(/_/g, "-")) || base;
  }
}

/** `/opt/weather/build/index.js` → `weather`, `server.py` → `server`. */
function nameFromScript(path: string): string {
  const segments = path.split(/[\\/]/).filter(Boolean);
  for (let index = segments.length - 1; index >= 0; index--) {
    const segment = segments[index].replace(/\.[A-Za-z0-9]+$/, "");
    if (!GENERIC_NAMES.has(segment.toLowerCase()) && segment !== "." && segment !== "..") {
      return stripMcpAffixes(segment.replace(/_/g, "-")) || segment;
    }
  }
  return "";
}

// ---------------------------------------------------------------------------
// Timeouts

const MAX_TIMEOUT_SECONDS = 3600;

/** Sets a timeout given in milliseconds as pi's seconds, rounded up and clamped; notes one it cannot use. */
export function timeoutFromMilliseconds(draft: ServerDraft, value: unknown): void {
  if (!usableTimeout(draft, value)) return;
  setTimeoutSeconds(draft, Math.ceil(value / 1000), value);
}

/** Sets a timeout given in seconds (Cline's), clamped to pi's range. */
export function timeoutFromSeconds(draft: ServerDraft, value: unknown): void {
  if (!usableTimeout(draft, value)) return;
  setTimeoutSeconds(draft, Math.ceil(value), undefined);
}

/**
 * Sets a timeout whose unit the source does not say: Gemini uses
 * milliseconds, Cline seconds, and the entry carried neither's keys. At least
 * 1000 reads as milliseconds, below as seconds, and the guess is noted.
 */
export function timeoutGuessingUnit(draft: ServerDraft, value: unknown): void {
  if (!usableTimeout(draft, value)) return;
  const milliseconds = value >= 1000;
  draft.note("timeout-unit-guessed", { value, unit: milliseconds ? "milliseconds" : "seconds" });
  if (milliseconds) setTimeoutSeconds(draft, Math.ceil(value / 1000), value);
  else setTimeoutSeconds(draft, Math.ceil(value), undefined);
}

function usableTimeout(draft: ServerDraft, value: unknown): value is number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return true;
  if (value !== undefined) draft.note("timeout-dropped", { value: String(value) });
  return false;
}

function setTimeoutSeconds(draft: ServerDraft, seconds: number, milliseconds: number | undefined): void {
  const clamped = Math.min(Math.max(seconds, 1), MAX_TIMEOUT_SECONDS);
  if (milliseconds !== undefined) draft.note("timeout-converted", { from: milliseconds, to: clamped });
  if (clamped !== seconds) draft.note("timeout-clamped", { from: seconds, to: clamped });
  draft.timeout = clamped;
}

// ---------------------------------------------------------------------------
// Validation: a port of the SDK's `validateMcpServerConfig` with typed codes.

export const MCP_EXPOSURES: readonly McpExposure[] = ["codemode", "deferred", "direct", "hidden"];
/** Old exposure names pi still accepts, and the exposure each now means (SDK `resolveExposureAlias()`). */
const MCP_EXPOSURE_ALIASES: Readonly<Record<string, McpExposure>> = { "codemode-deferred": "codemode" };
const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

export function isMcpExposure(value: unknown): value is McpExposure {
  return typeof value === "string" && (MCP_EXPOSURES as readonly string[]).includes(value);
}

/** The exposure `value` names, an alias read as what it now means; undefined for anything else. */
export function resolveMcpExposure(value: unknown): McpExposure | undefined {
  if (isMcpExposure(value)) return value;
  return typeof value === "string" && Object.hasOwn(MCP_EXPOSURE_ALIASES, value) ? MCP_EXPOSURE_ALIASES[value] : undefined;
}

/** SDK `validateOAuth`'s rule for `oauth.authServerMetadataUrl`: https, or http on a loopback host. */
function isMetadataUrl(value: unknown): boolean {
  const url = typeof value === "string" ? parseUrl(value) : undefined;
  return url !== undefined && (url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK_HOSTS.includes(url.hostname)));
}

function parseUrl(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

/** SDK `isLoopbackRedirectUri`. */
export function isLoopbackRedirectUri(value: string): boolean {
  const url = parseUrl(value);
  return url !== undefined && url.protocol === "http:" && LOOPBACK_HOSTS.includes(url.hostname) && url.search === "" && url.hash === "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): boolean {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}

/** SDK `validateOAuth`: why `oauth` would be refused, as a problem code. */
function oauthValidationProblem(oauth: unknown): { problem: string; [key: string]: string } | undefined {
  if (oauth === undefined) return undefined;
  if (!isRecord(oauth)) return { problem: "oauth" };
  if (oauth.clientId !== undefined && typeof oauth.clientId !== "string") return { problem: "oauth-client-id" };
  if (oauth.clientSecret !== undefined && typeof oauth.clientSecret !== "string") return { problem: "oauth-client-secret" };
  const port = oauth.callbackPort;
  if (port !== undefined && (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535)) {
    return { problem: "callback-port", value: String(port) };
  }
  if (oauth.callbackUrl !== undefined) {
    if (typeof oauth.callbackUrl !== "string" || !isLoopbackRedirectUri(oauth.callbackUrl)) {
      return { problem: "callback-url", value: String(oauth.callbackUrl) };
    }
    const urlPort = new URL(oauth.callbackUrl).port;
    if (urlPort && port !== undefined && Number(urlPort) !== port) return { problem: "callback-port-mismatch", value: urlPort };
  }
  if (oauth.scope !== undefined && typeof oauth.scope !== "string") return { problem: "oauth-scope" };
  if (oauth.clientName !== undefined && (typeof oauth.clientName !== "string" || !oauth.clientName.trim())) {
    return { problem: "oauth-client-name" };
  }
  if (oauth.authServerMetadataUrl !== undefined && !isMetadataUrl(oauth.authServerMetadataUrl)) {
    return { problem: "auth-server-metadata-url", value: String(oauth.authServerMetadataUrl) };
  }
  return undefined;
}

/** Why `validateMcpServerConfig(name, config)` would refuse the config, as a `invalid-config` problem code. */
export function validationProblem(name: string, config: unknown): { problem: string; [key: string]: string } | undefined {
  if (!SERVER_NAME.test(name)) return { problem: "name", name };
  if (!isRecord(config)) return { problem: "not-an-object" };
  const { type, exposure, enabled, timeout, toolExposure, description } = config;
  if (exposure !== undefined && !resolveMcpExposure(exposure)) return { problem: "exposure", value: String(exposure) };
  if (toolExposure !== undefined) {
    if (!isRecord(toolExposure)) return { problem: "tool-exposure" };
    for (const [tool, value] of Object.entries(toolExposure)) {
      if (!resolveMcpExposure(value)) return { problem: "tool-exposure", tool };
    }
  }
  if (enabled !== undefined && typeof enabled !== "boolean") return { problem: "enabled" };
  if (description !== undefined && typeof description !== "string") return { problem: "description" };
  if (timeout !== undefined && (typeof timeout !== "number" || !(timeout > 0))) return { problem: "timeout", value: String(timeout) };
  if (type === "sse") return { problem: "sse" };
  if (typeof config.url === "string" && (type === undefined || type === "http" || type === "streamable-http")) {
    const url = parseUrl(config.url);
    if (!url || !/^https?:$/.test(url.protocol)) return { problem: "url", url: config.url };
    if (config.headers !== undefined && !isStringRecord(config.headers)) return { problem: "headers" };
    const oauthProblem = oauthValidationProblem(config.oauth);
    if (oauthProblem) return oauthProblem;
    const auth = config.auth;
    if (auth !== undefined) {
      if (!isRecord(auth) || typeof auth.provider !== "string" || !auth.provider) return { problem: "auth" };
      if (url.protocol !== "https:" && !LOOPBACK_HOSTS.includes(url.hostname)) return { problem: "auth-url" };
    }
    return undefined;
  }
  if (typeof config.command === "string" && (type === undefined || type === "stdio")) {
    if (config.args !== undefined && !(Array.isArray(config.args) && config.args.every((arg) => typeof arg === "string"))) {
      return { problem: "args" };
    }
    if (config.env !== undefined && !isStringRecord(config.env)) return { problem: "env" };
    if (config.cwd !== undefined && typeof config.cwd !== "string") return { problem: "cwd" };
    return undefined;
  }
  return { problem: "no-command-or-url" };
}

