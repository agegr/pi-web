import { listSessionFamilies, type SessionFamily } from "./session-family";
import { familyIds, isFamilyArchived, projectNameOf } from "./session-tree";
import { storedProjectName, type SessionUiState } from "./session-ui-state-shared";
import type { SessionInfo } from "./types";
import { workspaceKeyOf } from "./workspace-memory";

export type ActivityGroup = "priority" | "today" | "yesterday" | "week" | "earlier";
export type ActivityRow =
  | { kind: "header"; key: `activity-header:${ActivityGroup}`; group: ActivityGroup }
  | {
      kind: "session";
      key: string;
      family: SessionFamily;
      projectName: string;
      running: boolean;
      awaiting: boolean;
      unread: boolean;
      selected: boolean;
      retained: boolean;
    };

export interface SessionActivityInput {
  sessions: readonly SessionInfo[];
  uiState: SessionUiState;
  runningIds: ReadonlySet<string>;
  awaitingIds: ReadonlySet<string>;
  unreadIds: ReadonlySet<string>;
  selectedSessionId: string | null;
  retainedUnreadRootId: string | null;
  now: Date;
}

function dateGroup(value: string, now: Date): ActivityGroup {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return "earlier";
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const week = new Date(today);
  week.setDate(week.getDate() - 6);
  return time >= today.getTime() ? "today"
    : time >= yesterday.getTime() ? "yesterday"
    : time >= week.getTime() ? "week" : "earlier";
}

/** One row per live family: attention first, then calendar groups, newest first within each. */
export function buildSessionActivityRows(input: SessionActivityInput): ActivityRow[] {
  const groups: Record<ActivityGroup, Extract<ActivityRow, { kind: "session" }>[]> = {
    priority: [], today: [], yesterday: [], week: [], earlier: [],
  };
  for (const family of listSessionFamilies(input.sessions)) {
    if (isFamilyArchived(family, input.uiState, input.runningIds)) continue;
    const ids = familyIds(family);
    const running = ids.some((id) => input.runningIds.has(id));
    const awaiting = ids.some((id) => input.awaitingIds.has(id));
    const unread = ids.some((id) => input.unreadIds.has(id));
    const selected = input.selectedSessionId !== null && ids.includes(input.selectedSessionId);
    const retained = selected && !unread && input.retainedUnreadRootId === family.root.id;
    const key = workspaceKeyOf(family.root);
    const projectName = storedProjectName(input.uiState, key)
      ?? projectNameOf(family.root.projectRoot ?? family.root.cwd);
    const group = running || awaiting || unread || retained ? "priority" : dateGroup(family.latestModified, input.now);
    groups[group].push({
      kind: "session", key: `activity-session:${family.root.id}`, family, projectName,
      running, awaiting, unread, selected, retained,
    });
  }

  const rows: ActivityRow[] = [];
  for (const group of ["priority", "today", "yesterday", "week", "earlier"] as const) {
    const entries = groups[group];
    if (entries.length === 0) continue;
    // Invalid dates go last; stable sort keeps the catalogue's order for ties.
    entries.sort((a, b) => {
      const aTime = Date.parse(a.family.latestModified);
      const bTime = Date.parse(b.family.latestModified);
      const left = Number.isFinite(aTime) ? aTime : -Infinity;
      const right = Number.isFinite(bTime) ? bTime : -Infinity;
      return left === right ? 0 : left > right ? -1 : 1;
    });
    rows.push({ kind: "header", key: `activity-header:${group}`, group }, ...entries);
  }
  return rows;
}

/** A completion already observed in another tab must not recreate a marker read there. */
export function newlyObservedCompletions(ids: readonly string[], completedIds: ReadonlySet<string>): string[] {
  return ids.filter((id) => !completedIds.has(id));
}

/** Completion provenance is separate from manually marked unread sessions. */
export function countCompletedUnread(
  completedIds: ReadonlySet<string>,
  unreadIds: ReadonlySet<string>,
  sessions: readonly SessionInfo[],
  uiState: SessionUiState,
  runningIds: ReadonlySet<string>,
): number {
  if (completedIds.size === 0 || unreadIds.size === 0) return 0;
  let count = 0;
  for (const family of listSessionFamilies(sessions)) {
    if (isFamilyArchived(family, uiState, runningIds)) continue;
    for (const id of familyIds(family)) if (completedIds.has(id) && unreadIds.has(id)) count++;
  }
  return count;
}
