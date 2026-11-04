/**
 * What a session row's menu offers (and a project group's name entries), as
 * plain data the sidebar turns into labelled items. Pure, so the rules
 * (nothing disk-backed for a transient session, archive disabled while a
 * family runs) are testable without a DOM. Fork leaves the source untouched
 * (it copies the finished entries of its current branch), so it is offered
 * everywhere: while the family runs and from the archive too. Open in new tab
 * only navigates (a browser tab loads the session's link): it is offered
 * everywhere a saved session is, after the actions that manage the session and
 * before Delete. Never first: a menu's first item takes focus when it opens,
 * so Enter right after opening would leave the tab. Also the requests behind
 * a project group's "Delete all sessions", with `fetch` passed in.
 */

import { projectNameOf, type SidebarFamilyStatus, type SidebarProject, type SidebarRow } from "./session-tree";
import type { SessionUiStateRequest } from "./session-ui-state-shared";

export type SessionMenuActionId =
  | "export-html"
  | "open-new-tab"
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
 * gets none: pin, archive, rename, fork and delete would all act on a missing
 * file, and another tab could not load it.
 * In the archive view, Pin also restores (pin and archive exclude each other).
 */
export function sessionMenuEntries(
  context: Extract<SidebarRow, { kind: "session" }>["context"],
  status: SidebarFamilyStatus,
): SessionMenuEntry[] {
  if (status.transient) return [];
  const exportHtml: SessionMenuEntry = { kind: "action", id: "export-html", shortcut: "E" };
  const openNewTab: SessionMenuEntry = { kind: "action", id: "open-new-tab", shortcut: "T" };
  if (context === "archive") {
    return [
      { kind: "action", id: "unarchive", shortcut: "A" },
      { kind: "action", id: "pin", shortcut: "P" },
      { kind: "action", id: "rename", shortcut: "R" },
      { kind: "action", id: "fork", shortcut: "F" },
      exportHtml,
      openNewTab,
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
    exportHtml,
    openNewTab,
    { kind: "separator" },
    { kind: "action", id: "delete", shortcut: "D" },
  ];
}

export type ProjectNameActionId = "rename-project" | "reset-project-name";

/** A group menu's name entries: Rename…, and Reset name while the project has a display name of its own. */
export function projectNameMenuEntries(project: Pick<SidebarProject, "customName">): ProjectNameActionId[] {
  return project.customName === null ? ["rename-project"] : ["rename-project", "reset-project-name"];
}

/**
 * What a group header's rename saves, or null when it changes nothing. The
 * field starts with the name shown; an untouched one saves nothing. Empty,
 * or the folder's own name, clears the display name: the folder name shows
 * either way, and a name equal to it would only hide that it is one.
 */
export function projectRenameRequest(
  project: Pick<SidebarProject, "key" | "root" | "name" | "customName">,
  value: string,
): Extract<SessionUiStateRequest, { action: "rename-project" }> | null {
  const name = value.trim();
  if (name === project.name) return null;
  const clear = name === "" || name === projectNameOf(project.root);
  if (clear && project.customName === null) return null;
  return { action: "rename-project", projectKey: project.key, name: clear ? null : name };
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

/**
 * A refused "New worktree…" (POST /api/worktrees): a branch another worktree
 * has checked out names that checkout in the user's language (git checks a
 * branch out once), or says its folder is gone and `git worktree prune`
 * clears it; anything else is the server's error, as before.
 */
export function worktreeCreateFailure(
  data: { error?: string; code?: string; branch?: string; worktreePath?: string },
  status: number,
): { key: string; params: { branch: string; path: string } } | { error: string } {
  const key = data.code === "branch_in_use" ? "sidebar.worktreeBranchInUse"
    : data.code === "branch_worktree_missing" ? "sidebar.worktreeBranchMissing"
    : null;
  if (key && data.branch && data.worktreePath) {
    return { key, params: { branch: data.branch, path: data.worktreePath } };
  }
  return { error: data.error ?? `HTTP ${status}` };
}

/** Root ids per POST /api/sessions/delete (the route's MAX_SESSION_DELETE_IDS). */
export const PROJECT_DELETE_IDS_PER_REQUEST = 500;

/** What a project's "Delete all sessions" did, summed over its requests. */
export interface ProjectSessionsDeleteOutcome {
  /** The root ids deleted; their subagent sessions went with them. */
  deletedRoots: string[];
  /** Every session id deleted, subagent sessions included. */
  deleted: string[];
  /** Root ids kept because they started running after the confirmation. */
  running: string[];
  /** Why a request failed; the parts sent before it were deleted. */
  error: string | null;
}

/**
 * Deletes the root ids a project's confirmation showed, in parts of
 * PROJECT_DELETE_IDS_PER_REQUEST, one request at a time. A refused part ends
 * the run: what was deleted until then is reported with the error.
 */
export async function deleteProjectSessions(
  ids: readonly string[],
  fetchImpl: typeof fetch,
): Promise<ProjectSessionsDeleteOutcome> {
  const outcome: ProjectSessionsDeleteOutcome = { deletedRoots: [], deleted: [], running: [], error: null };
  for (let start = 0; start < ids.length; start += PROJECT_DELETE_IDS_PER_REQUEST) {
    const part = ids.slice(start, start + PROJECT_DELETE_IDS_PER_REQUEST);
    try {
      const res = await fetchImpl("/api/sessions/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: part }),
      });
      const data = await res.json().catch(() => ({})) as { deleted?: string[]; running?: string[]; error?: string };
      if (!res.ok || !Array.isArray(data.deleted)) {
        outcome.error = data.error ?? `HTTP ${res.status}`;
        break;
      }
      const deleted = new Set(data.deleted);
      outcome.deleted.push(...data.deleted);
      outcome.deletedRoots.push(...part.filter((id) => deleted.has(id)));
      outcome.running.push(...(data.running ?? []));
    } catch (error) {
      outcome.error = error instanceof Error ? error.message : String(error);
      break;
    }
  }
  return outcome;
}
