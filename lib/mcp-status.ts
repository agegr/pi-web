import type { McpHostInactiveInfo, McpScope, McpServerInfo, McpServerStatus } from "./api-types";
import { samePath } from "./paths";

// The last known connection state of each `mcp.json` entry, for the status
// dots of Settings › MCP (ADR 0006). GET /api/mcp reads files only and never
// connects, so what a connection did comes from here: a Test writes its
// result (`lib/mcp-test.ts`), and every open session's MCP host writes what
// it sees (`lib/mcp-host.ts`), the latest write for the same content winning.
// Route handlers are bundled separately and hot reload re-evaluates modules,
// so the maps live on globalThis; a server restart forgets every state, which
// only shows the servers as untested again.
//
// A record is keyed by the file and the name, never the name alone: a project
// entry may share its name with a global one, and two projects each have
// their own `.pi/mcp.json`. Each entry holds a record per `configKey`
// (`mcpConfigKey()`, an HMAC of the entry's canonical JSON) it was recorded
// for, and only the one for the entry as the file holds it now is shown: an
// edited entry reads as untested instead of carrying the old entry's result.
// One record per content, not per entry, because writers can be behind the
// file: a session syncs `mcp.json` only before its prompts, so an open session
// still holding the entry as it was before an edit (an editor, `pi mcp add`, a
// `git pull`) reports a drop or a reconnect of that old content. That report
// must not replace a Test of the entry as it is now, which the next read would
// then drop as stale, leaving the row untested.

/** Records held at once; the least recently written goes first. */
export const MCP_STATUS_MAX_RECORDS = 500;

// The shape changed from one record per entry, and a dev server keeps
// globalThis across hot reloads: a new name, so the old map is never read as
// the new one.
const STORE_KEY: symbol = Symbol.for("pi-web:mcp-status:by-config");

/** Which entry a status is about: its scope, the file that defines it (as the panel names it), and its name. */
export interface McpStatusEntry {
  scope: McpScope;
  sourcePath: string;
  name: string;
}

/** Entry key, then `configKey`, each in write order: what was written again goes last. */
type StatusRecords = Map<string, Map<string, McpServerStatus>>;

function records(): StatusRecords {
  const store = globalThis as Record<symbol, StatusRecords | undefined>;
  return (store[STORE_KEY] ??= new Map());
}

function recordCount(map: StatusRecords): number {
  let count = 0;
  for (const held of map.values()) count += held.size;
  return count;
}

/** `scope\0sourcePath\0name`: a NUL appears in none of them, so the key cannot be ambiguous. */
export function mcpStatusKey(entry: McpStatusEntry): string {
  return `${entry.scope}\0${entry.sourcePath}\0${entry.name}`;
}

/**
 * Records the last known state of `entry` as it read `configKey`; a later
 * record for the same entry and content replaces it. A record for other
 * content (a writer behind the file, or ahead of the listing) is held beside
 * it, and whichever the file holds is shown.
 */
export function recordMcpStatus(entry: McpStatusEntry, configKey: string, status: McpServerStatus): void {
  const map = records();
  const key = mcpStatusKey(entry);
  const held = map.get(key) ?? new Map<string, McpServerStatus>();
  // Written again goes last at both levels, so eviction drops what was written longest ago:
  // the oldest record of the entry written to longest ago.
  map.delete(key);
  held.delete(configKey);
  held.set(configKey, status);
  map.set(key, held);
  for (let count = recordCount(map); count > MCP_STATUS_MAX_RECORDS; count--) {
    const [oldestKey, oldest] = map.entries().next().value as [string, Map<string, McpServerStatus>];
    oldest.delete(oldest.keys().next().value as string);
    if (oldest.size === 0) map.delete(oldestKey);
  }
}

/**
 * The status recorded for the entry as the file holds it now, or undefined.
 * Records made for other content are stale: they are dropped, so a changed
 * entry reads as untested, and still does once it is changed back.
 */
export function readMcpStatus(entry: McpStatusEntry, configKey: string): McpServerStatus | undefined {
  const map = records();
  const key = mcpStatusKey(entry);
  const held = map.get(key);
  if (!held) return undefined;
  const status = held.get(configKey);
  for (const other of [...held.keys()]) if (other !== configKey) held.delete(other);
  if (held.size === 0) map.delete(key);
  return status;
}

/**
 * The listing with each server's current status attached. Records of a file
 * that was read (`readFiles`, the files listed without a problem that hides
 * their servers) whose name the file no longer defines are dropped, which
 * keeps the map to what the files hold.
 */
export function withMcpStatuses(
  servers: McpServerInfo[],
  readFiles: readonly { scope: McpScope; path: string }[],
): McpServerInfo[] {
  const map = records();
  const listed = new Set(servers.map(mcpStatusKey));
  const read = new Set(readFiles.map((file) => `${file.scope}\0${file.path}\0`));
  for (const key of [...map.keys()]) {
    const fileKey = key.slice(0, key.lastIndexOf("\0") + 1);
    if (read.has(fileKey) && !listed.has(key)) map.delete(key);
  }
  return servers.map((server) => {
    const status = readMcpStatus(server, server.configKey);
    return status ? { ...server, status } : server;
  });
}

/** Whether the record held for `entry` as it read `configKey` is `status` itself: what one writer wrote and nobody has replaced since. */
export function isCurrentMcpStatus(entry: McpStatusEntry, configKey: string, status: McpServerStatus): boolean {
  return records().get(mcpStatusKey(entry))?.get(configKey) === status;
}

/**
 * Drops the record of `entry` as it read `configKey` when it is still
 * `status`, the one the caller wrote: a session's report of something it no
 * longer sees, which nothing would otherwise replace. A record someone wrote
 * since stays.
 */
export function forgetMcpStatus(entry: McpStatusEntry, configKey: string, status: McpServerStatus): boolean {
  if (!isCurrentMcpStatus(entry, configKey, status)) return false;
  const map = records();
  const key = mcpStatusKey(entry);
  const held = map.get(key);
  held?.delete(configKey);
  if (held?.size === 0) map.delete(key);
  return true;
}

/**
 * Replaces the record of `entry` as it read `configKey` with `next` when it
 * is still `status`, the one the caller wrote: a session amending its own
 * report (a connection it has closed since). A record someone wrote since
 * stays, and is the latest word.
 */
export function replaceMcpStatus(entry: McpStatusEntry, configKey: string, status: McpServerStatus, next: McpServerStatus): boolean {
  if (!isCurrentMcpStatus(entry, configKey, status)) return false;
  recordMcpStatus(entry, configKey, next);
  return true;
}

/**
 * Drops every record of `entry`, whatever content it was recorded for: what
 * connections found before a sign-out, which signed-out connections no longer
 * see. The entry then reads as untested until a test or a session reports.
 */
export function forgetMcpEntryStatuses(entry: McpStatusEntry): void {
  records().delete(mcpStatusKey(entry));
}

/** How many records are held; for tests. */
export function mcpStatusCount(): number {
  return recordCount(records());
}

/** Forgets every record; for tests. */
export function clearMcpStatuses(): void {
  records().clear();
  inactiveHosts().clear();
}

// ---------------------------------------------------------------------------
// Sessions whose MCP host is inactive
// ---------------------------------------------------------------------------

/** Sessions held at once; the least recently written goes first. */
export const MCP_INACTIVE_HOSTS_MAX = 100;

const INACTIVE_HOSTS_KEY: symbol = Symbol.for("pi-web:mcp-inactive-hosts");

function inactiveHosts(): Map<string, McpHostInactiveInfo> {
  const store = globalThis as Record<symbol, Map<string, McpHostInactiveInfo> | undefined>;
  return (store[INACTIVE_HOSTS_KEY] ??= new Map());
}

/**
 * Records that the session `sessionId` connects no server through Pi Web,
 * because its `/mcp` command is another extension's. Kept while the session
 * is open: its host forgets it when the session ends, or starts again with
 * Pi's own `/mcp`.
 */
export function recordMcpHostInactive(sessionId: string, info: McpHostInactiveInfo): void {
  const map = inactiveHosts();
  map.delete(sessionId);
  map.set(sessionId, info);
  while (map.size > MCP_INACTIVE_HOSTS_MAX) map.delete(map.keys().next().value as string);
}

/** Forgets the session's record; with `info`, only while the record is still that one. */
export function forgetMcpHostInactive(sessionId: string, info?: McpHostInactiveInfo): void {
  const map = inactiveHosts();
  if (info === undefined || map.get(sessionId) === info) map.delete(sessionId);
}

/**
 * The inactive session to tell the panel about: the latest one in `cwd`
 * when it names a folder that has one, else the latest of any folder, which
 * names its folder.
 */
export function readMcpHostInactive(cwd?: string): McpHostInactiveInfo | undefined {
  const all = [...inactiveHosts().values()].sort((a, b) => b.updatedAt - a.updatedAt);
  return (cwd === undefined ? undefined : all.find((info) => samePath(info.cwd, cwd))) ?? all[0];
}
