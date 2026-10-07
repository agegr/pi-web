import type { McpServerConfig } from "@earendil-works/pi-coding-agent";
import { parseJsonc } from "./jsonc";
import { readCommandLine } from "./mcp-import-cli";
import {
  configValueEnvVarNames,
  escapeConfigValue,
  finishDraft,
  isResolvedPath,
  isValidServerName,
  type McpImportNote,
  type McpImportOptions,
  type McpImportPath,
  type McpImportResult,
  type McpImportServer,
  nameFromCommand,
  nameFromUrl,
  pathKey,
  pathLabel,
  sanitizeServerName,
  suggestFreeName,
  validationProblem,
} from "./mcp-import-core";
import { type EntryOutcome, readJsonServers } from "./mcp-import-json";
import { readLink } from "./mcp-import-links";
import { literalSecretFields, maskArgs } from "./mcp-secrets";
import { splitShellWords, type ShellWordsError } from "./shell-words";

/**
 * The paste box of Settings › MCP (ADR 0006): turns a URL, a command line,
 * `pi | claude | codex | gemini mcp add …`, Claude / Cursor / VS Code / Zed /
 * opencode JSON, or a Cursor or VS Code install link into pi `mcp.json`
 * entries. Pure, so the browser preview and the server's re-parse agree; the
 * server still validates the filled-in result with the SDK's
 * `validateMcpServerConfig` before writing.
 *
 * Safety rules every format follows:
 * - A fresh pi object is built from known keys only; every dropped key gets
 *   a note. The SDK validator returns whatever object it is given.
 * - Other clients store literal values. pi resolves `${NAME}`, `$NAME` and a
 *   leading `!command` in env values, header values and `oauth.clientSecret`,
 *   so literals there are escaped (`$` → `$$`, a leading `!` → `$!`); copied
 *   unchanged, a value starting with `!` would run as a shell command on the
 *   Pi Web host at every connection. command, args, url and cwd are used raw
 *   by the SDK and are never escaped. Only `pi mcp add` and the "this is a pi
 *   config" toggle keep values as written, and a `!command` is then noted.
 * - References are translated into pi's `${NAME}` (`${env:X}`, `{env:X}`,
 *   `%X%`, Gemini's `$X`) only in those resolved fields; anywhere else pi
 *   substitutes nothing, so a reference there becomes a field to fill in.
 * - Which values are literal secrets, and which fields are password fields,
 *   follows `lib/mcp-secrets.ts`, the helper the Settings panel masks with,
 *   so the preview, the server's project-scope refusal and the panel agree.
 * - A server name pi accepts is kept as written; an invalid one is
 *   sanitized. A derived name avoids `takenNames`; a name the source chose
 *   that is already taken is kept and noted (`name-taken`).
 * - Notes are `{ code, params }`, rendered by the panel through i18n.
 */

export * from "./mcp-import-core";
export { decodeBase64Utf8 } from "./mcp-import-links";

type ReadResult = { entries: EntryOutcome[]; notes: McpImportNote[] } | { error: McpImportNote };

const INVISIBLE = /[\u200B-\u200D\u2060\uFEFF]/g;

/** Strips what copying from a page adds: a code fence, a Markdown link around the address, `<…>`. */
function normalizePaste(text: string): string {
  let input = text.replace(INVISIBLE, "").replace(/\u00A0/g, " ").trim();
  const fenced = /```[^\n]*\n([\s\S]*?)(?:```|$)/.exec(input);
  if (fenced) input = fenced[1].trim();
  else if (/^`[^`\n]+`$/.test(input)) input = input.slice(1, -1).trim();
  // `[![Install](badge.svg)](https://…)`: the link is the last target.
  const markdownLink = input.startsWith("[") ? /\]\(([^()\s]+)\)\s*$/.exec(input) : null;
  if (markdownLink) input = markdownLink[1];
  if (/^<\S+>$/.test(input)) input = input.slice(1, -1);
  return input;
}

function looksLikeJson(input: string): boolean {
  return input.startsWith("{") || input.startsWith("[") || /^"[^"\n]+"\s*:/.test(input);
}

/** `localhost:3000/mcp`: a loopback address typed without its scheme. */
const LOOPBACK_WITHOUT_SCHEME = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:[/?#]\S*)?$/i;

/** One word with a scheme of two or more letters, so `C:\path` is not an address. */
function looksLikeLink(input: string): boolean {
  return !/\s/.test(input) && /^[A-Za-z][A-Za-z0-9+.-]+:/.test(input);
}

function readJsonPaste(input: string, rawPi: boolean): ReadResult {
  let value: unknown;
  try {
    value = parseJsonc(input);
  } catch (error) {
    // A fragment copied from inside `mcpServers`: `"github": { … },`.
    try {
      value = parseJsonc(`{${input.replace(/,\s*$/, "")}}`);
    } catch {
      return { error: { code: "invalid-json", params: { detail: error instanceof Error ? error.message : String(error) } } };
    }
  }
  return readJsonServers(value, rawPi);
}

const SHELL_ERROR_NOTES: Record<ShellWordsError["code"], McpImportNote["code"]> = {
  "unterminated-quote": "shell-unterminated-quote",
  "shell-operator": "shell-operator",
  "command-substitution": "shell-command-substitution",
  "multiple-commands": "shell-multiple-commands",
  "shell-parameter": "shell-parameter",
  "unsupported-expansion": "shell-expansion",
};

function shellErrorNote(error: ShellWordsError): McpImportNote {
  const { code, ...params } = error;
  return Object.keys(params).length > 0
    ? { code: SHELL_ERROR_NOTES[code], params: params as Record<string, string> }
    : { code: SHELL_ERROR_NOTES[code] };
}

/** Undoes what documentation pages do to a command: a shell prompt, curly quotes, an em dash for `--`. */
function normalizeCommandLine(input: string): string {
  return input
    .replace(/^(?:\$|%|>|❯|PS [^\n>]*>)[ \t]+/, "")
    .replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"')
    .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'")
    .replace(/(^|\s)[\u2013\u2014](?=\S)/g, "$1--")
    .replace(/(^|\s)[\u2013\u2014](?=\s|$)/g, "$1--");
}

function readCommandLinePaste(input: string): ReadResult {
  const split = splitShellWords(normalizeCommandLine(input));
  if (!split.ok) return { error: shellErrorNote(split.error) };
  if (split.words.length === 0) return { error: { code: "empty-input" } };
  return readCommandLine(split.words);
}

/** A name for a server its source did not name. */
function deriveName(config: McpServerConfig): string {
  if ("url" in config) return nameFromUrl(config.url);
  const args = config.args ?? [];
  const bridged = args.some((arg) => /^mcp-remote(?:@|$)/.test(arg)) ? args.find((arg) => /^https?:\/\//i.test(arg)) : undefined;
  return (bridged && nameFromUrl(bridged)) || nameFromCommand(config.command, args);
}

/**
 * The config with addresses that still hold a field replaced by a stand-in,
 * so `https://<your-host>/mcp` is not refused before the user filled it in;
 * the filled-in config is validated again on the server.
 */
function withFilledPlaceholders(server: McpImportServer): McpServerConfig {
  const paths = fieldPaths(server);
  const config = JSON.parse(JSON.stringify(server.config)) as Record<string, unknown>;
  if (paths.has(pathKey(["url"]))) config.url = "https://placeholder.invalid/";
  const oauth = config.oauth as Record<string, unknown> | undefined;
  if (oauth && paths.has(pathKey(["oauth", "callbackUrl"]))) delete oauth.callbackUrl;
  return config as unknown as McpServerConfig;
}

function fieldPaths(server: McpImportServer): Set<string> {
  return new Set(server.fields.flatMap((field) => field.targets.map((target) => pathKey(target.path))));
}

/** Notes that depend on the finished config: literal secrets, header references to the host's environment. */
function noteFinishedConfig(server: McpImportServer): void {
  const withFields = fieldPaths(server);
  for (const path of findLiteralSecretPaths(server.config)) {
    if (!withFields.has(pathKey(path))) server.notes.push({ code: "literal-secret", params: { field: pathLabel(path) } });
  }
  const config = server.config;
  if ("url" in config) {
    // These values are sent to the server (or its authorization server), so a
    // reference reads the Pi Web host's environment out to a remote party.
    for (const [header, value] of Object.entries(config.headers ?? {})) {
      const names = configValueEnvVarNames(value);
      if (names.length > 0) server.notes.push({ code: "header-env-reference", params: { header, names: names.join(", ") } });
    }
    const secretNames = configValueEnvVarNames(config.oauth?.clientSecret ?? "");
    if (secretNames.length > 0) server.notes.push({ code: "client-secret-env-reference", params: { names: secretNames.join(", ") } });
  }
}

/**
 * Parses pasted text into pi MCP server entries. `ok: false` means nothing
 * could be imported; `ok: true` may still carry top-level notes about entries
 * that were skipped (each names its `server`). Never throws, whatever the
 * text: the server route re-runs it on the request body.
 */
export function parseMcpImport(text: string, options: McpImportOptions = {}): McpImportResult {
  const input = normalizePaste(text);
  if (!input) return { ok: false, notes: [{ code: "empty-input" }] };
  let read: ReadResult;
  if (looksLikeJson(input)) {
    read = readJsonPaste(input, options.rawPi === true);
  } else if (LOOPBACK_WITHOUT_SCHEME.test(input)) {
    read = readLink(`http://${input}`);
    if (!("error" in read)) {
      for (const entry of read.entries) if ("draft" in entry) entry.draft.note("scheme-assumed", { url: `http://${input}` });
    }
  } else {
    read = looksLikeLink(input) ? readLink(input) : readCommandLinePaste(input);
  }
  if ("error" in read) return { ok: false, notes: [read.error] };

  const notes = [...read.notes];
  const servers: McpImportServer[] = [];
  const taken = [...(options.takenNames ?? [])];
  const inPaste = new Set<string>();
  for (const entry of read.entries) {
    if ("note" in entry) {
      notes.push(entry.note);
      continue;
    }
    const finished = finishDraft(entry.draft);
    if ("note" in finished) {
      notes.push(finished.note);
      continue;
    }
    const server = finished.server;
    let original = server.name;
    const derived = !original;
    if (derived) {
      original = deriveName(server.config);
      if (original) server.notes.push({ code: "name-derived", params: { name: original } });
    }
    // A name pi accepts is kept as written (`pi mcp add _x` writes `_x`); only an invalid one is rewritten.
    let name = isValidServerName(original) ? original : sanitizeServerName(original) || "server";
    if (name !== original && original) {
      server.originalName = server.originalName ?? original;
      server.notes.push({ code: "name-sanitized", params: { original, name } });
    }
    // A derived name avoids every name in use. A name the source chose only
    // avoids the others in this paste: one already in mcp.json is reported, so
    // the panel can ask for another instead of silently adding `name-2`.
    const free = suggestFreeName(name, derived ? [...taken, ...inPaste] : inPaste);
    if (free !== name) {
      server.notes.push({ code: "name-deduplicated", params: { original: name, name: free } });
      name = free;
    }
    if (!derived && taken.includes(name)) {
      server.notes.push({ code: "name-taken", params: { name, suggestedName: suggestFreeName(name, [...taken, ...inPaste]) } });
    }
    server.name = name;
    const problem = validationProblem(name, withFilledPlaceholders(server));
    if (problem) {
      notes.push({ code: "invalid-config", params: { server: name, ...problem } });
      continue;
    }
    noteFinishedConfig(server);
    inPaste.add(name);
    servers.push(server);
  }
  if (servers.length === 0) return { ok: false, notes: notes.length > 0 ? notes : [{ code: "no-servers-found" }] };
  return { ok: true, servers, notes };
}

// ---------------------------------------------------------------------------
// Filling in fields

/**
 * What the user gives a field: the text itself, or the name of an environment
 * variable on the Pi Web host, stored as a `${NAME}` reference instead of the
 * secret (only in a value pi resolves: an env value, a header value,
 * `oauth.clientSecret`).
 */
export type McpImportFieldValue = string | { reference: string };

export type McpImportFillResult =
  | { ok: true; config: McpServerConfig; secretPaths: string[] }
  | { ok: false; notes: McpImportNote[] };

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

type FilledValue = { text: string } | { reference: string };

function encodeFieldValue(value: FilledValue, path: McpImportPath, first: boolean, encoding: "uri-component" | undefined): string {
  if ("reference" in value) return `\${${value.reference}}`;
  if (encoding === "uri-component") return encodeURIComponent(value.text);
  if (!isResolvedPath(path)) return value.text;
  return escapeConfigValue(value.text, { atStart: first });
}

function setPath(config: Record<string, unknown>, path: McpImportPath, value: string | undefined): void {
  const [key, sub] = path;
  if (key === "command" || key === "url" || key === "cwd") {
    if (value !== undefined) config[key] = value;
    return;
  }
  if (key === "args") {
    (config.args as string[])[sub as number] = value ?? "";
    return;
  }
  const record = { ...((config[key] as Record<string, unknown> | undefined) ?? {}) };
  if (value === undefined) delete record[sub as string];
  else record[sub as string] = value;
  if (Object.keys(record).length === 0) delete config[key];
  else config[key] = record;
}

function readPath(config: Record<string, unknown>, path: McpImportPath): unknown {
  const [key, sub] = path;
  const value = config[key];
  if (sub === undefined || typeof value !== "object" || value === null) return sub === undefined ? value : undefined;
  return (value as Record<string | number, unknown>)[sub];
}

/** The literal secrets of a server that no field fills, in a value pi resolves: these may become a `${NAME}` reference. */
function referenceableSecretPaths(server: McpImportServer): McpImportPath[] {
  const withFields = fieldPaths(server);
  return findLiteralSecretPaths(server.config).filter((path) => isResolvedPath(path) && !withFields.has(pathKey(path)));
}

/**
 * The paste's own literal secrets that may be stored as a `${NAME}` reference
 * instead (ADR 0006, "Secrets typed in the panel"), by label
 * (`env.API_KEY`, `headers.Authorization`, `oauth.clientSecret`): those in a
 * value pi resolves that no field fills. A secret in the URL, the command or
 * its arguments cannot be, since pi reads no variable there; a field's value
 * takes a reference through the field.
 */
export function referenceableLiteralSecrets(server: McpImportServer): string[] {
  return referenceableSecretPaths(server).map(pathLabel);
}

/**
 * Why a variable name given for a reference is refused: `missing` while
 * nothing is typed yet (the box was just shown), `name` for text that is not
 * a variable name, or anything that is not text.
 */
function referenceNameProblem(given: unknown): "missing" | "name" {
  return typeof given === "string" && given.trim() === "" ? "missing" : "name";
}

/** An authorization scheme a header value starts with; a stored reference keeps it (`Bearer ${TOKEN}`). */
const AUTHORIZATION_SCHEME = /^(?:bearer|basic|token)\s+/i;

/**
 * The server's config with the user's values filled in. Values typed into a
 * field pi resolves are escaped like any literal, so a password containing
 * `$` or starting with `!` is stored as typed; a `{ reference }` is stored as
 * `${NAME}` instead. A blank optional field removes the value it belongs to.
 * `secretReferences` stores one of the paste's own literal secrets
 * (`referenceableLiteralSecrets()`, by label) as `${NAME}` instead of the
 * secret, after the authorization scheme of a header value (`Bearer
 * ${NAME}`). `secretPaths` lists every literal secret in the result (typed
 * password fields included, references not), which keeps the entry global.
 */
export function fillMcpImportFields(
  server: McpImportServer,
  values: Readonly<Record<string, McpImportFieldValue | undefined>>,
  secretReferences: Readonly<Record<string, string>> = {},
): McpImportFillResult {
  const config = JSON.parse(JSON.stringify(server.config)) as Record<string, unknown>;
  const filled = new Map<string, FilledValue | undefined>();
  const notes: McpImportNote[] = [];
  const referenceable = new Map(referenceableSecretPaths(server).map((path) => [pathLabel(path), path]));
  const stored: [McpImportPath, string][] = [];
  for (const [label, given] of Object.entries(secretReferences)) {
    const name = typeof given === "string" ? given.trim() : "";
    const path = referenceable.get(label);
    if (!path) notes.push({ code: "field-reference-invalid", params: { field: label, problem: "target" } });
    else if (!ENV_NAME.test(name)) notes.push({ code: "field-reference-invalid", params: { field: label, problem: referenceNameProblem(given) } });
    else stored.push([path, name]);
  }
  for (const field of server.fields) {
    const given: unknown = values[field.id];
    if (typeof given === "object" && given !== null) {
      const reference = (given as { reference?: unknown }).reference;
      const name = typeof reference === "string" ? reference.trim() : "";
      if (!ENV_NAME.test(name)) {
        notes.push({ code: "field-reference-invalid", params: { field: field.id, problem: referenceNameProblem(reference) } });
      } else if (field.kind === "select" || !field.targets.every((target) => isResolvedPath(target.path) && target.encoding === undefined)) {
        // pi substitutes nothing in command, args, url or cwd.
        notes.push({ code: "field-reference-invalid", params: { field: field.id, problem: "target" } });
      } else {
        filled.set(field.id, { reference: name });
      }
      continue;
    }
    const value = (typeof given === "string" ? given : field.defaultValue ?? "").trim();
    if (value === "") {
      if (field.optional) filled.set(field.id, undefined);
      else notes.push({ code: "field-required", params: { field: field.id } });
    } else if (field.kind === "select" && field.options && !field.options.includes(value)) {
      notes.push({ code: "field-invalid-option", params: { field: field.id } });
    } else {
      filled.set(field.id, { text: value });
    }
  }
  if (notes.length > 0) return { ok: false, notes };

  const secretPaths = new Set<string>();
  const done = new Set<string>();
  for (const field of server.fields) {
    for (const target of field.targets) {
      const value = filled.get(field.id);
      if (field.kind === "password" && value !== undefined && "text" in value) secretPaths.add(pathLabel(target.path));
      const key = pathKey(target.path);
      if (done.has(key)) continue;
      done.add(key);
      const blank = target.parts.some((part) => typeof part !== "string" && filled.get(part.field) === undefined);
      if (blank) {
        setPath(config, target.path, undefined);
        continue;
      }
      let output = "";
      for (const part of target.parts) {
        output += typeof part === "string"
          ? part
          : encodeFieldValue(filled.get(part.field)!, target.path, output === "", target.encoding);
      }
      setPath(config, target.path, output);
    }
  }
  for (const [path, name] of stored) {
    const current = readPath(config, path);
    const scheme = path[0] === "headers" && typeof current === "string" ? current.match(AUTHORIZATION_SCHEME)?.[0] ?? "" : "";
    setPath(config, path, `${scheme}\${${name}}`);
  }
  const result = config as unknown as McpServerConfig;
  for (const path of findLiteralSecretPaths(result)) secretPaths.add(pathLabel(path));
  return { ok: true, config: result, secretPaths: [...secretPaths] };
}

// ---------------------------------------------------------------------------
// Literal secrets

const PATH_ORDER = ["command", "args", "env", "cwd", "url", "headers", "oauth"];

/**
 * Where a config holds a credential as literal text rather than a `${NAME}`
 * reference or a `!command`, by the rules of `lib/mcp-secrets.ts`
 * (`literalSecretFields`), which the Settings panel also masks by: secret-named
 * or secret-looking env and header values, a literal `oauth.clientSecret`,
 * credentials in the URL (userinfo, query, a token in the path) and in the
 * command or its arguments (`--token X`, `-e TOKEN=x`, `--header
 * "Authorization: Bearer …"`, a connection URL with a password). Such an
 * entry is saved globally only.
 */
export function findLiteralSecretPaths(config: McpServerConfig): McpImportPath[] {
  const paths: McpImportPath[] = [];
  for (const field of literalSecretFields(config)) {
    switch (field.kind) {
      case "env":
        paths.push(["env", field.name]);
        break;
      case "header":
        paths.push(["headers", field.name]);
        break;
      case "oauth-client-secret":
        paths.push(["oauth", "clientSecret"]);
        break;
      case "url":
        paths.push(["url"]);
        break;
      case "command":
        paths.push(["command"]);
        break;
      case "args": {
        const args = "args" in config && Array.isArray(config.args) ? config.args.map((arg) => (typeof arg === "string" ? arg : "")) : [];
        maskArgs(args).args.forEach((masked, index) => {
          if (masked !== args[index]) paths.push(["args", index]);
        });
        break;
      }
    }
  }
  return paths.sort((a, b) => PATH_ORDER.indexOf(a[0]) - PATH_ORDER.indexOf(b[0]));
}

