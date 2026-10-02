import { randomUUID } from "node:crypto";
import { chmodSync, lstatSync, mkdirSync, readlinkSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type { McpExposure } from "@earendil-works/pi-coding-agent";
import lockfile from "proper-lockfile";
import { serializeByKey } from "./key-serializer";
import {
  globalMcpConfigPath,
  jsonErrorMessage,
  locateProjectMcpConfig,
  PROJECT_MCP_CONFIG_MAX_BYTES,
  projectMcpConfigCreatePath,
  readResolvedConfigFile,
} from "./mcp-config-read";

// Pi Web's `mcp.json` writer (ADR 0006, "Writes"). The SDK's editors
// (`dist/extensions/mcp/config.js` add/update/removeMcpServerConfig, which the
// internals adapter loads) are the semantics this mirrors byte for byte: the
// file is parsed, the edit applied to the parsed object, and the whole document
// written back with the indentation of its first indented line ("  " when
// none) and always a trailing newline; `enabled: true` and `exposure:
// "codemode"` delete their key, and every key Pi Web does not know is kept.
// What the SDK lacks and this adds: a lock (proper-lockfile, plus an
// in-process queue so Pi Web's own writes never wait on each other's lock), an
// atomic write (a temporary file in the real directory, renamed over the real
// path, so a symbolic link stays a link), the mode (0600 for the global file,
// which may hold literal secrets; the project file, often committed, keeps
// its mode, 0644 when new), and a typed refusal that leaves a file it cannot
// parse untouched. The pi CLI writes without a lock, so the lock serializes
// Pi Web's writers only. `lib/mcp-config-file.test.mjs` pins the bytes against
// the SDK's own editors.

/** Which file to write: the global `mcp.json`, or a project's `.pi/mcp.json` under the link rule. */
export type McpConfigFileTarget =
  | { scope: "global"; agentDir: string }
  | { scope: "project"; cwd: string; allowedRoots: Set<string> };

/** The SDK's server patch: `enabled: true` and `exposure: "codemode"` remove their key. */
export interface McpServerConfigPatch {
  enabled?: boolean;
  exposure?: McpExposure;
}

export type McpConfigWriteReason =
  /** The file is not JSON; it was left as it is. */
  | "unparsable"
  /** Not an object with an `mcpServers` object; left as it is. */
  | "invalid-shape"
  /** The file does not define the server (anymore). */
  | "server-missing"
  /** The file already defines a server of that name. */
  | "name-taken"
  /** A project file that is a symbolic link to nothing. */
  | "link-dangling"
  /** A project file whose real path is outside the folders Pi Web may read. */
  | "link-outside"
  /** Not a regular file. */
  | "not-a-file"
  /** A project file larger than 1 MiB. */
  | "too-large"
  /** Another process held the lock for longer than the writer waits. */
  | "locked"
  | "unreadable";

const WRITE_ERROR_BRAND: unique symbol = Symbol.for("pi-web:mcp-config-write-error");

/** A refused write: nothing was written. `path` is the configured path, as the panel shows it. */
export class McpConfigWriteError extends Error {
  readonly [WRITE_ERROR_BRAND] = true;
  readonly reason: McpConfigWriteReason;
  readonly path: string;
  readonly serverName?: string;

  constructor(reason: McpConfigWriteReason, path: string, message: string, serverName?: string) {
    super(message);
    this.name = "McpConfigWriteError";
    this.reason = reason;
    this.path = path;
    if (serverName !== undefined) this.serverName = serverName;
  }
}

/** Tells a refused write by its brand, so a second copy of this module (hot reload, a test loader) still counts. */
export function isMcpConfigWriteError(error: unknown): error is McpConfigWriteError {
  return typeof error === "object" && error !== null && (error as Record<symbol, unknown>)[WRITE_ERROR_BRAND] === true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

// ---------------------------------------------------------------------------
// The SDK's edit semantics, on a parsed document
// ---------------------------------------------------------------------------

/**
 * The entry a file defines under `name`: an own property only, so a server
 * named `__proto__` (or `constructor`) is never read off Object.prototype and
 * a patch can never write to it.
 */
export function ownServerEntry(servers: Record<string, unknown> | undefined, name: string): unknown {
  return servers !== undefined && Object.hasOwn(servers, name) ? servers[name] : undefined;
}

/** Sets an own enumerable property, as JSON.parse does, so `__proto__` is a key like any other. */
function defineEntry(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}

/**
 * The SDK's `updateMcpServerConfig()` patch on one entry, in place: `enabled:
 * true` deletes the key and `false` sets it, `exposure: "codemode"` deletes
 * the key and any other sets it. Returns whether the entry changed; one that
 * already says what the patch says is left alone, so its file is not rewritten.
 */
export function patchMcpServerEntry(entry: Record<string, unknown>, patch: McpServerConfigPatch): boolean {
  let changed = false;
  if (patch.enabled !== undefined) {
    if (patch.enabled) {
      if (Object.hasOwn(entry, "enabled")) {
        delete entry.enabled;
        changed = true;
      }
    } else if (entry.enabled !== false) {
      defineEntry(entry, "enabled", false);
      changed = true;
    }
  }
  if (patch.exposure !== undefined) {
    if (patch.exposure === "codemode") {
      if (Object.hasOwn(entry, "exposure")) {
        delete entry.exposure;
        changed = true;
      }
    } else if (entry.exposure !== patch.exposure) {
      defineEntry(entry, "exposure", patch.exposure);
      changed = true;
    }
  }
  return changed;
}

/**
 * Puts `entry` under `name` in the document's `mcpServers`, creating that
 * object when the file has none, as the SDK's `addMcpServerConfig()` does
 * (appended last), or at `index` among the entries, where a removal took it
 * from. The object is rebuilt in place, so its position in the file stays.
 */
export function insertMcpServerEntry(
  document: Record<string, unknown>,
  name: string,
  entry: unknown,
  index?: number,
): void {
  const servers = isRecord(document.mcpServers) ? document.mcpServers : undefined;
  if (!servers) {
    defineEntry(document, "mcpServers", Object.defineProperty({}, name, { value: entry, enumerable: true, writable: true, configurable: true }));
    return;
  }
  const entries = Object.entries(servers);
  if (index === undefined || index >= entries.length) {
    defineEntry(servers, name, entry);
    return;
  }
  entries.splice(Math.max(0, index), 0, [name, entry]);
  for (const key of Object.keys(servers)) delete servers[key];
  for (const [key, value] of entries) defineEntry(servers, key, value);
}

/** The SDK's output for a document read from `originalText`: its first indentation, then a newline. */
export function serializeMcpConfig(document: Record<string, unknown>, originalText: string | undefined): string {
  const indent = (originalText && /^([ \t]+)\S/m.exec(originalText)?.[1]) || "  ";
  return `${JSON.stringify(document, null, indent)}\n`;
}

/**
 * The document the SDK's editors read: `{}` for a missing file, else the
 * parsed text, which must be an object whose `mcpServers` is an object when
 * present. No byte-order mark is stripped, as the SDK strips none. A syntax
 * error never quotes the file (`jsonErrorMessage()`), which may hold secrets.
 */
export function parseMcpConfigDocument(text: string | undefined, path: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = text === undefined ? {} : JSON.parse(text);
  } catch (error) {
    throw new McpConfigWriteError("unparsable", path, `${path}: ${jsonErrorMessage(error, text ?? "")}`);
  }
  if (!isRecord(parsed) || (parsed.mcpServers !== undefined && !isRecord(parsed.mcpServers))) {
    throw new McpConfigWriteError("invalid-shape", path, `${path}: expected an object with an "mcpServers" object`);
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Where a file is written
// ---------------------------------------------------------------------------

interface ResolvedTarget {
  /** The configured path: `<agent-dir>/mcp.json` or `<cwd>/.pi/mcp.json`. */
  path: string;
  /** Where the bytes go: the configured path with every link resolved. */
  realPath: string;
  /** The largest file read; the project file comes from a repository. */
  maxBytes?: number;
  /** The file's mode after a write, given the mode it had (undefined when new). */
  mode: (existing: number | undefined) => number;
  /** Mode for a folder the writer creates on the way. */
  dirMode?: number;
}

const MAX_LINK_HOPS = 40;

/**
 * The global file is the user's own: a link is followed wherever it leads,
 * and so is a dangling one, by hand, to the file it names, which the write
 * then creates. A missing file is created in the agent directory.
 */
function resolveGlobalTarget(agentDir: string): ResolvedTarget {
  const path = globalMcpConfigPath(agentDir);
  const target = { path, mode: () => 0o600, dirMode: 0o700 };
  try {
    return { ...target, realPath: realpathSync(path) };
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw new McpConfigWriteError("unreadable", path, `${path}: ${errorMessage(error)}`);
  }
  let current = resolve(path);
  for (let hop = 0; ; hop += 1) {
    let link = false;
    try {
      link = lstatSync(current).isSymbolicLink();
    } catch (error) {
      const code = errorCode(error);
      if (code !== "ENOENT" && code !== "ENOTDIR") throw new McpConfigWriteError("unreadable", path, `${path}: ${errorMessage(error)}`);
    }
    if (!link) break;
    if (hop >= MAX_LINK_HOPS) throw new McpConfigWriteError("unreadable", path, `${path}: too many symbolic links`);
    current = resolve(dirname(current), readlinkSync(current));
  }
  // `current` names a file that does not exist; its folder may hold links of its own.
  let realDir = dirname(current);
  try {
    realDir = realpathSync(realDir);
  } catch {
    // Created by the write.
  }
  return { ...target, realPath: join(realDir, basename(current)) };
}

/**
 * The project file follows `lib/mcp-config-read.ts`' link rule, the one the
 * panel listed it under: its real path must stay inside the allowed roots,
 * and a dangling link is refused. A missing file is created inside the real
 * `.pi/` folder, which must resolve inside the roots too.
 */
function resolveProjectTarget(cwd: string, allowedRoots: Set<string>): ResolvedTarget {
  const location = locateProjectMcpConfig(cwd, allowedRoots);
  const target = {
    path: location.path,
    maxBytes: PROJECT_MCP_CONFIG_MAX_BYTES,
    mode: (existing: number | undefined) => existing ?? 0o644,
  };
  if (location.kind === "refused") {
    throw new McpConfigWriteError(location.reason, location.path, `${location.path}: ${location.error}`);
  }
  if (location.kind === "found") return { ...target, realPath: location.realPath };
  const created = projectMcpConfigCreatePath(cwd, allowedRoots);
  if (!created.ok) throw new McpConfigWriteError(created.reason, location.path, `${location.path}: ${created.error}`);
  return { ...target, realPath: created.realPath };
}

function resolveTarget(target: McpConfigFileTarget): ResolvedTarget {
  return target.scope === "global" ? resolveGlobalTarget(target.agentDir) : resolveProjectTarget(target.cwd, target.allowedRoots);
}

// ---------------------------------------------------------------------------
// Locked, atomic edits
// ---------------------------------------------------------------------------

// Route handlers are bundled separately and hot reload re-evaluates modules; globalThis keeps one queue per process.
const QUEUE_KEY: symbol = Symbol.for("pi-web:mcp-config-write-queue");

/** Runs `task` after every earlier task for the same file has settled. */
function serialize<T>(key: string, task: () => Promise<T>): Promise<T> {
  return serializeByKey(QUEUE_KEY, key, task);
}

/**
 * About three seconds of retries in all. proper-lockfile's own default would
 * back off from one second and double ten times; Pi Web's writes are
 * serialized before the lock, so only another process holds it, and only for
 * one short write. A lock found compromised (its folder removed, its refresh
 * failing) is logged: proper-lockfile's default throws from a timer, which
 * would take the whole server down for a write that has finished anyway.
 */
const LOCK_OPTIONS = {
  realpath: false,
  retries: { retries: 10, factor: 2, minTimeout: 25, maxTimeout: 500 },
  onCompromised: (error: Error) => {
    console.warn(`[pi-web] an mcp.json lock was compromised: ${error.message}`);
  },
};

/** The file is replaced, never written in place: a temporary file in its folder, then a rename over it. */
function writeAtomically(realPath: string, text: string, mode: number): void {
  const temp = join(dirname(realPath), `.${basename(realPath)}.${randomUUID()}.tmp`);
  try {
    writeFileSync(temp, text, { encoding: "utf8", flag: "wx", mode: 0o600, flush: true });
    chmodSync(temp, mode);
    renameSync(temp, realPath);
  } catch (error) {
    try {
      unlinkSync(temp);
    } catch {
      // Never created, or already renamed.
    }
    throw error;
  }
}

/** What an edit sees: the parsed file (`{}` when missing) and its `mcpServers`. */
export interface McpConfigDocument {
  document: Record<string, unknown>;
  /** Undefined when the file has no `mcpServers` (or does not exist). */
  servers: Record<string, unknown> | undefined;
  exists: boolean;
  /** The configured path, for an edit's own refusal. */
  path: string;
}

export interface McpConfigEditOutcome<T> {
  value: T;
  /** Whether the file was written; an edit that changed nothing leaves it as it was. */
  written: boolean;
  path: string;
  realPath: string;
}

/**
 * Reads the file under the lock, lets `edit` change the parsed document, and
 * writes it back atomically when `edit` reports a change. A file that cannot
 * be read or parsed throws `McpConfigWriteError` and is left untouched, as is
 * one that `edit` refuses by throwing.
 */
export function editMcpConfigFile<T>(
  target: McpConfigFileTarget,
  edit: (file: McpConfigDocument) => { changed: boolean; value: T },
): Promise<McpConfigEditOutcome<T>> {
  let resolved: ResolvedTarget;
  try {
    resolved = resolveTarget(target);
  } catch (error) {
    return Promise.reject(error);
  }
  return serialize(resolved.realPath, async () => {
    mkdirSync(dirname(resolved.realPath), { recursive: true, ...(resolved.dirMode ? { mode: resolved.dirMode } : {}) });
    let release: () => Promise<void>;
    try {
      release = await lockfile.lock(resolved.realPath, LOCK_OPTIONS);
    } catch (error) {
      if (errorCode(error) === "ELOCKED") {
        throw new McpConfigWriteError("locked", resolved.path, `${resolved.path}: another process holds its lock`);
      }
      throw error;
    }
    try {
      const read = readResolvedConfigFile(resolved.realPath, resolved.maxBytes);
      let text: string | undefined;
      let existingMode: number | undefined;
      if (read.ok) {
        text = read.text;
        existingMode = read.mode;
      } else if (read.code !== "ENOENT") {
        throw new McpConfigWriteError(read.reason, resolved.path, `${resolved.path}: ${read.error}`);
      }
      const document = parseMcpConfigDocument(text, resolved.path);
      const servers = isRecord(document.mcpServers) ? document.mcpServers : undefined;
      const { changed, value } = edit({ document, servers, exists: text !== undefined, path: resolved.path });
      if (changed) writeAtomically(resolved.realPath, serializeMcpConfig(document, text), resolved.mode(existingMode));
      return { value, written: changed, path: resolved.path, realPath: resolved.realPath };
    } finally {
      await release();
    }
  });
}

// ---------------------------------------------------------------------------
// What Settings › MCP does with a file
// ---------------------------------------------------------------------------

export type McpEnabledOutcome<R extends string> =
  | { name: string; outcome: "changed" | "unchanged" }
  /** The file does not define it (anymore). */
  | { name: string; outcome: "missing" }
  /** The file defines it, but not as an object, so there is no `enabled` to write; it is left as it is. */
  | { name: string; outcome: "not-an-object" }
  /** `refuse` said why it may not change. */
  | { name: string; outcome: "refused"; reason: R };

/**
 * Turns the named servers on or off with one write, as the SDK's
 * `updateMcpServerConfig({ enabled })` turns one. Each name gets its own
 * outcome, so a server removed meanwhile, or one `refuse` names a reason for,
 * keeps the rest from failing. Nothing is written when nothing changes.
 */
export async function setMcpServersEnabled<R extends string = never>(
  target: McpConfigFileTarget,
  names: readonly string[],
  enabled: boolean,
  refuse?: (name: string, entry: Record<string, unknown>) => R | undefined,
): Promise<McpConfigEditOutcome<McpEnabledOutcome<R>[]>> {
  return editMcpConfigFile(target, ({ servers }) => {
    let changed = false;
    const outcomes = [...new Set(names)].map((name): McpEnabledOutcome<R> => {
      if (!servers || !Object.hasOwn(servers, name)) return { name, outcome: "missing" };
      const entry = servers[name];
      if (!isRecord(entry)) return { name, outcome: "not-an-object" };
      const reason = refuse?.(name, entry);
      if (reason !== undefined) return { name, outcome: "refused", reason };
      const entryChanged = patchMcpServerEntry(entry, { enabled });
      changed ||= entryChanged;
      return { name, outcome: entryChanged ? "changed" : "unchanged" };
    });
    return { changed, value: outcomes };
  });
}

/** An entry a removal took out of a file, with where it stood, for undo. */
export interface McpRemovedServer {
  /** The raw entry, literal secrets and all: it stays on the server. */
  entry: unknown;
  /** Its position among the file's entries. */
  index: number;
}

/** Removes a server, as the SDK's `removeMcpServerConfig()` does; one the file does not define is refused. */
export async function removeMcpServer(target: McpConfigFileTarget, name: string): Promise<McpConfigEditOutcome<McpRemovedServer>> {
  return editMcpConfigFile(target, ({ servers, path }) => {
    if (!servers || !Object.hasOwn(servers, name)) {
      throw new McpConfigWriteError("server-missing", path, `${path} does not define MCP server "${name}"`, name);
    }
    const index = Object.keys(servers).indexOf(name);
    const entry = servers[name];
    delete servers[name];
    return { changed: true, value: { entry, index } };
  });
}

/**
 * Adds a server, refusing a name the file already defines (the SDK's
 * `addMcpServerConfig()` would replace it). With `index`, the entry goes back
 * where it stood; without, it is appended as the SDK appends it. Creates the
 * file when missing.
 */
export async function insertMcpServer(
  target: McpConfigFileTarget,
  name: string,
  entry: unknown,
  index?: number,
): Promise<McpConfigEditOutcome<void>> {
  return editMcpConfigFile(target, ({ document, servers, path }) => {
    if (ownServerEntry(servers, name) !== undefined) {
      throw new McpConfigWriteError("name-taken", path, `${path} already defines MCP server "${name}"`, name);
    }
    insertMcpServerEntry(document, name, entry, index);
    return { changed: true, value: undefined };
  });
}
