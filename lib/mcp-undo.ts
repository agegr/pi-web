import { randomUUID } from "node:crypto";
import type { McpScope } from "./api-types";

// What Settings › MCP's Undo needs after a Remove (ADR 0006: "Remove is
// undoable for 60 seconds; the removed entry is held server-side and never
// sent back to the browser"). A removed entry may hold literal secrets, so it
// stays in this process's memory, keyed by a random token, and only the token
// reaches the browser. Route handlers are bundled separately and hot reload
// re-evaluates modules, so the map lives on globalThis; a server restart
// drops it, which only ends the undo early.

export const MCP_UNDO_TTL_MS = 60_000;
/** Removals held at once; the oldest goes first. Bounded by how fast anyone removes servers. */
export const MCP_UNDO_MAX_RECORDS = 100;

/** A removed `mcpServers` entry and where it came from. */
export interface McpRemovedEntry {
  scope: McpScope;
  name: string;
  /** The configured path it was removed from, as the panel shows it. */
  path: string;
  /** The project folder, for a project entry; undo checks its trust again. */
  cwd?: string;
  /** The raw entry, literal values included. Never serialized. */
  entry: unknown;
  /** Its position among the file's entries, so undo puts it back where it stood. */
  index: number;
}

export interface McpHeldRemoval extends McpRemovedEntry {
  token: string;
  /** When the hold ends, in this process's clock. */
  expiresAt: number;
}

interface HeldRecord extends McpHeldRemoval {
  timer: ReturnType<typeof setTimeout>;
}

const STORE_KEY: symbol = Symbol.for("pi-web:mcp-undo");

function records(): Map<string, HeldRecord> {
  const store = globalThis as Record<symbol, Map<string, HeldRecord> | undefined>;
  return (store[STORE_KEY] ??= new Map());
}

function forget(token: string, record: HeldRecord): void {
  clearTimeout(record.timer);
  // Only this record: the token may have been put back as a new one since.
  if (records().get(token) === record) records().delete(token);
}

function hold(removal: McpHeldRemoval, now: number): void {
  const map = records();
  while (map.size >= MCP_UNDO_MAX_RECORDS) {
    const [oldestToken, oldest] = map.entries().next().value as [string, HeldRecord];
    forget(oldestToken, oldest);
  }
  const record = { ...removal } as HeldRecord;
  record.timer = setTimeout(() => forget(removal.token, record), Math.max(0, removal.expiresAt - now));
  // A pending undo never keeps the process alive.
  record.timer.unref?.();
  map.set(removal.token, record);
}

function release(record: HeldRecord): McpHeldRemoval {
  const { timer, ...removal } = record;
  void timer;
  return removal;
}

/** Holds a removed entry for `ttlMs` and returns the token that can undo it. */
export function holdRemovedEntry(
  removed: McpRemovedEntry,
  { now = Date.now(), ttlMs = MCP_UNDO_TTL_MS }: { now?: number; ttlMs?: number } = {},
): { token: string; expiresAt: number } {
  const token = randomUUID();
  const expiresAt = now + ttlMs;
  hold({ ...removed, token, expiresAt }, now);
  return { token, expiresAt };
}

/**
 * Takes the removal a token holds, once: a second undo of the same token, an
 * expired one, or an unknown one gets undefined. A caller whose restore fails
 * hands it back with `returnRemovedEntry()`.
 */
export function takeRemovedEntry(token: string, now = Date.now()): McpHeldRemoval | undefined {
  const record = records().get(token);
  if (!record) return undefined;
  forget(token, record);
  return record.expiresAt > now ? release(record) : undefined;
}

/** Puts back a removal a failed undo took, for the time it had left. */
export function returnRemovedEntry(removal: McpHeldRemoval, now = Date.now()): void {
  if (removal.expiresAt <= now || records().has(removal.token)) return;
  hold(removal, now);
}

/** How many removals are held; for tests. */
export function heldRemovalCount(): number {
  return records().size;
}
