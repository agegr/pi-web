/**
 * What a session row's menu offers, as plain data the sidebar turns into
 * labelled items. Pure, so the rules (nothing disk-backed for a transient
 * session, archive disabled while a family runs) are testable without a DOM.
 * Fork leaves the source untouched (it copies the finished entries of its
 * current branch), so it is offered everywhere: while the family runs and
 * from the archive too.
 */

import type { SidebarFamilyStatus, SidebarRow } from "./session-tree";

export type SessionMenuActionId =
  | "pin"
  | "unpin"
  | "rename"
  | "fork"
  | "mark-read"
  | "mark-unread"
  | "archive"
  | "unarchive"
  | "delete";

export type SessionMenuEntry =
  | { kind: "action"; id: SessionMenuActionId; shortcut: string; disabledReason?: "running" }
  | { kind: "separator" };

/**
 * A session row's built-in menu. A transient session has no file yet, so it
 * gets none: pin, archive, rename, fork and delete would all act on a missing file.
 * In the archive view, Pin also restores (pin and archive exclude each other).
 */
export function sessionMenuEntries(
  context: Extract<SidebarRow, { kind: "session" }>["context"],
  status: SidebarFamilyStatus,
): SessionMenuEntry[] {
  if (status.transient) return [];
  if (context === "archive") {
    return [
      { kind: "action", id: "unarchive", shortcut: "A" },
      { kind: "action", id: "pin", shortcut: "P" },
      { kind: "action", id: "rename", shortcut: "R" },
      { kind: "action", id: "fork", shortcut: "F" },
      { kind: "separator" },
      { kind: "action", id: "delete", shortcut: "D" },
    ];
  }
  return [
    { kind: "action", id: context === "pinned" ? "unpin" : "pin", shortcut: "P" },
    { kind: "action", id: "rename", shortcut: "R" },
    { kind: "action", id: "fork", shortcut: "F" },
    { kind: "action", id: status.unread ? "mark-read" : "mark-unread", shortcut: "U" },
    // A running family would come straight back: archiving waits for the run.
    status.running
      ? { kind: "action", id: "archive", shortcut: "A", disabledReason: "running" }
      : { kind: "action", id: "archive", shortcut: "A" },
    { kind: "separator" },
    { kind: "action", id: "delete", shortcut: "D" },
  ];
}

/**
 * The toast for a refused fork (POST /api/sessions/[id]/fork's `code`), as a
 * message key and its parameters: a known refusal says why in the user's
 * language, anything else shows the server's error.
 */
export function forkFailureMessage(code: string | undefined, error: string): { key: string; params?: { error: string } } {
  switch (code) {
    case "not_found": return { key: "sidebar.forkNotFound" };
    case "unsaved": return { key: "sidebar.forkUnsaved" };
    case "empty": return { key: "sidebar.forkEmpty" };
    case "subagent":
    case "request-denied":
      return { key: "sidebar.forkUnavailable" };
    default: return { key: "sidebar.forkFailed", params: { error } };
  }
}
