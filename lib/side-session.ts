/**
 * Side chats (ADR 0007): a focused detour beside the main chat. A side chat is
 * a normal session forked from a parent's active tip (`createSideSession()` in
 * `lib/session-fork.ts`) with two differences, both decided here: a
 * `pi-web:side` entry hides it in its parent's family, and it keeps only the
 * parent's read-mostly built-in tools. Its prompt stays the parent's plus one
 * sentence, so providers with native mid-conversation updates keep the cache.
 */

import { getCurrentTools } from "@earendil-works/pi-ai";
import type { SessionEntry } from "./types";

export const SIDE_META_TYPE = "pi-web:side";

/** The name a side chat's `session_info` entry carries. */
export const SIDE_SESSION_NAME = "Side chat";

/**
 * The tools a side chat may keep, as pi's allow-list: it also leaves out what
 * has no name to list, every extension, MCP, Code mode and subagent tool.
 */
export const SIDE_TOOLS: readonly string[] = ["read", "bash", "powershell", "grep", "find", "ls"];

/** What pi's default tools leave when a parent recorded no tools (older transcripts). */
const SIDE_FALLBACK_TOOLS: readonly string[] = ["read", "bash"];

/** Appended to the prompt once. A Chat-only side chat keeps its exact prompt without it. */
export const SIDE_SYSTEM_PROMPT = "Messages before the user's first side-chat message are inherited background from a parent session, not your current task.";

type SideMetadata = { version: 1; parentSessionId: string; createdAt: string };

function readSideMetadata(entries: readonly SessionEntry[]): SideMetadata | null {
  const entry = entries.find((item) => item.type === "custom" && item.customType === SIDE_META_TYPE);
  if (entry?.type !== "custom" || typeof entry.data !== "object" || entry.data === null) return null;
  const data = entry.data as Partial<SideMetadata>;
  if (data.version !== 1 || typeof data.parentSessionId !== "string" || typeof data.createdAt !== "string") return null;
  return data as SideMetadata;
}

/** A side chat's parent, from its metadata entry; null when the entries hold none. */
export function readSideRelation(entries: readonly SessionEntry[]): { parentSessionId: string } | null {
  const data = readSideMetadata(entries);
  return data ? { parentSessionId: data.parentSessionId } : null;
}

/** Whether any entry is a side metadata entry, valid or not: a broken one must never reopen with full tools. */
export function hasSideMetadata(entries: readonly SessionEntry[]): boolean {
  return entries.some((entry) => entry.type === "custom" && entry.customType === SIDE_META_TYPE);
}

/** The metadata entry a new side chat carries, to be written directly after its header. */
export function createSideMetadataEntry(parentSessionId: string, id: string, parentId: string | null) {
  const timestamp = new Date().toISOString();
  return {
    type: "custom",
    customType: SIDE_META_TYPE,
    data: { version: 1, parentSessionId, createdAt: timestamp } satisfies SideMetadata,
    id,
    parentId,
    timestamp,
  };
}

/**
 * The entries a side chat added itself: inherited ones are older than its
 * creation. Usage is counted on these, or the parent's would count twice.
 */
export function sideOwnEntries<T extends { timestamp?: string }>(entries: readonly T[]): readonly T[] {
  const createdAt = readSideMetadata(entries as unknown as SessionEntry[])?.createdAt;
  return createdAt ? entries.filter((entry) => (entry.timestamp ?? "") > createdAt) : entries;
}

/**
 * A side chat's active tools: the ones its transcript gives it, a pin first,
 * then the loadout pi recorded, cut down to `SIDE_TOOLS`. Never more than the
 * parent had, so a Read-only parent stays without a shell. Reopening reads the
 * same answer back from the side chat's own transcript.
 */
export function sideToolNames(
  pinned: readonly string[] | undefined,
  systemMessages: Parameters<typeof getCurrentTools>[0],
): string[] {
  const recorded = systemMessages.length > 0 ? getCurrentTools(systemMessages).map((tool) => tool.name) : undefined;
  return (pinned ?? recorded ?? SIDE_FALLBACK_TOOLS).filter((name) => SIDE_TOOLS.includes(name));
}
