import { closeSync, constants, existsSync, fstatSync, lstatSync, openSync, readFileSync, readSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { CONFIG_DIR_NAME, type McpServerConfig } from "@earendil-works/pi-coding-agent";
import type {
  CodemodeSandboxStatus,
  McpAvailability,
  McpCodemodeInfo,
  McpConfigFieldRef,
  McpConfigFileInfo,
  McpConfigFileProblem,
  McpProjectInfo,
  McpResponse,
  McpScope,
  McpServerInfo,
  McpTransportKind,
  McpVariableReference,
} from "./api-types";
import {
  isMcpDisabledByOperator,
  MCP_DISABLE_VARIABLE,
  peekCodemodeSandbox,
  readBuiltinExtensionSwitches,
  type BuiltinExtensionName,
  type BuiltinExtensionSwitch,
} from "./builtin-extensions";
import {
  CODEMODE_INLINE_BUDGET_DEFAULT,
  CODEMODE_INLINE_BUDGET_MAX,
  readCodemodePreference,
  readCodemodeSettings,
  readProjectCodemodeInlineBudget,
  readProjectCodemodeMode,
  readProjectCodemodeOverride,
} from "./codemode-settings";
import { getGlobalSettingsPath } from "./global-settings-file";
import { mcpConfigKey, mcpEntryConfigKey } from "./mcp-config-key";
import { jsonErrorMessage } from "./mcp-json-error";
import { maskArgs, maskCommand, maskUrl } from "./mcp-secrets";
import { mcpOAuthStoreKeys } from "./mcp-sign-out";
import { readMcpHostInactive, withMcpStatuses } from "./mcp-status";
import { findWebPasswordField, resolvedConfigValues, WEB_PASSWORD_VARIABLE } from "./mcp-transport";
import { samePath } from "./paths";
import { hasParentDirectorySegment, isPathWithinRoots, resolveRealRoots } from "./path-security";
import { loadPiSdkInternals, type PiSdkInternals } from "./pi-sdk-internals";
import { freshFolderTrustBreadth, getProjectTrustStatus, hasTrustRelevantEntries } from "./project-trust";

// What Settings › MCP and the trust dialog list (ADR 0006): the entries of the
// global `mcp.json` and of a project's `.pi/mcp.json`, read from the files
// only. Nothing here spawns a process, opens a connection, or resolves a
// value — no `${VAR}` is expanded and no `!command` runs — so it never calls
// the SDK's transport, its value resolvers, `oauthSettings()`, or its OAuth
// credential store, which creates `mcp-auth.json` and a lock just to read it.
//
// The SDK's `loadMcpConfig()` cannot serve: it reads the project file only once
// the project is trusted, and merges by name, so a project entry hides the
// global one it replaces. Each file is read and parsed here as the SDK reads
// it, and each entry checked with the SDK's own validator.

export type McpConfigReadInternals = Pick<
  PiSdkInternals,
  "validateMcpServerConfig" | "isCommandConfigValue" | "getConfigValueEnvVarNames"
>;

export function globalMcpConfigPath(agentDir: string): string {
  return join(agentDir, "mcp.json");
}

export function projectMcpConfigPath(cwd: string): string {
  return join(cwd, CONFIG_DIR_NAME, "mcp.json");
}

// `configKey`, which statuses are compared against: an HMAC of the entry's
// canonical JSON, never the JSON (`lib/mcp-config-key.ts`).
export { mcpConfigKey };
// The parser's message without the text it quotes (`lib/mcp-json-error.ts`).
export { jsonErrorMessage };

/** The largest project file that is parsed; it comes from a repository nobody may have trusted. */
export const PROJECT_MCP_CONFIG_MAX_BYTES = 1024 * 1024;
/**
 * The most servers a project file may declare to be listed. A repository's
 * file of 1 MiB holds tens of thousands of names, each of which would be
 * validated, hashed and sent to the panel (tens of megabytes) and to the trust
 * dialog; past this the file is reported as a problem instead, as one over
 * 1 MiB is.
 */
export const MCP_PROJECT_MAX_SERVERS = 200;
/** Windows defines neither flag; it has no FIFOs, and the real-path check still refuses a link that leads outside. */
const OPEN_FLAGS = constants.O_RDONLY | (constants.O_NONBLOCK || 0) | (constants.O_NOFOLLOW || 0);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

function realPathOr(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function problem(info: McpConfigFileInfo, reason: McpConfigFileProblem["reason"], error: string): void {
  info.problems.push({ reason, error });
}

/** What reading a resolved path gave: the text and the file's permission bits, or why it was not read. */
export type ResolvedConfigFileRead =
  | { ok: true; text: string; mode: number }
  | { ok: false; reason: Extract<McpConfigFileProblem["reason"], "not-a-file" | "too-large" | "unreadable">; error: string; code?: string };

/**
 * Read the file at `realPath`, which has no link left in it: opened once
 * without following a link swapped in since and without blocking on a FIFO,
 * then checked through what was opened. A FIFO or a device is never read.
 * The `mcp.json` writer (`lib/mcp-config-file.ts`) reads through this too.
 */
export function readResolvedConfigFile(realPath: string, maxBytes: number | undefined): ResolvedConfigFileRead {
  let fd: number | undefined;
  try {
    fd = openSync(realPath, OPEN_FLAGS);
    const stats = fstatSync(fd);
    const mode = stats.mode & 0o777;
    if (!stats.isFile()) return { ok: false, reason: "not-a-file", error: "not a regular file" };
    if (maxBytes === undefined) return { ok: true, text: readFileSync(fd, "utf8"), mode };
    if (stats.size > maxBytes) return { ok: false, reason: "too-large", error: `larger than ${maxBytes} bytes` };
    // One byte past the limit: a file still growing past it is not parsed.
    const limit = maxBytes + 1;
    const chunks: Buffer[] = [];
    let length = 0;
    while (length < limit) {
      const chunk = Buffer.alloc(Math.min(limit - length, 64 * 1024));
      const read = readSync(fd, chunk, 0, chunk.length, null);
      if (read === 0) break;
      chunks.push(chunk.subarray(0, read));
      length += read;
    }
    if (length > maxBytes) return { ok: false, reason: "too-large", error: `larger than ${maxBytes} bytes` };
    return { ok: true, text: Buffer.concat(chunks, length).toString("utf8"), mode };
  } catch (error) {
    const code = errorCode(error);
    return { ok: false, reason: "unreadable", error: errorMessage(error), ...(code ? { code } : {}) };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function readResolvedFile(realPath: string, info: McpConfigFileInfo, maxBytes: number | undefined): string | undefined {
  const read = readResolvedConfigFile(realPath, maxBytes);
  info.exists = true;
  if (read.ok) return read.text;
  problem(info, read.reason, read.error);
  return undefined;
}

/**
 * The global file is the user's own: a symbolic link is followed wherever it
 * leads, and a dangling one reads as no file, as it does for the SDK.
 */
function readGlobalFile(agentDir: string): { info: McpConfigFileInfo; text?: string } {
  const path = globalMcpConfigPath(agentDir);
  const info: McpConfigFileInfo = { scope: "global", path, exists: false, problems: [] };
  let realPath: string;
  try {
    realPath = realpathSync(path);
  } catch (error) {
    if (errorCode(error) !== "ENOENT") {
      info.exists = true;
      problem(info, "unreadable", errorMessage(error));
    }
    return { info };
  }
  if (!samePath(realPath, join(realPathOr(agentDir), "mcp.json"))) info.realPath = realPath;
  return { info, text: readResolvedFile(realPath, info, undefined) };
}

/**
 * The project file is whatever the repository committed, and may be read
 * before anyone trusted it. A link, in the file or in a folder above it, is
 * followed only when its real path stays inside `allowedRoots` (the folders
 * `/api/files` may read); a dangling one is refused rather than read as no
 * file. The same rule as the rest of the file access allow-list: a link is
 * authorized by where it resolves.
 */
/** Where a project's `.pi/mcp.json` leads under the link rule, before anything is read from it. */
export type ProjectMcpConfigLocation =
  | { kind: "found"; path: string; realPath: string }
  | { kind: "missing"; path: string }
  | {
      kind: "refused";
      path: string;
      /** Where the link leads, when it leads somewhere. */
      realPath?: string;
      reason: Extract<McpConfigFileProblem["reason"], "link-dangling" | "link-outside" | "unreadable">;
      error: string;
    };

function isSymbolicLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    // Missing, or a folder above it is missing or a dangling link.
    return false;
  }
}

/**
 * The project file under the link rule: its real path, a link in the file or
 * in `.pi/` above it included, must be inside `allowedRoots`, and a dangling
 * link is refused rather than taken for a missing file. Settings › MCP reads,
 * and `lib/mcp-config-file.ts` writes, only what this lets through.
 */
export function locateProjectMcpConfig(cwd: string, allowedRoots: Set<string>): ProjectMcpConfigLocation {
  const path = projectMcpConfigPath(cwd);
  if (hasParentDirectorySegment(path)) return { kind: "refused", path, reason: "unreadable", error: "the path has a .. segment" };
  let realPath: string;
  try {
    realPath = realpathSync(path);
  } catch (error) {
    if (isSymbolicLink(path)) return { kind: "refused", path, reason: "link-dangling", error: "a symbolic link to nothing" };
    if (errorCode(error) !== "ENOENT") return { kind: "refused", path, reason: "unreadable", error: errorMessage(error) };
    return { kind: "missing", path };
  }
  if (!isPathWithinRoots(realPath, resolveRealRoots(allowedRoots))) {
    return { kind: "refused", path, realPath, reason: "link-outside", error: "a symbolic link outside the folders Pi Web may read" };
  }
  return { kind: "found", path, realPath };
}

/**
 * Where a project file that does not exist yet would be created, under the
 * same rule: inside the real `.pi/` folder when there is one, which must
 * resolve inside `allowedRoots` (a dangling `.pi` link is refused), else in a
 * `.pi/` the writer creates in the project folder's real path.
 */
export function projectMcpConfigCreatePath(
  cwd: string,
  allowedRoots: Set<string>,
): { ok: true; realPath: string } | { ok: false; reason: "link-dangling" | "link-outside" | "unreadable"; error: string } {
  const dir = join(cwd, CONFIG_DIR_NAME);
  if (hasParentDirectorySegment(dir)) return { ok: false, reason: "unreadable", error: "the path has a .. segment" };
  let realDir: string;
  try {
    realDir = realpathSync(dir);
  } catch (error) {
    if (isSymbolicLink(dir)) return { ok: false, reason: "link-dangling", error: "a symbolic link to nothing" };
    if (errorCode(error) !== "ENOENT") return { ok: false, reason: "unreadable", error: errorMessage(error) };
    try {
      realDir = join(realpathSync(cwd), CONFIG_DIR_NAME);
    } catch (cwdError) {
      return { ok: false, reason: "unreadable", error: errorMessage(cwdError) };
    }
  }
  if (!isPathWithinRoots(realDir, resolveRealRoots(allowedRoots))) {
    return { ok: false, reason: "link-outside", error: "a symbolic link outside the folders Pi Web may read" };
  }
  return { ok: true, realPath: join(realDir, "mcp.json") };
}

function readProjectFile(cwd: string, allowedRoots: Set<string>): { info: McpConfigFileInfo; text?: string } {
  const location = locateProjectMcpConfig(cwd, allowedRoots);
  const info: McpConfigFileInfo = { scope: "project", path: location.path, exists: false, problems: [] };
  if (location.kind === "missing") return { info };
  const realPath = location.realPath;
  if (realPath !== undefined && !samePath(realPath, join(realPathOr(cwd), CONFIG_DIR_NAME, "mcp.json"))) info.realPath = realPath;
  if (location.kind === "refused") {
    info.exists = true;
    problem(info, location.reason, location.error);
    return { info };
  }
  return { info, text: readResolvedFile(location.realPath, info, PROJECT_MCP_CONFIG_MAX_BYTES) };
}

/** The file's `mcpServers` entries, parsed as the SDK's `loadMcpConfig()` parses them. */
function parseConfigText(info: McpConfigFileInfo, text: string): [name: string, value: unknown][] {
  let parsed: unknown;
  try {
    // No byte-order mark is stripped: the SDK does not strip one either.
    parsed = JSON.parse(text);
  } catch (error) {
    problem(info, "unparsable", jsonErrorMessage(error, text));
    return [];
  }
  if (!isRecord(parsed) || (parsed.mcpServers !== undefined && !isRecord(parsed.mcpServers))) {
    problem(info, "invalid-shape", 'expected an object with an "mcpServers" object');
    return [];
  }
  if (typeof parsed.autoEnableCodemode === "boolean") info.autoEnableCodemode = parsed.autoEnableCodemode;
  else if (parsed.autoEnableCodemode !== undefined) {
    problem(info, "auto-enable-codemode-invalid", "autoEnableCodemode must be a boolean");
  }
  const entries = Object.entries(isRecord(parsed.mcpServers) ? parsed.mcpServers : {});
  if (info.scope === "project" && entries.length > MCP_PROJECT_MAX_SERVERS) {
    problem(info, "too-many-servers", `declares ${entries.length} servers, more than ${MCP_PROJECT_MAX_SERVERS}`);
    return [];
  }
  return entries;
}

/** What `mcp-auth.json` holds, by the SDK's keys: whether a record is there at all, and whether it has an access token. */
type McpAuthState = Map<string, { signedIn: boolean }>;

/**
 * The records `mcp-auth.json` holds, by their keys (`mcpOAuthStoreKeys()`:
 * name and URL, or URL alone for a record older versions wrote). Read raw and
 * never locked or created; undefined when the file cannot be read, so no
 * server is reported either way.
 */
function readAuthState(agentDir: string): McpAuthState | undefined {
  const path = join(agentDir, "mcp-auth.json");
  const state: McpAuthState = new Map();
  if (!existsSync(path)) return state;
  try {
    const text = readFileSync(path, "utf8");
    if (!text.trim()) return state;
    const parsed: unknown = JSON.parse(text);
    if (!isRecord(parsed)) return state;
    for (const [key, value] of Object.entries(parsed)) {
      state.set(key, { signedIn: isRecord(value) && isRecord(value.tokens) && typeof value.tokens.access_token === "string" });
    }
    return state;
  } catch {
    return undefined;
  }
}

/**
 * What `mcp-auth.json` holds for server `name` at `url`, as the SDK's store
 * reads it: the record under its name and URL, else the one under the URL
 * alone (which the first server of the URL to connect takes over). Sign out
 * removes that record, whatever it holds (`McpOAuthCredentialStore.remove()`).
 */
function authStateOf(state: McpAuthState, name: string, url: string): { signedIn: boolean; stored: boolean } | undefined {
  let keys: { key: string; legacyKey: string };
  try {
    keys = mcpOAuthStoreKeys(name, url);
  } catch {
    return undefined;
  }
  const record = state.get(keys.key) ?? state.get(keys.legacyKey);
  return { signedIn: record?.signedIn ?? false, stored: record !== undefined };
}

/**
 * The transport a connection uses, decided as the SDK's `createDefaultTransport()`
 * (and Pi Web's factory, and the value walk in `resolvedConfigValues()`)
 * decide it: by whether the key `url` is present, whatever its value or
 * `type`. The validator decides differently — `{ type: "stdio", command, url }`
 * passes as stdio — but such an entry connects over HTTP, with its headers'
 * `!command`s, so that is what is reported. An entry the validator refuses
 * never connects, so it gets the validator's reading instead: a legacy SSE
 * entry has no transport.
 */
function transportOf(config: Record<string, unknown>, refused: boolean): McpTransportKind | undefined {
  if (refused) {
    const { type } = config;
    if (typeof config.url === "string" && (type === undefined || type === "http" || type === "streamable-http")) return "http";
    if (typeof config.command === "string" && (type === undefined || type === "stdio")) return "stdio";
    return undefined;
  }
  if ("url" in config) return "http";
  if ("command" in config) return "stdio";
  return undefined;
}

interface DescribeContext {
  internals: McpConfigReadInternals | undefined;
  authState: McpAuthState | undefined;
  /** Project entries are shown with their command and arguments as written (`McpConfigReadOptions.projectUntrusted`). */
  revealProjectCommands: boolean;
}

interface DescribedServer {
  info: McpServerInfo;
  /** Whether the SDK would load it: valid, or not checked because the validator is unavailable. */
  loads: boolean;
  /** The entry has a `url` and a truthy `auth`, which `loadMcpConfig()` refuses in a project file. */
  sendsProviderToken: boolean;
}

const TEMPLATE_REFERENCE = /\$(?:[$!]|\{([^}]*)\}|([A-Za-z_][A-Za-z0-9_]*))/g;
const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * The variables a value that is not a `!command` reads, as the SDK's
 * `getConfigValueEnvVarNames()` parses them, for when its internals cannot be
 * loaded: `${NAME}` and `$NAME`, with `$$` and `$!` escaping a literal, and
 * `${…}` around anything but a name left as written.
 */
export function templateVariableNames(value: string): string[] {
  const names: string[] = [];
  for (const [, braced, bare] of value.matchAll(TEMPLATE_REFERENCE)) {
    const name = braced !== undefined ? (VARIABLE_NAME.test(braced) ? braced : undefined) : bare;
    if (name !== undefined && !names.includes(name)) names.push(name);
  }
  return names;
}

function fieldRef({ kind, name }: McpConfigFieldRef): McpConfigFieldRef {
  return name === undefined ? { kind } : { kind, name };
}

function describeServer(
  name: string,
  value: unknown,
  scope: McpScope,
  sourcePath: string,
  { internals, authState, revealProjectCommands }: DescribeContext,
): DescribedServer {
  const validation = internals?.validateMcpServerConfig(name, value);
  const config: Record<string, unknown> = isRecord(value) ? value : {};
  // `mcpConfigKey()` is total; should it ever throw, the entry is listed as one pi refuses,
  // rather than the whole file (and the global one with it) failing to list.
  let configKey = "";
  let keyError: string | undefined;
  try {
    configKey = mcpEntryConfigKey(value, validation);
  } catch (error) {
    keyError = `server "${name}": cannot be read: ${errorMessage(error)}`;
  }
  const info: McpServerInfo = {
    name,
    scope,
    sourcePath,
    configKey,
    enabled: config.enabled !== false,
    validated: internals !== undefined,
    envNames: isRecord(config.env) ? Object.keys(config.env) : [],
    headerNames: isRecord(config.headers) ? Object.keys(config.headers) : [],
    usesOAuth: false,
    commandFields: [],
    variableReferences: [],
    masked: false,
  };
  if (typeof validation === "string") info.invalidError = validation;
  if (!isRecord(value)) info.notAnObject = true;
  const transport = transportOf(config, typeof validation === "string");
  if (transport) info.transport = transport;
  if (validation !== undefined && typeof validation !== "string") {
    // The validator's copy, with `codemode-deferred` read as the `codemode` it now means.
    const validated = validation as McpServerConfig;
    info.exposure = validated.exposure ?? "codemode";
    const overrides = validated.toolExposure ? Object.keys(validated.toolExposure).length : 0;
    if (overrides > 0) info.toolExposureCount = overrides;
  }
  if (typeof config.description === "string" && config.description.trim()) info.description = config.description;

  // Masking hides what looks like a secret by shape and by position (any value after `--token`),
  // which the author of the entry chooses. For a repository nobody has trusted yet, that would let
  // it hide the very command trusting the folder runs (`npx -y •••`), so it is shown as written.
  const revealCommand = scope === "project" && revealProjectCommands;
  if (typeof config.command === "string") {
    const command = revealCommand ? { value: config.command, masked: false } : maskCommand(config.command);
    info.command = command.value;
    info.masked ||= command.masked;
  }
  if (Array.isArray(config.args)) {
    const strings = config.args.filter((arg): arg is string => typeof arg === "string");
    const args = revealCommand ? { args: strings, masked: false } : maskArgs(strings);
    info.args = args.args;
    info.masked ||= args.masked;
  }
  if (typeof config.cwd === "string") info.cwd = config.cwd;
  if (typeof config.url === "string") {
    const url = maskUrl(config.url);
    info.url = url.value;
    info.masked ||= url.masked;
  }
  // The SDK's rule (runtime.js usesOAuth): `url` present, no `auth` and no Authorization header.
  if (transport === "http" && isRecord(config.auth) && typeof config.auth.provider === "string" && config.auth.provider) {
    info.authProvider = config.auth.provider;
  }
  info.usesOAuth = transport === "http" && !config.auth && !info.headerNames.some((header) => header.toLowerCase() === "authorization");
  if (info.usesOAuth && authState && typeof config.url === "string") {
    const stored = authStateOf(authState, name, config.url);
    if (stored) {
      info.signedIn = stored.signedIn;
      info.oauthStateStored = stored.stored;
    }
  }

  // Without the SDK's parser, a leading `!` is all that marks a command, and any
  // mention of the password counts, as it does for a command.
  const isCommand = internals ? (text: string) => internals.isCommandConfigValue(text) : (text: string) => text.startsWith("!");
  const values = resolvedConfigValues(config);
  info.commandFields = values.filter((field) => isCommand(field.value)).map(fieldRef);
  // Named, never expanded: these are the host's variables the entry hands to
  // its process or sends to its URL, which the trust dialog has to show.
  const variableNames = internals ? (text: string) => internals.getConfigValueEnvVarNames(text) : templateVariableNames;
  info.variableReferences = values
    .filter((field) => !isCommand(field.value))
    .map((field): McpVariableReference => ({ ...fieldRef(field), variables: variableNames(field.value) }))
    .filter((reference) => reference.variables.length > 0);
  const webPasswordField = internals
    ? findWebPasswordField(config, internals)
    : values.find((field) => field.value.toUpperCase().includes(WEB_PASSWORD_VARIABLE));
  if (webPasswordField) info.webPasswordField = fieldRef(webPasswordField);

  const sendsProviderToken = "url" in config && Boolean(config.auth);
  if (keyError !== undefined) {
    info.invalidError ??= keyError;
    return { info, loads: false, sendsProviderToken };
  }
  return { info, loads: internals ? typeof validation !== "string" : isRecord(value), sendsProviderToken };
}

/** The namespace pi gives a server's tools (`mcpNamespace()`): `mcp__<name>`, `-` as `_`. */
function mcpNamespace(name: string): string {
  return `mcp__${name.replace(/-/g, "_")}`;
}

/**
 * Refuses what `loadMcpConfig()` refuses beyond the validator, in its order
 * (global file first, then the project's): a name whose namespace another
 * loaded entry already has (`a-b` beside `a_b`; the later one is skipped),
 * and `auth` in the project file, which would let a repository pick where a
 * provider's token goes. Each is listed as an entry pi refuses, with its
 * words, so it never connects and never replaces a global entry.
 */
function refuseAsLoaderDoes(described: DescribedServer[]): void {
  const loaded = new Set<string>();
  for (const server of described) {
    if (!server.loads) continue;
    const { info } = server;
    const clash = [...loaded].find((other) => other !== info.name && mcpNamespace(other) === mcpNamespace(info.name));
    if (clash !== undefined) {
      info.invalidError = `server "${info.name}" conflicts with "${clash}"`;
      server.loads = false;
      continue;
    }
    if (info.scope === "project" && server.sendsProviderToken) {
      info.invalidError = `server "${info.name}": auth is only allowed in the global mcp.json`;
      server.loads = false;
      continue;
    }
    loaded.add(info.name);
  }
}

export interface McpConfigReadOptions {
  agentDir: string;
  /** The project to read `.pi/mcp.json` from; its file must resolve inside `allowedRoots`. */
  project?: { cwd: string; allowedRoots: Set<string> };
  /** The SDK's validator and value parsers; without them entries are listed unchecked. */
  internals?: McpConfigReadInternals;
  /**
   * No decision trusts the project, so its entries are repository content
   * shown for someone to decide on: their `command` and `args` are listed as
   * written, not masked. A URL is still masked (its host never is), and env
   * and header values are never sent at all.
   */
  projectUntrusted?: boolean;
}

export interface McpConfigRead {
  files: McpConfigFileInfo[];
  servers: McpServerInfo[];
}

/** The servers of the global and the project file, each described from the file alone. */
export function readMcpServerConfigs(options: McpConfigReadOptions): McpConfigRead {
  const context: DescribeContext = {
    internals: options.internals,
    authState: readAuthState(options.agentDir),
    revealProjectCommands: options.projectUntrusted === true,
  };
  const files: McpConfigFileInfo[] = [];
  const described: DescribedServer[] = [];
  const sources = [readGlobalFile(options.agentDir)];
  if (options.project) sources.push(readProjectFile(options.project.cwd, options.project.allowedRoots));
  for (const { info, text } of sources) {
    files.push(info);
    if (text === undefined) continue;
    for (const [name, value] of parseConfigText(info, text)) {
      described.push(describeServer(name, value, info.scope, info.path, context));
    }
  }
  if (options.internals) refuseAsLoaderDoes(described);
  // A project entry the SDK loads replaces the global one of its name once the
  // project is trusted; an invalid one is skipped and leaves the global in place.
  const projectNames = new Set(
    described.filter(({ info, loads }) => info.scope === "project" && loads).map(({ info }) => info.name),
  );
  const shadowedNames = new Set<string>();
  for (const { info } of described) {
    if (info.scope === "global" && projectNames.has(info.name)) {
      info.shadowedByProject = true;
      shadowedNames.add(info.name);
    }
  }
  for (const { info } of described) {
    if (info.scope === "project" && shadowedNames.has(info.name)) info.replacesGlobal = true;
  }
  return { files, servers: described.map(({ info }) => info) };
}

/** One entry as its file holds it, for a route that connects it; never sent to the browser. */
export type McpServerEntryRead =
  | {
      ok: true;
      /** The raw entry, literal values included. */
      value: unknown;
      /** The configured path of its file, as `McpServerInfo.sourcePath` names it. */
      sourcePath: string;
    }
  | {
      ok: false;
      /** A problem of the file (its servers are not listed), or `server-missing`. */
      reason: Exclude<McpConfigFileProblem["reason"], "auto-enable-codemode-invalid"> | "server-missing";
      error: string;
      path: string;
    };

/**
 * The entry `name` of the global file or the project's, read and parsed as
 * the listing reads it, under the same link rule, so a route acts only on an
 * entry the panel can list and never on a config the browser sent.
 */
export function readMcpServerEntry(options: {
  agentDir: string;
  scope: McpScope;
  name: string;
  /** Required for a project entry. */
  project?: { cwd: string; allowedRoots: Set<string> };
}): McpServerEntryRead {
  const { scope, name, project } = options;
  if (scope === "project" && !project) throw new Error("a project entry needs the project");
  const { info, text } = scope === "global" || !project
    ? readGlobalFile(options.agentDir)
    : readProjectFile(project.cwd, project.allowedRoots);
  const entries = text === undefined ? [] : parseConfigText(info, text);
  for (const problem of info.problems) {
    if (problem.reason !== "auto-enable-codemode-invalid") {
      return { ok: false, reason: problem.reason, error: problem.error, path: info.path };
    }
  }
  const found = entries.find(([entryName]) => entryName === name);
  if (!found) return { ok: false, reason: "server-missing", error: `${info.path} does not define MCP server "${name}"`, path: info.path };
  return { ok: true, value: found[1], sourcePath: info.path };
}

/** Whether a decision, exact or inherited, trusts the project; one that cannot be read does not. */
function projectTrustedByDecision(cwd: string, agentDir: string): boolean {
  try {
    return getProjectTrustStatus(cwd, agentDir).decision === true;
  } catch {
    return false;
  }
}

export interface ProjectMcpServers {
  file: McpConfigFileInfo;
  servers: McpServerInfo[];
}

/**
 * What a project's `.pi/mcp.json` declares, for the trust dialog: read as
 * `GET /api/mcp` reads it, from the file only and whether or not the project
 * is trusted. The global file is read too, only to tell which project entries
 * replace a global one of their name.
 */
export async function readProjectMcpServers(options: {
  agentDir: string;
  cwd: string;
  allowedRoots: Set<string>;
}): Promise<ProjectMcpServers> {
  const internals = await loadPiSdkInternals();
  const { files, servers } = readMcpServerConfigs({
    agentDir: options.agentDir,
    project: { cwd: options.cwd, allowedRoots: options.allowedRoots },
    internals: internals.ok ? internals : undefined,
    projectUntrusted: !projectTrustedByDecision(options.cwd, options.agentDir),
  });
  const file = files.find((info) => info.scope === "project");
  if (!file) throw new Error("the project file was not read");
  return { file, servers: servers.filter((server) => server.scope === "project") };
}

// ---------------------------------------------------------------------------
// GET /api/mcp
// ---------------------------------------------------------------------------

function mcpAvailability(
  environment: NodeJS.ProcessEnv,
  internals: Awaited<ReturnType<typeof loadPiSdkInternals>>,
  mcpSwitch: BuiltinExtensionSwitch | undefined,
): McpAvailability {
  if (isMcpDisabledByOperator(environment)) {
    return { available: false, reason: "operator-disabled", error: `${MCP_DISABLE_VARIABLE} is set` };
  }
  if (!internals.ok) {
    return {
      available: false,
      reason: "internals-unavailable",
      error: "Pi Web cannot load the SDK's MCP modules",
      detail: internals.reason,
    };
  }
  if (mcpSwitch && !mcpSwitch.enabled) {
    return {
      available: false,
      reason: "builtin-disabled",
      error: "the extensions setting turns builtin:mcp off",
      ...(mcpSwitch.settingsPath ? { settingsPath: mcpSwitch.settingsPath } : {}),
    };
  }
  return { available: true };
}

/**
 * Code mode as a session would get it: the global preference, mode and inline
 * budget, the sandbox self-test and `-builtin:codemode` (both as the project's
 * sessions see it and as the global settings alone say), and, given
 * `trustedCwd`, the project settings that decide any of them there whatever
 * the global value.
 */
async function codemodeInfo(
  agentDir: string,
  codemodeSwitch: BuiltinExtensionSwitch | undefined,
  trustedCwd: string | undefined,
): Promise<McpCodemodeInfo> {
  const peek = await peekCodemodeSandbox();
  const sandbox: CodemodeSandboxStatus = !peek.checked
    ? { state: "not-checked" }
    : peek.available
      ? { state: "available" }
      : { state: "unavailable", error: peek.reason };
  const info: McpCodemodeInfo = { sandbox, builtinDisabled: codemodeSwitch?.enabled === false };
  if (codemodeSwitch?.settingsPath) info.builtinSettingsPath = codemodeSwitch.settingsPath;
  // What the global `extensions` alone say, which is what Always on, a global setting, depends on.
  const globalSwitch = codemodeSwitch?.global ?? codemodeSwitch;
  if (globalSwitch?.enabled === false) {
    info.globalBuiltinSettingsPath = globalSwitch.settingsPath ?? getGlobalSettingsPath(agentDir);
  }
  try {
    info.preference = await readCodemodePreference(getGlobalSettingsPath(agentDir));
  } catch (error) {
    info.preferenceError = errorMessage(error);
  }
  const projectOverride = trustedCwd === undefined ? undefined : readProjectCodemodeOverride(trustedCwd);
  if (projectOverride) info.projectOverride = projectOverride;
  // Read on its own: a malformed defaultTools leaves the codemode object readable, and the other way round.
  try {
    const settingsPath = getGlobalSettingsPath(agentDir);
    const { mode, inlineBudget } = await readCodemodeSettings(settingsPath);
    info.mode = { ...mode, settingsPath };
    const projectMode = trustedCwd === undefined ? undefined : readProjectCodemodeMode(trustedCwd);
    if (projectMode) info.mode.projectOverride = projectMode;
    info.inlineBudget = { ...inlineBudget, settingsPath, default: CODEMODE_INLINE_BUDGET_DEFAULT, max: CODEMODE_INLINE_BUDGET_MAX };
    const projectBudget = trustedCwd === undefined ? undefined : readProjectCodemodeInlineBudget(trustedCwd);
    if (projectBudget) info.inlineBudget.projectOverride = projectBudget;
  } catch (error) {
    info.modeError = errorMessage(error);
    info.inlineBudgetError = info.modeError;
  }
  return info;
}

function withHostInactive(cwd: string | undefined): Pick<McpResponse, "hostInactive"> {
  const hostInactive = readMcpHostInactive(cwd);
  return hostInactive ? { hostInactive } : {};
}

export interface McpOverviewOptions {
  agentDir: string;
  project?: { cwd: string; allowedRoots: Set<string> };
  environment?: NodeJS.ProcessEnv;
}

/**
 * Everything Settings › MCP shows, from files and process state only: whether
 * MCP and Code mode can run, the servers of both files with the last known
 * status of each (`lib/mcp-status.ts`, for the entry as the file holds it
 * now, from a test or an open session), an open session whose `/mcp` is
 * another extension's, and the project's trust, read fresh. A project that is
 * not trusted is listed too, with the command each entry would run, which is
 * the point: it can be checked before anyone trusts it.
 */
export async function readMcpOverview(options: McpOverviewOptions): Promise<McpResponse> {
  const { agentDir, project, environment = process.env } = options;
  const internals = await loadPiSdkInternals();
  let projectInfo: McpProjectInfo | undefined;
  if (project) {
    projectInfo = { cwd: project.cwd };
    try {
      projectInfo.trust = getProjectTrustStatus(project.cwd, agentDir);
    } catch (error) {
      projectInfo.trustError = errorMessage(error);
    }
    const trust = projectInfo.trust;
    // A fresh folder: adding a project server trusts it in the same step, unless that would trust too
    // much, or a link to nothing where the SDK looks would need trust later. The same checks, in the
    // same order, as trustFreshFolderAndWrite(), so the pane never offers a step the route refuses.
    if (trust && !trust.requiresTrust && trust.decision === null && trust.decisionError === undefined) {
      const breadth = freshFolderTrustBreadth(project.cwd, { agentDir, knownFolders: project.allowedRoots });
      projectInfo.trustFolder = breadth
        ? { allowed: false, reason: "trust-too-broad", breadth }
        : hasTrustRelevantEntries(project.cwd)
          ? { allowed: false, reason: "folder-not-fresh" }
          : { allowed: true };
    }
  }
  // Whether sessions load the project's settings, as `projectTrustReloadOptions()` decides when one
  // starts: a folder that requires trust only with a decision that trusts it, never while trust.json
  // cannot be read; one that requires none has no `.pi/settings.json`, which alone requires trust.
  const projectSettingsLoad = projectInfo?.trust?.trusted === true;
  let switches: Record<BuiltinExtensionName, BuiltinExtensionSwitch> | undefined;
  try {
    switches = await readBuiltinExtensionSwitches({
      agentDir,
      cwd: project?.cwd,
      projectTrusted: projectSettingsLoad,
    });
  } catch (error) {
    // A settings file that cannot be read leaves the built-ins as the session would find them: on.
    console.warn(`[pi-web] cannot read the extensions settings for Settings › MCP: ${errorMessage(error)}`);
  }
  const { files, servers } = readMcpServerConfigs({
    agentDir,
    project,
    internals: internals.ok ? internals : undefined,
    // The panel's rule for a project's servers being read (`trust.decision === true`).
    projectUntrusted: projectInfo?.trust?.decision !== true,
  });
  // A file whose servers are all listed: statuses of names it no longer defines can go.
  const listedFiles = files.filter((file) => !file.problems.some((item) => item.reason !== "auto-enable-codemode-invalid"));
  return {
    mcp: mcpAvailability(environment, internals, switches?.mcp),
    codemode: await codemodeInfo(agentDir, switches?.codemode, project && projectSettingsLoad ? project.cwd : undefined),
    files,
    servers: withMcpStatuses(servers, listedFiles),
    ...(switches?.["tool-search"].enabled === false
      ? { toolSearchDisabled: switches["tool-search"].settingsPath ? { settingsPath: switches["tool-search"].settingsPath } : {} }
      : {}),
    ...(projectInfo ? { project: projectInfo } : {}),
    ...withHostInactive(project?.cwd),
  };
}
