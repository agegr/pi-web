/**
 * Side chats (ADR 0007): a focused detour beside the main chat. A side chat is
 * a normal session forked from a parent's active tip (`createSideSession()` in
 * `lib/session-fork.ts`) with three differences, all decided here: a
 * `pi-web:side` entry hides it in its parent's family, it keeps only the
 * parent's read-mostly built-in tools, and a hidden message marks where the
 * inherited history ends. The prompt is not touched, so providers with native
 * mid-conversation updates keep the cached prefix.
 */

import { getCurrentTools } from "@earendil-works/pi-ai";
import { SIDE_BOUNDARY_MESSAGE_TYPE } from "./session-family";
import type { SessionEntry } from "./types";

export const SIDE_META_TYPE = "pi-web:side";

/** The tools a side chat may keep of its parent's. */
export const SIDE_TOOLS: readonly string[] = ["read", "bash", "powershell", "grep", "find", "ls"];

/** What pi's default tools leave when a parent recorded no tools (older transcripts). */
const SIDE_FALLBACK_TOOLS: readonly string[] = ["read", "bash"];

/**
 * What the model reads at the end of the inherited history. pi sends a custom
 * message as a user turn, on every provider, at its place in the conversation:
 * a system prompt cannot say where a side chat starts on a model that folds
 * updates into the head. So it has to say it is not the user speaking.
 */
export const SIDE_BOUNDARY_TEXT = "[Side chat] This is a note from the app, not from the user. Everything above is inherited from a parent session as background, frozen when this side chat started. It is not your current task, and work left unfinished in it is not yours to continue. Only messages after this note are active.";

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

/** The hidden message a new side chat ends its inherited history with. */
export function createSideBoundaryEntry(id: string, parentId: string) {
  return {
    type: "custom_message",
    customType: SIDE_BOUNDARY_MESSAGE_TYPE,
    content: SIDE_BOUNDARY_TEXT,
    display: false,
    id,
    parentId,
    timestamp: new Date().toISOString(),
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
 * A side chat's tools, which `startRpcSession()` passes as pi's allow-list, so
 * nothing else registers, every extension, MCP, Code mode and subagent tool
 * included: the ones its transcript gives it, a pin first, then the loadout pi
 * recorded, cut down to `SIDE_TOOLS`. Never more than the parent had, so a
 * Read-only parent stays without a shell. Reopening reads the same answer back
 * from the side chat's own transcript.
 */
export function sideToolNames(
  pinned: readonly string[] | undefined,
  systemMessages: Parameters<typeof getCurrentTools>[0],
): string[] {
  const recorded = systemMessages.length > 0 ? getCurrentTools(systemMessages).map((tool) => tool.name) : undefined;
  return (pinned ?? recorded ?? SIDE_FALLBACK_TOOLS).filter((name) => SIDE_TOOLS.includes(name));
}
