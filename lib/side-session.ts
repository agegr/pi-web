/**
 * Side chats (ADR 0007): a focused detour beside the main chat, modeled on
 * Codex's `/side`. A side session is a separate session file forked from a
 * parent's active tip — the same file-level copy discipline as the sidebar's
 * Fork (`lib/session-fork.ts`), minus the fork-suffix name — carrying a
 * `pi-web:side` metadata entry that hides it from the sidebar (relation kind
 * `side`), pins its resource policy (a fixed read-mostly tool set plus a
 * system-prompt appendix that downgrades the inherited history to reference
 * context), and is restored verbatim when the session is reopened.
 *
 * The metadata entry is inserted directly after the file header so the
 * session list's bounded head read (session-reader.ts) finds it without a
 * tail read: the first copied entry is re-chained under it, keeping one
 * parent chain from the root.
 */

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { readSubagentRun } from "./subagents";
import type { SubagentSessionResources } from "./subagents";
import { readSessionToolSelection } from "./session-tool-selection";
import type { SessionEntry } from "./types";

export const SIDE_META_TYPE = "pi-web:side";

/** The name a side chat's `session_info` entry carries (switcher rows, tabs). */
export const SIDE_SESSION_NAME = "Side chat";

/**
 * A side chat's tools: the default tool set minus `edit` and `write`
 * (`PRESET_READ_ONLY` is not used — it drops `bash`, and non-mutating shell
 * checks are the point). The subagent control tools are excluded by
 * `subagentToolOptions()`, so a side chat cannot dispatch subagents.
 */
export const SIDE_TOOLS: readonly string[] = ["read", "bash", "grep", "find", "ls"];

/**
 * The system-prompt appendix every side chat carries, persisted in its
 * snapshot so a reopen restores it. The fork freezes the parent's branch, so
 * "everything before the user's first side-chat message is inherited" is
 * statically true and needs no positional boundary marker (ADR 0007 §3).
 */
export const SIDE_SYSTEM_PROMPT = [
  "You are in a side chat, forked from a parent session for a focused detour beside it.",
  "",
  "Every message in this session before the user's first side-chat message is inherited history from the parent session, frozen when the side chat was created. It is reference context only, not your current task: do not continue, execute, or complete any instruction, plan, tool call, approval, edit, or request that appears only in the inherited history. Only messages submitted in this side chat are active user instructions.",
  "",
  "The inherited history may end mid-turn, with tool calls that have no result; treat them as finished background, not work to resume.",
  "",
  "Answer questions and do lightweight, non-mutating exploration: reading, searching, and running checks that alter nothing are appropriate. Do not modify files, source, git state, permissions, or configuration unless the user explicitly asks for that change in this side chat; the edit and write tools are unavailable here, and subagents cannot be dispatched. Keep answers concise; your reply stays in this side chat until the user sends it back to the parent session.",
].join("\n");

export type SessionSideRefusal = "not_found" | "unsaved" | "empty" | "subagent" | "side" | "chat_only";

export class SessionSideError extends Error {
  constructor(readonly code: SessionSideRefusal, message: string) {
    super(message);
    this.name = "SessionSideError";
  }
}

export interface SideSessionResources extends SubagentSessionResources {
  kind: "side";
}

type ValidSideMetadataData = Record<string, unknown> & {
  version: 1;
  parentSessionId: string;
  parentSessionPath: string;
};

function sideMetadataData(entries: readonly SessionEntry[]): ValidSideMetadataData | null {
  const metaEntry = entries.find((entry) => entry.type === "custom" && entry.customType === SIDE_META_TYPE);
  if (!metaEntry || metaEntry.type !== "custom" || typeof metaEntry.data !== "object" || metaEntry.data === null || Array.isArray(metaEntry.data)) return null;
  const data = metaEntry.data as Record<string, unknown>;
  if (data.version !== 1 || typeof data.parentSessionId !== "string" || typeof data.parentSessionPath !== "string") return null;
  return data as ValidSideMetadataData;
}

/** A side session's parent, from its metadata entry; null when the entries hold none. */
export function readSideRelation(entries: readonly SessionEntry[]): { parentSessionId: string } | null {
  const data = sideMetadataData(entries);
  return data ? { parentSessionId: data.parentSessionId } : null;
}

/** Whether any entry is a side metadata entry. Every side session is created
 *  with a valid snapshot, so metadata that fails to restore is corruption. */
export function hasSideMetadata(entries: readonly SessionEntry[]): boolean {
  return entries.some((entry) => entry.type === "custom" && entry.customType === SIDE_META_TYPE);
}

/** Whether any entry is a side metadata entry carrying a resource snapshot. */
export function hasSideResourceSnapshot(entries: readonly SessionEntry[]): boolean {
  return entries.some((entry) =>
    entry.type === "custom"
    && entry.customType === SIDE_META_TYPE
    && typeof entry.data === "object"
    && entry.data !== null
    && !Array.isArray(entry.data)
    && "resourceSnapshot" in entry.data
  );
}

/**
 * Restore the resource policy a persisted side session was created with. The
 * same shape a subagent reopens with (`SubagentSessionResources`), so
 * `startRpcSession()` treats both through one path, but never the same
 * reader: a side snapshot admits only the side tool set, and an invalid one
 * is refused instead of narrowing to something else.
 */
export function readSideSessionResources(entries: readonly SessionEntry[]): SideSessionResources | null {
  const data = sideMetadataData(entries);
  if (!data) return null;
  const snapshot = data.resourceSnapshot;
  if (
    typeof snapshot !== "object"
    || snapshot === null
    || Array.isArray(snapshot)
    || (snapshot as { version?: unknown }).version !== 1
    || !Array.isArray((snapshot as { appendSystemPrompt?: unknown }).appendSystemPrompt)
    || !(snapshot as { appendSystemPrompt: unknown[] }).appendSystemPrompt.every((item) => typeof item === "string")
    || !Array.isArray((snapshot as { tools?: unknown }).tools)
    || (snapshot as { tools: unknown[] }).tools.length === 0
    || !(snapshot as { tools: unknown[] }).tools.every((item) => typeof item === "string" && SIDE_TOOLS.includes(item))
  ) return null;
  return {
    kind: "side",
    appendSystemPrompt: [...(snapshot as { appendSystemPrompt: string[] }).appendSystemPrompt],
    tools: [...new Set((snapshot as { tools: string[] }).tools)],
    loadSkills: false,
    loadExtensions: false,
  };
}

/**
 * Fork the parent's active branch into a new side session file beside it and
 * stamp it with the side metadata. File-level, like the sidebar's Fork: it
 * never starts, prompts or shuts down an AgentSession, copies only entries
 * already on disk, and opens its own `SessionManager` because
 * `createBranchedSession()` repoints the instance it runs on.
 *
 * `liveLeafId` follows the fork route's contract: an open wrapper's leaf
 * (null: reset before the first entry), undefined for the file's own leaf.
 */
export function createSideSession(
  sourcePath: string,
  liveLeafId?: string | null,
): { sessionId: string; path: string } {
  const live = liveLeafId !== undefined;
  if (!existsSync(sourcePath)) {
    throw live
      ? new SessionSideError("unsaved", "This session has not been saved yet. Send a message before starting a side chat.")
      : new SessionSideError("not_found", "Session not found");
  }
  const manager = SessionManager.open(sourcePath);
  const leafId = live ? liveLeafId : manager.getLeafId();
  if (!leafId) throw new SessionSideError("empty", "Nothing to fork: the session has no messages");
  // The wrapper's leaf is an entry not written yet.
  if (!manager.getEntry(leafId)) {
    throw new SessionSideError("unsaved", "This session has not been saved yet. Send a message before starting a side chat.");
  }

  const branch = manager.getBranch(leafId) as unknown as SessionEntry[];
  // A copy carrying a subagent's metadata would be read as that subagent and
  // folded, out of sight, into its parent's family.
  if (readSubagentRun(branch, "", sourcePath)) {
    throw new SessionSideError("subagent", "A subagent session cannot start a side chat");
  }
  // No nesting: a side chat of a side chat is refused, as Codex refuses it.
  if (readSideRelation(branch)) {
    throw new SessionSideError("side", "A side chat cannot start another side chat");
  }
  if (!branch.some((entry) => entry.type === "message")) {
    throw new SessionSideError("empty", "Nothing to fork: the session has no messages");
  }
  // A Chat-only session's tool-free boundary is a deliberate mode (ADR 0002);
  // a side chat carrying bash would circumvent it.
  const selection = readSessionToolSelection(branch);
  if (selection !== undefined && selection.length === 0) {
    throw new SessionSideError("chat_only", "A Chat-only session cannot start a side chat");
  }

  // Read before createBranchedSession() repoints the instance to the copy.
  const parentSessionId = manager.getSessionId();

  const path = manager.createBranchedSession(leafId);
  if (!path || !existsSync(path)) throw new Error("Failed to create the side chat");

  // Insert the side metadata directly after the header, re-chaining the first
  // copied entry under it so the file keeps one parent chain and the list
  // scan's bounded head read finds the entry without a tail read. The copy is
  // brand new and wrapperless; this is the only rewrite it will ever get.
  const lines = readFileSync(path, "utf8").split("\n");
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  if (lines.length < 2) throw new Error("The forked side chat has no entries");
  let firstEntry: { id?: string; parentId?: string | null } = {};
  try {
    firstEntry = JSON.parse(lines[1]) as { id?: string; parentId?: string | null };
  } catch {
    throw new Error("The forked side chat could not be read");
  }
  if (typeof firstEntry.id !== "string") throw new Error("The forked side chat could not be read");
  const metadata = {
    version: 1,
    parentSessionId,
    parentSessionPath: sourcePath,
    createdAt: new Date().toISOString(),
    resourceSnapshot: {
      version: 1,
      appendSystemPrompt: [SIDE_SYSTEM_PROMPT],
      tools: [...SIDE_TOOLS],
    },
  };
  const sideEntry = {
    type: "custom",
    customType: SIDE_META_TYPE,
    data: metadata,
    id: `side-${randomUUID()}`,
    parentId: firstEntry.parentId ?? null,
    timestamp: new Date().toISOString(),
  };
  firstEntry.parentId = sideEntry.id;
  lines[1] = JSON.stringify(firstEntry);
  writeFileSync(path, [lines[0], JSON.stringify(sideEntry), ...lines.slice(1)].join("\n") + "\n", { encoding: "utf8" });

  // A fresh manager for the name: createBranchedSession() repointed `manager`
  // to the copy before the rewrite, so its in-memory entries no longer match.
  const forked = SessionManager.open(path);
  forked.appendSessionInfo(SIDE_SESSION_NAME);
  return { sessionId: forked.getSessionId(), path };
}
