import type { McpExposure, McpServerConfig } from "@earendil-works/pi-coding-agent";
import type {
  FreshFolderTrustBreadth,
  McpConfigFieldRef,
  McpConfigFileProblemReason,
  McpResponse,
  McpScope,
  McpVariableReference,
} from "@/lib/api-types";
import {
  configValueEnvVarNames,
  fillMcpImportFields,
  isCommandConfigValue,
  isResolvedPath,
  isValidServerName,
  MCP_IMPORT_NOTE_SEVERITY,
  parseMcpImport,
  pathLabel,
  referenceableLiteralSecrets,
  suggestFreeName,
  validationProblem,
  type McpImportField,
  type McpImportFieldValue,
  type McpImportFillResult,
  type McpImportFormat,
  type McpImportNote,
  type McpImportNoteSeverity,
  type McpImportResult,
  type McpImportServer,
} from "@/lib/mcp-import";
import { findWebPasswordField, resolvedConfigValues, WEB_PASSWORD_VARIABLE, type McpResolvedConfigValue } from "@/lib/mcp-config-values";
import { SECRET_MASK } from "@/lib/mcp-secrets";
import { formatMcpCommandLine, revealHiddenCharacters } from "@/lib/mcp-server-display";
import { isBlockingFileProblem, mcpProjectTrustable, mcpWritesOff } from "./mcp-config-helpers";

// The add pane of Settings › MCP (`components/McpAddServer.tsx`): what a paste
// becomes, previewed in the browser with the same pure importer the route
// parses it with again (`lib/mcp-import.ts`), where it can be saved, and why
// Add cannot be used. Nothing here sends anything; `postMcpAction()` does,
// with `mcpAddRequest()`'s body.

/** What the user has typed into the add pane; the panel keeps it while another row is shown. */
export interface McpAddDraft {
  text: string;
  /** "Enable pi mcp syntax": JSON values keep `${VAR}`, `$$` and `!command` as written. */
  rawPi: boolean;
  /** Which of the paste's servers, in the importer's order. */
  server: number;
  /** The name typed, or undefined for the importer's. */
  name?: string;
  /** Field values typed, by field id. */
  values: Record<string, string>;
  /** Fields answered with a host variable instead: the variable's name as typed, by field id. */
  references: Record<string, string>;
  /** The paste's own literal secrets read from a host variable instead: the variable's name as typed, by label (`headers.Authorization`). */
  secretReferences: Record<string, string>;
  /** The scope picked, or undefined for the default (the paste's own hint where it may go, else global). */
  scope?: McpScope;
}

export const EMPTY_MCP_ADD_DRAFT: McpAddDraft = { text: "", rawPi: false, server: 0, values: {}, references: {}, secretReferences: {} };

/**
 * What the values typed into the draft were typed for: the picked server's
 * format, its name as the paste spells it, and where it connects (the URL, or
 * the command and its arguments, placeholders as pasted). Undefined when the
 * text holds no server.
 */
function mcpAddServerIdentity(text: string, rawPi: boolean, index: number): string | undefined {
  const parsed = parseMcpImport(text, { rawPi });
  if (!parsed.ok) return undefined;
  const server = parsed.servers[Math.min(index, parsed.servers.length - 1)];
  const { config } = server;
  const target = "url" in config ? ["url", config.url] : ["command", config.command, config.args ?? []];
  return JSON.stringify([server.source, server.originalName ?? server.name, target]);
}

/**
 * The draft with its text (or how it is read) changed. What was typed for the
 * paste before (the name, the values, the variables, the server picked)
 * stays only while the picked server is still the same one, connecting to the
 * same place: a password typed for one server must never be sent to the next
 * paste's URL because its field happens to have the same id
 * (`headers.Authorization`).
 */
export function mcpAddDraftWithPaste(draft: McpAddDraft, paste: { text?: string; rawPi?: boolean }): McpAddDraft {
  const next = { ...draft, ...paste };
  const before = mcpAddServerIdentity(draft.text, draft.rawPi, draft.server);
  if (before !== undefined && before === mcpAddServerIdentity(next.text, next.rawPi, draft.server)) return next;
  const reset: McpAddDraft = { ...next, server: 0, values: {}, references: {}, secretReferences: {} };
  delete reset.name;
  return reset;
}

/**
 * Whether the "Enable pi mcp syntax" toggle changes how the paste is read: the
 * importer takes some server as pi syntax with it and not without. Asking the
 * importer keeps this in step with it (VS Code, Zed, opencode and registry
 * JSON are always other clients' syntax, and `pi mcp add` always pi's).
 */
export function mcpAddOffersRawPi(text: string): boolean {
  const raw = parseMcpImport(text, { rawPi: true });
  if (!raw.ok) return false;
  const plain = parseMcpImport(text, { rawPi: false });
  return raw.servers.some((server, index) => server.rawPi && !(plain.ok && plain.servers[index]?.rawPi));
}

// ---------------------------------------------------------------------------
// Notes, as text

/** The i18n key of each importer note; some codes pick a variant by a parameter. */
export function mcpImportNoteKey(note: McpImportNote): string {
  const params = note.params ?? {};
  switch (note.code) {
    case "field-reference-invalid":
      return `mcp.importNote.field-reference-invalid.${params.problem === "target" || params.problem === "missing" ? params.problem : "name"}`;
    case "sse-transport":
      return params.suggestedUrl === undefined ? "mcp.importNote.sse-transport" : "mcp.importNote.sse-transport.suggested";
    case "timeout-unit-guessed":
      return `mcp.importNote.timeout-unit-guessed.${params.unit === "milliseconds" ? "milliseconds" : "seconds"}`;
    case "tool-filter-imported":
      return `mcp.importNote.tool-filter-imported.${params.mode === "exclude" ? "exclude" : "include"}`;
    default:
      return `mcp.importNote.${note.code}`;
  }
}

/** The i18n key of an `invalid-config` note's `problem`, with a variant where a parameter is optional. */
export function mcpImportProblemKey(params: Readonly<Record<string, string | number>>): string {
  const problem = String(params.problem ?? "no-command-or-url");
  if (problem === "tool-exposure" && params.tool !== undefined) return "mcp.importProblem.tool-exposure.tool";
  if (problem === "args" && params.index !== undefined) return "mcp.importProblem.args.index";
  return `mcp.importProblem.${problem}`;
}

/** Every `invalid-config` problem the importer's port of the SDK validator names. */
export const MCP_IMPORT_PROBLEM_KEYS = [
  "mcp.importProblem.name",
  "mcp.importProblem.not-an-object",
  "mcp.importProblem.exposure",
  "mcp.importProblem.tool-exposure",
  "mcp.importProblem.tool-exposure.tool",
  "mcp.importProblem.enabled",
  "mcp.importProblem.description",
  "mcp.importProblem.timeout",
  "mcp.importProblem.sse",
  "mcp.importProblem.url",
  "mcp.importProblem.headers",
  "mcp.importProblem.auth",
  "mcp.importProblem.auth-url",
  "mcp.importProblem.oauth",
  "mcp.importProblem.oauth-client-id",
  "mcp.importProblem.oauth-client-secret",
  "mcp.importProblem.callback-port",
  "mcp.importProblem.callback-url",
  "mcp.importProblem.callback-port-mismatch",
  "mcp.importProblem.oauth-scope",
  "mcp.importProblem.oauth-client-name",
  "mcp.importProblem.auth-server-metadata-url",
  "mcp.importProblem.args",
  "mcp.importProblem.args.index",
  "mcp.importProblem.env",
  "mcp.importProblem.cwd",
  "mcp.importProblem.no-command-or-url",
] as const;

export function mcpImportNoteSeverity(note: McpImportNote): McpImportNoteSeverity {
  return MCP_IMPORT_NOTE_SEVERITY[note.code] ?? "warning";
}

type Translate = (key: string, params?: Record<string, string | number>) => string;

/**
 * A note as one line of text. Parameters are source text (a field label, an
 * option, a URL), shown with their hidden characters escaped; a note about one
 * server of several names it in front. A field id is shown as the field's
 * label when the server's fields are given.
 */
export function mcpImportNoteText(note: McpImportNote, t: Translate, fields: readonly McpImportField[] = []): string {
  const raw = note.params ?? {};
  const params: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(raw)) params[key] = typeof value === "string" ? revealHiddenCharacters(value) : value;
  if (typeof raw.field === "string" && note.code.startsWith("field-")) {
    const field = fields.find((item) => item.id === raw.field);
    if (field) params.field = revealHiddenCharacters(field.label);
  }
  if (note.code === "invalid-config") params.problem = t(mcpImportProblemKey(raw), params);
  if (note.code === "cli-option-wrong-transport" && (raw.transport === "stdio" || raw.transport === "http")) {
    params.transport = t(`mcp.transport.${raw.transport}`);
  }
  const text = t(mcpImportNoteKey(note), params);
  return typeof params.server === "string" ? t("mcp.importNote.forServer", { server: params.server, note: text }) : text;
}

/**
 * Why a field is asked for. A placeholder has no words of its own: its box
 * shows the paste's text as its placeholder, and `mcpFieldStoredAs()` the text
 * around it.
 */
export const MCP_IMPORT_FIELD_REASON_KEYS: Partial<Record<McpImportField["reason"], string>> = {
  empty: "mcp.importField.reason.empty",
  input: "mcp.importField.reason.input",
  variable: "mcp.importField.reason.variable",
  home: "mcp.importField.reason.home",
  "workspace-basename": "mcp.importField.reason.workspace-basename",
  "unsupported-variable": "mcp.importField.reason.unsupported-variable",
  "client-secret": "mcp.importField.reason.client-secret",
  "registry-header": "mcp.importField.reason.registry-header",
  "registry-variable": "mcp.importField.reason.registry-variable",
};

export const MCP_IMPORT_SOURCE_KEYS: Record<McpImportFormat, string> = {
  url: "mcp.add.source.url",
  "command-line": "mcp.add.source.command-line",
  "pi-mcp-add": "mcp.add.source.pi-mcp-add",
  "claude-mcp-add": "mcp.add.source.claude-mcp-add",
  "claude-mcp-add-json": "mcp.add.source.claude-mcp-add-json",
  "codex-mcp-add": "mcp.add.source.codex-mcp-add",
  "gemini-mcp-add": "mcp.add.source.gemini-mcp-add",
  "vscode-add-mcp": "mcp.add.source.vscode-add-mcp",
  "mcp-servers-json": "mcp.add.source.mcp-servers-json",
  "vscode-json": "mcp.add.source.vscode-json",
  "zed-json": "mcp.add.source.zed-json",
  "opencode-json": "mcp.add.source.opencode-json",
  "server-object": "mcp.add.source.server-object",
  "server-map": "mcp.add.source.server-map",
  "registry-server-json": "mcp.add.source.registry-server-json",
  "cursor-install-link": "mcp.add.source.cursor-install-link",
  "vscode-install-link": "mcp.add.source.vscode-install-link",
  "visual-studio-install-link": "mcp.add.source.visual-studio-install-link",
  "copilot-app-install-link": "mcp.add.source.copilot-app-install-link",
};

// The fetch server the stdio examples add, as an install link carries it: Cursor's
// config without its name, VS Code's (and the links built on it) with it.
const FETCH_CONFIG = JSON.stringify({ command: "uvx", args: ["mcp-server-fetch"] });
const FETCH_NAMED = JSON.stringify({ name: "fetch", command: "uvx", args: ["mcp-server-fetch"] });

/**
 * One example per format the importer reads, shown under the empty paste box
 * with its format's name (`MCP_IMPORT_SOURCE_KEYS`): addresses and commands,
 * other clients' command lines, configs, install links. Each is read as its
 * format with nothing left to fill in, which `mcp-add-helpers.test.mjs` checks,
 * along with a format added to the importer without one here.
 */
export const MCP_ADD_EXAMPLES: readonly { source: McpImportFormat; text: string }[] = [
  { source: "url", text: "https://mcp.example.com/mcp" },
  { source: "command-line", text: "npx -y @modelcontextprotocol/server-everything" },
  { source: "pi-mcp-add", text: "pi mcp add docs --url https://mcp.example.com/mcp" },
  { source: "claude-mcp-add", text: "claude mcp add --transport http docs https://mcp.example.com/mcp" },
  { source: "claude-mcp-add-json", text: `claude mcp add-json docs '{"type":"http","url":"https://mcp.example.com/mcp"}'` },
  { source: "codex-mcp-add", text: "codex mcp add fetch -- uvx mcp-server-fetch" },
  { source: "gemini-mcp-add", text: "gemini mcp add --transport http docs https://mcp.example.com/mcp" },
  { source: "vscode-add-mcp", text: `code --add-mcp '${FETCH_NAMED}'` },
  { source: "mcp-servers-json", text: '{ "mcpServers": { "fetch": { "command": "uvx", "args": ["mcp-server-fetch"] } } }' },
  { source: "vscode-json", text: '{ "servers": { "docs": { "type": "http", "url": "https://mcp.example.com/mcp" } } }' },
  { source: "zed-json", text: '{ "context_servers": { "fetch": { "command": "uvx", "args": ["mcp-server-fetch"] } } }' },
  { source: "opencode-json", text: '{ "mcp": { "docs": { "type": "remote", "url": "https://mcp.example.com/mcp" } } }' },
  { source: "server-object", text: '{ "type": "http", "url": "https://mcp.example.com/mcp" }' },
  { source: "server-map", text: '{ "fetch": { "command": "uvx", "args": ["mcp-server-fetch"] } }' },
  {
    source: "registry-server-json",
    text: '{ "name": "com.example/docs", "version": "1.0.0", "remotes": [{ "type": "streamable-http", "url": "https://mcp.example.com/mcp" }] }',
  },
  { source: "cursor-install-link", text: `cursor://anysphere.cursor-deeplink/mcp/install?name=fetch&config=${btoa(FETCH_CONFIG)}` },
  { source: "vscode-install-link", text: `vscode:mcp/install?${encodeURIComponent(FETCH_NAMED)}` },
  { source: "visual-studio-install-link", text: `vsweb+mcp:/install?${encodeURIComponent(FETCH_NAMED)}` },
  { source: "copilot-app-install-link", text: `ghapp://mcp/install?${encodeURIComponent(FETCH_NAMED)}` },
];

// ---------------------------------------------------------------------------
// Fields

/**
 * The values a field is part of, as they will be stored: the paste's fixed
 * text with `slot` where this field goes (`Bearer ‹your value›`, or
 * `Bearer ${GH_TOKEN}` for a variable) and `‹label›` where another field goes.
 * Undefined when the field makes up every value whole, unless `whole` is set:
 * the line would only repeat the box. It is what tells whether to type the
 * token or `Bearer` and the token.
 */
export function mcpFieldStoredAs(field: McpImportField, fields: readonly McpImportField[], slot: string, whole = false): string | undefined {
  if (!whole && field.targets.every(({ parts }) => parts.length === 1)) return undefined;
  const values = field.targets.map(({ parts }) => parts.map((part) => {
    if (typeof part === "string") return revealHiddenCharacters(part);
    if (part.field === field.id) return slot;
    return `‹${revealHiddenCharacters(fields.find(({ id }) => id === part.field)?.label ?? part.field)}›`;
  }).join(""));
  return [...new Set(values)].join(", ");
}

/** The header a blank optional field leaves out, when it fills exactly one. */
export function mcpFieldOptionalHeader(field: McpImportField): string | undefined {
  const names = new Set(field.targets.map(({ path }) => (path[0] === "headers" ? path[1] : undefined)));
  return names.size === 1 ? [...names][0] : undefined;
}

/** Whether a field may be answered with a host variable: only where pi resolves every value it fills (env, headers, `oauth.clientSecret`). */
export function mcpFieldTakesVariable(field: McpImportField): boolean {
  return field.kind !== "select" && field.targets.every((target) => isResolvedPath(target.path) && target.encoding === undefined);
}

/** The values the request sends: a host variable where the user chose one, else the text typed. */
export function mcpAddFieldValues(server: McpImportServer, draft: Pick<McpAddDraft, "values" | "references">): Record<string, McpImportFieldValue> {
  const values: Record<string, McpImportFieldValue> = {};
  for (const field of server.fields) {
    const reference = draft.references[field.id];
    if (reference !== undefined && mcpFieldTakesVariable(field)) values[field.id] = { reference };
    else if (draft.values[field.id] !== undefined) values[field.id] = draft.values[field.id];
  }
  return values;
}

const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Words as one variable name (`my-server`, `Api-Key` → `MY_SERVER_API_KEY`), or undefined when they make none. */
function variableNameOf(...words: string[]): string | undefined {
  const name = words
    .map((word) => word.replace(/[^A-Za-z0-9]+/g, "_"))
    .join("_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .toUpperCase();
  return VARIABLE_NAME.test(name) ? name : undefined;
}

/** A header whose value is a credential as a whole, so its variable is the server's token. */
const AUTHORIZATION_HEADER = /^(?:proxy-)?authorization$/i;

/**
 * The host variable the add pane offers for a value pi resolves, by its place
 * (a `secretPaths` label): an env value reads the variable of its own name,
 * as pi passes `GITHUB_TOKEN` on; a header or the OAuth client secret a name
 * made from the server's (`docs` with `Authorization` → `DOCS_TOKEN`,
 * `X-Api-Key` → `DOCS_API_KEY`, `DOCS_CLIENT_SECRET`). Only a valid variable
 * name, or undefined, so the box it fills never opens on a refusal; never
 * PI_WEB_PASSWORD, which Add refuses.
 */
export function mcpSuggestedVariableName(label: string, serverName: string): string | undefined {
  const name = suggestedVariableName(label, serverName);
  return name === WEB_PASSWORD_VARIABLE ? undefined : name;
}

function suggestedVariableName(label: string, serverName: string): string | undefined {
  if (label.startsWith("env.")) {
    const key = label.slice("env.".length);
    return VARIABLE_NAME.test(key) ? key : variableNameOf(key);
  }
  const named = (...words: string[]) => variableNameOf(serverName, ...words) ?? variableNameOf(...words);
  if (label.startsWith("headers.")) {
    const header = label.slice("headers.".length);
    return AUTHORIZATION_HEADER.test(header) ? named("TOKEN") : named(header.replace(/^x-/i, ""));
  }
  if (label === "oauth.clientSecret") return named("CLIENT_SECRET");
  return undefined;
}

/** The host variable offered for a field answered with one: by the place its value goes (`mcpSuggestedVariableName()`). */
export function mcpFieldSuggestedVariableName(field: McpImportField, serverName: string): string | undefined {
  const target = field.targets[0];
  return target ? mcpSuggestedVariableName(pathLabel(target.path), serverName) : undefined;
}

/**
 * Where the server would hold a literal secret once its fields are answered:
 * the paste's own literal secrets not read from a variable, and every
 * required password field not answered with a host variable, typed yet or
 * not. An optional field counts only once something is typed into it, since
 * left blank its value is left out. The route decides `secret-global-only`
 * from the same fill, so a Project option offered here is not refused there.
 */
export function mcpAddSecretPaths(
  server: McpImportServer,
  values: Readonly<Record<string, McpImportFieldValue>>,
  secretReferences: Readonly<Record<string, string>> = {},
): string[] {
  const assumed: Record<string, McpImportFieldValue | undefined> = {};
  for (const field of server.fields) {
    const given = values[field.id];
    // A variable still being named is a variable all the same: never a secret in the file.
    if (typeof given === "object") assumed[field.id] = VARIABLE_NAME.test(given.reference.trim()) ? given : { reference: "VALUE" };
    else if (given !== undefined && given.trim() !== "") assumed[field.id] = given;
    else if (field.defaultValue !== undefined) assumed[field.id] = field.defaultValue;
    else if (field.optional) assumed[field.id] = undefined;
    else assumed[field.id] = field.kind === "select" ? field.options?.[0] ?? "x" : "x";
  }
  const references = Object.fromEntries(Object.entries(secretReferences).map(([label, name]) => [label, VARIABLE_NAME.test(name.trim()) ? name : "VALUE"]));
  const filled = fillMcpImportFields(server, assumed, references);
  return filled.ok ? filled.secretPaths : [];
}

/** Whether a secret's place (a `secretPaths` label) is a value pi resolves, so the secret can be read from a variable there instead. */
export function mcpSecretPathTakesVariable(label: string): boolean {
  return label.startsWith("env.") || label.startsWith("headers.") || label === "oauth.clientSecret";
}

// ---------------------------------------------------------------------------
// Preview

export interface McpAddPreview {
  source: McpImportFormat;
  transport: "stdio" | "http";
  /** The command line or URL as it would be written, with only the values typed into password fields masked. */
  target: string;
  cwd?: string;
  envNames: string[];
  headerNames: string[];
  /** Values that run a shell command on every connection. */
  commandFields: McpConfigFieldRef[];
  /** Values that read variables of the host, by field. */
  variableReferences: McpVariableReference[];
  exposure?: McpExposure;
  enabled: boolean;
  /** Fields are still unanswered, so the preview shows their placeholders. */
  unfilled: boolean;
  masked: boolean;
}

/** The forms a typed password takes inside a value: as typed, escaped, or percent-encoded in a URL. */
function passwordForms(server: McpImportServer, values: Readonly<Record<string, McpImportFieldValue>>): string[] {
  const forms = new Set<string>();
  for (const field of server.fields) {
    const value = values[field.id];
    if (field.kind !== "password" || typeof value !== "string" || value.trim() === "") continue;
    const text = value.trim();
    forms.add(text);
    forms.add(text.replace(/\$/g, "$$$$"));
    forms.add(encodeURIComponent(text));
  }
  return [...forms].filter((form) => form !== "").sort((a, b) => b.length - a.length);
}

function hideForms(text: string, forms: readonly string[]): { text: string; masked: boolean } {
  let result = text;
  for (const form of forms) result = result.split(form).join(SECRET_MASK);
  return { text: result, masked: result !== text };
}

/** The field a resolved value sits in, as the listing names it. */
function fieldOf({ kind, name }: McpResolvedConfigValue): McpConfigFieldRef {
  return name === undefined ? { kind } : { kind, name };
}

/**
 * What Add would write, for the user to read before pressing it: the command
 * line or URL, the working folder, env and header names (never their
 * values), the values that run a shell command, and the host variables it
 * reads. An install link hides all of this in base64, which is why the
 * automatic test after Add only ever follows this preview, and why the
 * command line and URL are shown as written: masking what looks like a secret
 * (any value after `--token`, a long hex package name) would let whoever
 * wrote the link choose what the user cannot read before it runs, and the
 * pasted text is in the page already. Only what the user typed into a
 * password field is masked.
 */
export function mcpAddPreview(server: McpImportServer, values: Readonly<Record<string, McpImportFieldValue>>, fill?: McpImportFillResult): McpAddPreview {
  const config = fill?.ok ? fill.config : server.config;
  const forms = fill?.ok ? passwordForms(server, values) : [];
  const enabled = config.enabled !== false;
  const base = {
    source: server.source,
    // The values the SDK resolves, by the walk the server-side reader and the transport use.
    commandFields: resolvedConfigValues(config).filter(({ value }) => isCommandConfigValue(value)).map(fieldOf),
    variableReferences: resolvedConfigValues(config)
      .map((resolved) => ({ ...fieldOf(resolved), variables: configValueEnvVarNames(resolved.value) }))
      .filter(({ variables }) => variables.length > 0),
    ...(config.exposure ? { exposure: config.exposure } : {}),
    enabled,
    unfilled: !fill?.ok && server.fields.length > 0,
  };
  if ("url" in config) {
    const hidden = hideForms(config.url, forms);
    return {
      ...base,
      transport: "http",
      target: revealHiddenCharacters(hidden.text),
      envNames: [],
      headerNames: Object.keys(config.headers ?? {}),
      masked: hidden.masked,
    };
  }
  const line = hideForms(formatMcpCommandLine(config.command, config.args ?? []), forms);
  return {
    ...base,
    transport: "stdio",
    target: line.text,
    ...(config.cwd !== undefined ? { cwd: revealHiddenCharacters(config.cwd) } : {}),
    envNames: Object.keys(config.env ?? {}),
    headerNames: [],
    masked: line.masked,
  };
}

// ---------------------------------------------------------------------------
// Where it can go, and why Add waits

/** How a project server would be saved, or why it cannot be. */
export type McpAddProjectMode =
  /** A decision, exact or inherited, trusts the folder. */
  | { kind: "write" }
  /** A fresh folder: the route trusts it in the same step (`trustFolder`). */
  | { kind: "trust-and-write"; folder: string }
  | { kind: "blocked"; block: McpAddProjectBlock };

export type McpAddProjectBlock =
  | { kind: "no-project" }
  | { kind: "project-not-listed" }
  | { kind: "trust-unreadable" }
  /** Needs a trust decision first (Trust… where the trust dialog would offer it). */
  | { kind: "project-untrusted"; trustable: boolean }
  /** A decision marks the folder untrusted. */
  | { kind: "untrusted-decision" }
  | { kind: "trust-too-broad"; breadth: FreshFolderTrustBreadth }
  /** A fresh folder the step refuses: a link to nothing where the SDK looks would need trust once its target appears. */
  | { kind: "folder-not-fresh" }
  /** Literal secrets (`fields`); `fixed` when one sits where pi reads no variable (the URL, the command, its arguments). */
  | { kind: "secret"; fields: string[]; fixed: boolean }
  | { kind: "file-problem"; path: string; reason: McpConfigFileProblemReason };

/**
 * How a project server would be saved in the panel's project: written where a
 * decision trusts the folder (the rule of every project write), trusted and
 * written in one step for a fresh folder, or not at all, and why.
 */
export function mcpAddProjectMode(data: Pick<McpResponse, "project">, cwd: string | null): McpAddProjectMode {
  const blocked = (block: McpAddProjectBlock): McpAddProjectMode => ({ kind: "blocked", block });
  if (!cwd) return blocked({ kind: "no-project" });
  const project = data.project;
  if (!project) return blocked({ kind: "project-not-listed" });
  const trust = project.trust;
  if (!trust || trust.decisionError !== undefined) return blocked({ kind: "trust-unreadable" });
  if (trust.decision === true) return { kind: "write" };
  if (trust.decision === false) return blocked({ kind: "untrusted-decision" });
  if (trust.requiresTrust) return blocked({ kind: "project-untrusted", trustable: mcpProjectTrustable(project) });
  const trustFolder = project.trustFolder;
  if (!trustFolder) return blocked({ kind: "project-untrusted", trustable: false });
  if (!trustFolder.allowed) {
    return blocked(trustFolder.reason === "trust-too-broad" ? { kind: "trust-too-broad", breadth: trustFolder.breadth } : { kind: "folder-not-fresh" });
  }
  return { kind: "trust-and-write", folder: project.cwd };
}

/** A file whose problem keeps the writer from changing it. */
function fileBlock(scope: McpScope, data: Pick<McpResponse, "files">): McpAddProjectBlock | undefined {
  const file = data.files.find((item) => item.scope === scope);
  const problem = file?.problems.find(isBlockingFileProblem);
  return file && problem ? { kind: "file-problem", path: file.path, reason: problem.reason } : undefined;
}

/** Why Add cannot be used right now, most decisive first; `scope` means the scope's own block. */
export type McpAddSubmitBlock =
  | { kind: "mcp-off" }
  | { kind: "nothing" }
  | { kind: "name-invalid" }
  | { kind: "name-taken"; name: string; suggestedName: string; path?: string }
  /** Values still to fill in, by label. */
  | { kind: "fields"; fields: string[] }
  /** Values filled in that cannot be used (a variable name pi does not accept, an option not offered), by label. */
  | { kind: "field-invalid"; fields: string[] }
  /**
   * The config as filled in is one pi's validator refuses (a host typed into
   * the URL with a space): an `invalid-config` note, worded as the importer's.
   */
  | { kind: "config-invalid"; note: McpImportNote }
  | { kind: "web-password" }
  | { kind: "scope"; block: McpAddProjectBlock };

export interface McpAddAnalysis {
  parsed: McpImportResult;
  server?: McpImportServer;
  /** The name Add would save it under. */
  name: string;
  scope: McpScope;
  projectMode: McpAddProjectMode;
  /** Why the Project option is unavailable, shown under the scope switch. */
  projectBlock?: McpAddProjectBlock;
  values: Record<string, McpImportFieldValue>;
  /** The paste's own literal secrets that may be read from a variable instead, by label. */
  pasteSecrets: string[];
  /** Those the draft reads from a variable: the name typed, by label. */
  secretReferences: Record<string, string>;
  fill?: McpImportFillResult;
  /** Why a value filled in cannot be used, by field id or secret label: shown under it. */
  fieldProblems: Record<string, McpImportNote>;
  secretPaths: string[];
  preview?: McpAddPreview;
  submitBlock?: McpAddSubmitBlock;
  /** Add trusts the fresh folder in the same step. */
  trustFolder: boolean;
}

function namesIn(data: Pick<McpResponse, "servers">, scope: McpScope): string[] {
  return data.servers.filter((server) => server.scope === scope).map((server) => server.name);
}

/** Whether a value references PI_WEB_PASSWORD, which the route refuses as the transport would: the transport's own rule. */
function referencesWebPassword(config: McpServerConfig): boolean {
  return findWebPasswordField(config, { isCommandConfigValue, getConfigValueEnvVarNames: configValueEnvVarNames }) !== undefined;
}

/**
 * Everything the add pane shows for the draft: the paste parsed as the route
 * will parse it (derived names avoiding the names already in the file it goes
 * to), the server picked, the values sent, the preview, where it may go and
 * why Add waits. The route checks all of it again, and more.
 */
export function mcpAddAnalysis(draft: McpAddDraft, data: McpResponse, cwd: string | null): McpAddAnalysis {
  const projectMode = mcpAddProjectMode(data, cwd);
  const parseFor = (scope: McpScope) => parseMcpImport(draft.text, { rawPi: draft.rawPi, takenNames: namesIn(data, scope) });
  let parsed = parseFor(draft.scope ?? "global");
  let server = parsed.ok ? parsed.servers[Math.min(draft.server, parsed.servers.length - 1)] : undefined;
  // The paste's own hint (`pi mcp add -l`, `--scope project`) picks a project only where a decision
  // already trusts it: pasted text never preselects trusting a folder, which every folder inside inherits.
  const scope: McpScope = draft.scope ?? (server?.scopeHint === "project" && projectMode.kind === "write" ? "project" : "global");
  if (scope !== (draft.scope ?? "global")) {
    parsed = parseFor(scope);
    server = parsed.ok ? parsed.servers[Math.min(draft.server, parsed.servers.length - 1)] : undefined;
  }
  const empty: McpAddAnalysis = {
    parsed,
    name: draft.name ?? "",
    scope,
    projectMode,
    ...(projectMode.kind === "blocked" ? { projectBlock: projectMode.block } : {}),
    values: {},
    pasteSecrets: [],
    secretReferences: {},
    fieldProblems: {},
    secretPaths: [],
    trustFolder: false,
  };
  // MCP off keeps the preview: the user can still read what the paste holds.
  const writesOff = mcpWritesOff(data.mcp);
  if (!server) return { ...empty, submitBlock: { kind: writesOff ? "mcp-off" : "nothing" } };

  const name = draft.name ?? server.name;
  const values = mcpAddFieldValues(server, draft);
  const pasteSecrets = referenceableLiteralSecrets(server);
  const secretReferences = Object.fromEntries(pasteSecrets.flatMap((label) => {
    const reference = draft.secretReferences[label];
    return reference === undefined ? [] : [[label, reference]];
  }));
  const fill = fillMcpImportFields(server, values, secretReferences);
  const fieldProblems: Record<string, McpImportNote> = {};
  if (!fill.ok) {
    for (const note of fill.notes) {
      const id = note.params?.field;
      if (note.code !== "field-required" && typeof id === "string" && !(id in fieldProblems)) fieldProblems[id] = note;
    }
  }
  const secretPaths = mcpAddSecretPaths(server, values, secretReferences);
  const preview = mcpAddPreview(server, values, fill);
  // The parse checked the paste with its placeholders filled by samples; only now are the values the
  // user typed in place, and the route refuses what the SDK's validator refuses (`server-invalid`).
  const filledProblem = fill.ok ? validationProblem(name, fill.config) : undefined;
  const projectBlock: McpAddProjectBlock | undefined = projectMode.kind === "blocked"
    ? projectMode.block
    : secretPaths.length > 0
      ? { kind: "secret", fields: secretPaths, fixed: !secretPaths.every(mcpSecretPathTakesVariable) }
      : fileBlock("project", data);
  const taken = namesIn(data, scope);
  const file = data.files.find((item) => item.scope === scope);
  let submitBlock: McpAddSubmitBlock | undefined;
  if (writesOff) submitBlock = { kind: "mcp-off" };
  else if (!isValidServerName(name)) submitBlock = { kind: "name-invalid" };
  else if (taken.includes(name)) {
    submitBlock = { kind: "name-taken", name, suggestedName: suggestFreeName(name, taken), ...(file ? { path: file.path } : {}) };
  } else if (!fill.ok) {
    // A field by its label; one of the paste's secrets by where it sits.
    const labelOf = (note: McpImportNote) => {
      const id = String(note.params?.field ?? "");
      return server.fields.find((field) => field.id === id)?.label ?? id;
    };
    // A variable box still empty is asked for like any value not typed yet.
    const required = fill.notes.filter((note) => note.code === "field-required"
      || (note.code === "field-reference-invalid" && note.params?.problem === "missing"));
    submitBlock = required.length > 0
      ? { kind: "fields", fields: [...new Set(required.map(labelOf))] }
      : { kind: "field-invalid", fields: [...new Set(fill.notes.map(labelOf))] };
  } else if (filledProblem) {
    // A URL is shown as the preview shows it, so a password typed into it stays hidden.
    const params = filledProblem.problem === "url" ? { ...filledProblem, url: preview.target } : filledProblem;
    submitBlock = { kind: "config-invalid", note: { code: "invalid-config", params } };
  } else if (referencesWebPassword(fill.config)) submitBlock = { kind: "web-password" };
  else if (scope === "project" && projectBlock) submitBlock = { kind: "scope", block: projectBlock };
  else {
    const block = fileBlock(scope, data);
    if (block) submitBlock = { kind: "scope", block };
  }
  // The paste's own hint gives way to a project the server cannot go to (a literal secret in it).
  if (draft.scope === undefined && scope === "project" && projectBlock) return mcpAddAnalysis({ ...draft, scope: "global" }, data, cwd);
  return {
    parsed,
    server,
    name,
    scope,
    projectMode,
    ...(projectBlock ? { projectBlock } : {}),
    values,
    pasteSecrets,
    secretReferences,
    fill,
    fieldProblems,
    secretPaths,
    preview,
    ...(submitBlock ? { submitBlock } : {}),
    trustFolder: scope === "project" && projectMode.kind === "trust-and-write",
  };
}

/** The body of `POST /api/mcp { action: "add" }` for an analysis Add may send; the route parses the text again. */
export function mcpAddRequest(draft: McpAddDraft, analysis: McpAddAnalysis, confirmHostEnv?: readonly string[]) {
  return {
    action: "add" as const,
    text: draft.text,
    values: analysis.values,
    ...(Object.keys(analysis.secretReferences).length > 0 ? { secretReferences: { ...analysis.secretReferences } } : {}),
    server: analysis.server && analysis.parsed.ok ? analysis.parsed.servers.indexOf(analysis.server) : 0,
    name: analysis.name,
    scope: analysis.scope,
    rawPi: draft.rawPi,
    ...(analysis.trustFolder ? { trustFolder: true } : {}),
    ...(confirmHostEnv && confirmHostEnv.length > 0 ? { confirmHostEnv: [...confirmHostEnv] } : {}),
  };
}

/** The visible reason under the scope switch while Project is unavailable. */
export function mcpAddProjectBlockText(block: McpAddProjectBlock, t: Translate, displayPath: (path: string) => string): string {
  switch (block.kind) {
    case "trust-too-broad":
      return t(MCP_ADD_BREADTH_KEYS[block.breadth.kind], { path: displayPath(block.breadth.path) });
    case "secret":
      return t(block.fixed ? "mcp.add.projectBlocked.secretFixed" : "mcp.add.projectBlocked.secret", { fields: block.fields.join(", ") });
    case "file-problem":
      return t("mcp.add.projectBlocked.file-problem", { path: displayPath(block.path), reason: t(`mcp.fileProblem.${block.reason}`) });
    default:
      return t(MCP_ADD_PROJECT_BLOCK_KEYS[block.kind]);
  }
}

export const MCP_ADD_PROJECT_BLOCK_KEYS: Record<Exclude<McpAddProjectBlock["kind"], "trust-too-broad" | "secret" | "file-problem">, string> = {
  "no-project": "mcp.add.projectBlocked.no-project",
  "project-not-listed": "mcp.add.projectBlocked.project-not-listed",
  "trust-unreadable": "mcp.add.projectBlocked.trust-unreadable",
  "project-untrusted": "mcp.add.projectBlocked.project-untrusted",
  "untrusted-decision": "mcp.add.projectBlocked.untrusted-decision",
  "folder-not-fresh": "mcp.add.projectBlocked.folder-not-fresh",
};

export const MCP_ADD_BREADTH_KEYS: Record<FreshFolderTrustBreadth["kind"], string> = {
  home: "mcp.add.projectBlocked.trust-too-broad.home",
  root: "mcp.add.projectBlocked.trust-too-broad.root",
  "contains-home": "mcp.add.projectBlocked.trust-too-broad.contains-home",
  "contains-agent-dir": "mcp.add.projectBlocked.trust-too-broad.contains-agent-dir",
  "contains-folder": "mcp.add.projectBlocked.trust-too-broad.contains-folder",
  "contains-project": "mcp.add.projectBlocked.trust-too-broad.contains-project",
  "too-many-folders": "mcp.add.projectBlocked.trust-too-broad.too-many-folders",
};
