/**
 * Side chats (ADR 0007): a focused detour beside the main chat. A side chat is
 * a normal session forked from a parent's last ended turn (`createSideSession()`
 * in `lib/session-fork.ts`; `sideInheritedLeafId()` below) with three
 * differences, all decided here: a `pi-web:side` entry hides it in its parent's
 * family, it keeps only the parent's read-mostly built-in tools, and a hidden
 * message marks where the inherited history ends. The prompt is not touched, so
 * providers with native mid-conversation updates keep the cached prefix.
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

/**
 * The part of an entry the rewind reads: its id and, on a message, who spoke
 * and how a reply ended. A structural subset of `SessionEntry`, so a test can
 * pass plain fixtures.
 */
type SideCutEntry = {
  type: string;
  id: string;
  message?: { role?: string; stopReason?: string };
};

/**
 * Where a side chat's copy ends: the parent's last ended turn, not necessarily
 * the parent's leaf. A raw-leaf copy taken mid-run ends on the turn that was in
 * flight: an unanswered user prompt, or tool calls with no result (pi-ai sends
 * "No result provided"). That tail reads to the model as an interrupted run to
 * continue, so the side chat kept working on the parent's task instead of
 * answering the question it was asked. Ending at the last ended turn makes the
 * inherited history look finished, and the boundary message below it the actual
 * current instruction.
 *
 * Only the copy is rewound: the parent's session file and its live wrapper's
 * leaf stay exactly as they were. The cost is that the in-flight turn is not
 * inherited; a quote or a selection is the way to ask about a piece of it.
 *
 * A reply ends its turn on `stop` or `aborted` (the parent's run is over, even
 * if the user stopped it). `error` and `length` are not cut points: a reply the
 * provider errored on, or one cut at the output limit, is continued in the same
 * run (docs/agents/sessions.md, `lib/message-display.ts`), so its turn is still
 * in flight.
 *
 * The cut never goes behind the newest `compaction` entry: when that entry is
 * newer than the candidate, the cut is the compaction itself. Cutting before it
 * would hand the copy the full pre-compaction history with no summary, which is
 * the state compaction exists to avoid: the history no longer fits the
 * window. Cutting at it is safe and the parent's own compacted view: its
 * `firstKeptEntryId` always names an entry that is an ancestor of the
 * compaction, and nothing is in flight after it once it is written (pi's
 * threshold compaction runs after `agent_end` and keeps the completed response;
 * a manual `/compact` ends the same way). When the compaction is the leaf it is
 * literally the parent's leaf, so the copy is the parent's; when a turn after it
 * is in flight, cutting at it still drops that turn while keeping the summary.
 *
 * `branch` is in parent-chain order. With no ended reply, the last user prompt
 * is the fallback, so a parent whose only run never finished still gets the
 * question it asked. With neither, `leafId` is returned unchanged and the
 * existing refusals decide.
 */
export function sideInheritedLeafId(branch: readonly SideCutEntry[], leafId: string): string {
  let cutIndex = -1;
  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index];
    if (entry.type !== "message") continue;
    const message = entry.message;
    if (message?.role === "assistant" && (message.stopReason === "stop" || message.stopReason === "aborted")) {
      cutIndex = index;
      break;
    }
  }
  if (cutIndex < 0) {
    for (let index = branch.length - 1; index >= 0; index -= 1) {
      const entry = branch[index];
      if (entry.type === "message" && entry.message?.role === "user") {
        cutIndex = index;
        break;
      }
    }
  }
  if (cutIndex < 0) return leafId;
  // A cut behind the newest compaction would drop its summary, so a cut that
  // would land there stops at it instead.
  for (let index = branch.length - 1; index > cutIndex; index -= 1) {
    if (branch[index].type === "compaction") return branch[index].id;
  }
  return branch[cutIndex].id;
}
