/**
 * Flat row model of the sidebar's session tree.
 *
 * Every project is a collapsible group of session families; pinned families
 * move to one global section above the groups, archived families leave the
 * tree for the archive view. The component renders `rows` with a virtualizer
 * over per-kind heights (`getRowOffsets` + `getVisibleRowIndices`), so every
 * decision about what is shown lives here, pure and testable.
 *
 * Pin and archive flags are keyed by the family ROOT session id. An archived
 * family returns on its own when the root session gets a newer message
 * (`root.modified`, not `latestModified`: subagent activity alone does not
 * bring it back) or while any member is running.
 *
 * Groups keep the stored project order (`projectOrder`): activity never moves
 * a project that has a place in it. Pinned projects come first, then the
 * rest; in each band the projects without a place come first.
 */

import { listSessionFamilies, type SessionFamily } from "./session-family";
import type { ProjectMovePosition, SessionUiFamilyState, SessionUiState } from "./session-ui-state-shared";
import type { SessionInfo } from "./types";
import { workspaceKeyOf } from "./workspace-memory";

export type SidebarLayout = "desktop" | "mobile";
export type SidebarRowKind =
  | "pinned-header" | "session" | "pinned-more" | "group" | "group-more" | "group-empty"
  | "spacer" | "footer-open" | "footer-archived" | "archive-group";

export const SIDEBAR_ROW_HEIGHTS: Record<SidebarLayout, Record<SidebarRowKind, number>> = {
  desktop: { "pinned-header": 26, session: 32, "pinned-more": 26, group: 28, "group-more": 26, "group-empty": 30, spacer: 8, "footer-open": 30, "footer-archived": 30, "archive-group": 26 },
  mobile: { "pinned-header": 30, session: 44, "pinned-more": 36, group: 40, "group-more": 36, "group-empty": 40, spacer: 8, "footer-open": 44, "footer-archived": 44, "archive-group": 30 },
};
export const GROUP_VISIBLE_LIMIT = 6;
export const PINNED_VISIBLE_LIMIT = 8;
/** How many more families each "show more" click reveals. */
export const SHOW_MORE_STEP = 20;
/** `moreShown` entry for the pinned section's "show more". */
export const PINNED_MORE_KEY = "pinned";

export interface SidebarProject { key: string; root: string; name: string; pinned: boolean; current: boolean }
export interface SidebarFamilyStatus { running: boolean; awaiting: boolean; unread: boolean; selected: boolean; transient: boolean }

export type SidebarRow =
  | { kind: "pinned-header"; key: "pinned-header"; count: number; collapsed: boolean; running: number; unread: number }
  | { kind: "session"; key: string; family: SessionFamily; context: "pinned" | "group" | "archive"; project: SidebarProject; status: SidebarFamilyStatus; archivedAt: number | null }
  | { kind: "pinned-more"; key: "pinned-more"; hidden: number; canShowLess: boolean }
  | { kind: "group"; key: string; project: SidebarProject; expanded: boolean; running: number; unread: number }
  | { kind: "group-more"; key: string; projectKey: string; hidden: number; canShowLess: boolean }
  | { kind: "group-empty"; key: string; project: SidebarProject }
  | { kind: "spacer"; key: string }
  | { kind: "footer-open"; key: "footer-open" }
  | { kind: "footer-archived"; key: "footer-archived"; count: number }
  | { kind: "archive-group"; key: string; project: SidebarProject; count: number };

export interface SessionTreeInput {
  /** The full catalog (allSessions), subagents included. */
  sessions: readonly SessionInfo[];
  uiState: SessionUiState;
  runningIds: ReadonlySet<string>;
  /** Members parked on an extension's blocking dialog, a subset of runningIds (/api/agent/running). */
  awaitingIds: ReadonlySet<string>;
  unreadIds: ReadonlySet<string>;
  selectedSessionId: string | null;
  /** projectFor(selectedCwd); shown as a group even without sessions. */
  currentProject: { key: string; root: string } | null;
  /** Explicit user choices only (from prefs); see isGroupExpanded. */
  groupExpansion: Readonly<Record<string, boolean>>;
  /** Families revealed beyond the base limit by "show more", per projectKey or PINNED_MORE_KEY. */
  moreShown: Readonly<Record<string, number>>;
  pinnedCollapsed: boolean;
}

export interface SessionTreeModel {
  rows: SidebarRow[];
  /** Projects in group order. */
  projects: SidebarProject[];
  /** Archived families across all projects. */
  archivedCount: number;
  /**
   * Shown projects without a place in `projectOrder`, per band, top to
   * bottom: a move saves its band's ones first, so it lands where it was seen.
   */
  unorderedKeysByBand: { pinned: string[]; other: string[] };
  /**
   * Of those, the ones the sidebar saves on its own, top to bottom: pinned
   * projects, and projects with a saved (not transient) live family. Not the
   * current project while it has none, nor a project of transient sessions
   * only: either may never get a file.
   */
  projectKeysToRecord: string[];
}

type FamilyFlagsInput = Pick<SessionTreeInput, "uiState" | "runningIds" | "awaitingIds" | "unreadIds" | "selectedSessionId">;

function familyEntry(state: SessionUiState, rootId: string): SessionUiFamilyState | undefined {
  // Session ids such as "constructor" must not resolve to Object.prototype members.
  return Object.hasOwn(state.sessions, rootId) ? state.sessions[rootId] : undefined;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Time value for ordering: newest first, unparsable dates last. */
function timeOf(value: string): number {
  const time = Date.parse(value);
  return Number.isNaN(time) ? -Infinity : time;
}

/** Descending comparison that is safe for ±Infinity (a - b would give NaN). */
function compareDesc(a: number, b: number): number {
  return a === b ? 0 : a > b ? -1 : 1;
}

export function familyIds(family: SessionFamily): string[] {
  return [family.root.id, ...family.subagents.map((session) => session.id)];
}

function anyMemberIn(family: SessionFamily, ids: ReadonlySet<string>): boolean {
  if (ids.size === 0) return false;
  return ids.has(family.root.id) || family.subagents.some((session) => ids.has(session.id));
}

function isMember(family: SessionFamily, sessionId: string | null): boolean {
  if (!sessionId) return false;
  return family.root.id === sessionId || family.subagents.some((session) => session.id === sessionId);
}

/**
 * archivedAt set AND no family member running AND (root.detailsPending OR
 * archivedAt >= Date.parse(root.modified)). A summary row (detailsPending)
 * carries only stat metadata, so its time is not trusted to un-archive; an
 * unparsable root.modified likewise keeps the family archived.
 */
export function isFamilyArchived(family: SessionFamily, state: SessionUiState, runningIds: ReadonlySet<string>): boolean {
  const archivedAt = finiteNumber(familyEntry(state, family.root.id)?.archivedAt);
  if (archivedAt === null) return false;
  if (anyMemberIn(family, runningIds)) return false;
  if (family.root.detailsPending) return true;
  const modified = Date.parse(family.root.modified);
  return Number.isNaN(modified) || archivedAt >= modified;
}

/** pinnedAt set AND not isFamilyArchived. */
export function isFamilyPinned(family: SessionFamily, state: SessionUiState, runningIds: ReadonlySet<string>): boolean {
  return finiteNumber(familyEntry(state, family.root.id)?.pinnedAt) !== null
    && !isFamilyArchived(family, state, runningIds);
}

/** Last path segment of a project root, for "/" and "\\" paths alike. */
export function projectNameOf(root: string): string {
  const trimmed = root.replace(/[\\/]+$/, "");
  // "/" (or "\\", "//") is a filesystem root: show it as is.
  if (!trimmed) return root.charAt(0);
  const separator = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return trimmed.slice(separator + 1);
}

/** Explicit choice wins; by default the current and pinned projects are open. */
export function isGroupExpanded(project: SidebarProject, groupExpansion: Readonly<Record<string, boolean>>): boolean {
  if (Object.hasOwn(groupExpansion, project.key)) {
    const choice = groupExpansion[project.key];
    if (typeof choice === "boolean") return choice;
  }
  return project.current || project.pinned;
}

/**
 * Group choices once `outgoing`, the project that was current, no longer is
 * (`outgoing` as the new model has it). A group open only by the "current"
 * default would fold up at once: picking a session in another group would
 * move every row below it, the clicked one included, from under the pointer.
 * It stays open as an explicit choice instead. Returns `groupExpansion`
 * itself when nothing changes: an explicit choice, a pinned project (open by
 * default anyway), a project still current, or one without a group any more.
 */
export function keepOutgoingGroupOpen(
  groupExpansion: Readonly<Record<string, boolean>>,
  outgoing: SidebarProject | undefined,
): Readonly<Record<string, boolean>> {
  if (!outgoing || outgoing.current || outgoing.pinned || Object.hasOwn(groupExpansion, outgoing.key)) return groupExpansion;
  return { ...groupExpansion, [outgoing.key]: true };
}

function familyStatus(family: SessionFamily, input: FamilyFlagsInput): SidebarFamilyStatus {
  return {
    running: anyMemberIn(family, input.runningIds),
    awaiting: anyMemberIn(family, input.awaitingIds),
    unread: anyMemberIn(family, input.unreadIds),
    selected: isMember(family, input.selectedSessionId),
    transient: family.root.transient === true,
  };
}

function familyProjectKey(family: SessionFamily): string {
  return workspaceKeyOf(family.root);
}

function familyProjectRoot(family: SessionFamily): string {
  return family.root.projectRoot ?? family.root.cwd;
}

/**
 * SidebarProject for every key that is referenced. The root path comes from
 * the newest family of that key (families arrive newest first), then from the
 * current project, then from the pinned-project entry.
 */
function createProjectResolver(
  uiState: SessionUiState,
  currentProject: { key: string; root: string } | null,
) {
  const roots = new Map<string, string>();
  const projects = new Map<string, SidebarProject>();

  return {
    noteFamily(family: SessionFamily) {
      const key = familyProjectKey(family);
      if (!roots.has(key)) roots.set(key, familyProjectRoot(family));
    },
    get(key: string): SidebarProject {
      const cached = projects.get(key);
      if (cached) return cached;
      const pinnedEntry = Object.hasOwn(uiState.projects, key) ? uiState.projects[key] : undefined;
      const current = currentProject !== null && currentProject.key === key;
      const root = roots.get(key)
        ?? (current ? currentProject.root : undefined)
        ?? pinnedEntry?.root
        ?? key;
      const project: SidebarProject = {
        key,
        root,
        name: projectNameOf(root),
        pinned: pinnedEntry !== undefined,
        current,
      };
      projects.set(key, project);
      return project;
    },
  };
}

function sessionRow(
  family: SessionFamily,
  context: "pinned" | "group" | "archive",
  project: SidebarProject,
  input: FamilyFlagsInput,
  archivedAt: number | null,
): SidebarRow {
  return {
    kind: "session",
    key: `session:${context}:${family.root.id}`,
    family,
    context,
    project,
    status: familyStatus(family, input),
    archivedAt,
  };
}

/**
 * The first `limit` families, any later one that is running, unread or
 * selected, and the next `extra` of the others (sorted order kept). Families
 * that show anyway do not use up `extra`, so each "show more" click reveals
 * exactly SHOW_MORE_STEP more rows (or what is left), and a long project
 * never mounts all of its rows at once. `revealed` counts what `extra` showed.
 */
function visibleFamilies(
  families: readonly SessionFamily[],
  limit: number,
  extra: number,
  input: FamilyFlagsInput,
): { visible: SessionFamily[]; revealed: number } {
  let revealed = 0;
  const visible = families.filter((family, index) => {
    if (index < limit) return true;
    const status = familyStatus(family, input);
    if (status.running || status.unread || status.selected) return true;
    if (revealed < extra) {
      revealed++;
      return true;
    }
    return false;
  });
  return { visible, revealed };
}

/** Families "show more" has revealed for `key` (0 when none or malformed). */
export function shownMoreFor(moreShown: Readonly<Record<string, number>>, key: string): number {
  if (!Object.hasOwn(moreShown, key)) return 0;
  const value = moreShown[key];
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/** One "show more" click: SHOW_MORE_STEP more families for `key`. */
export function showMoreFamilies(moreShown: Readonly<Record<string, number>>, key: string): Record<string, number> {
  return { ...moreShown, [key]: shownMoreFor(moreShown, key) + SHOW_MORE_STEP };
}

/** "Show less": back to the base limit for `key`. */
export function showLessFamilies(moreShown: Readonly<Record<string, number>>, key: string): Record<string, number> {
  if (!Object.hasOwn(moreShown, key)) return moreShown as Record<string, number>;
  const next = { ...moreShown };
  delete next[key];
  return next;
}

/**
 * The "show more" row: how many families are still hidden, and whether
 * "show less" would fold anything back (only rows "show more" revealed; the
 * running, unread or selected ones stay). Null when neither applies.
 */
function moreRowState(total: number, visible: number, revealed: number): { hidden: number; canShowLess: boolean } | null {
  const hidden = total - visible;
  const canShowLess = revealed > 0;
  return hidden > 0 || canShowLess ? { hidden, canShowLess } : null;
}

export function buildSessionTree(input: SessionTreeInput): SessionTreeModel {
  const { uiState, runningIds, currentProject } = input;
  const families = listSessionFamilies(input.sessions);
  const resolver = createProjectResolver(uiState, currentProject);

  let archivedCount = 0;
  const pinnedFamilies: SessionFamily[] = [];
  // Insertion order follows family activity (newest first).
  const projectFamilies = new Map<string, SessionFamily[]>();
  const projectActivity = new Map<string, number>();
  // Projects with a live family that has a file (pinned families included).
  const savedKeys = new Set<string>();

  for (const family of families) {
    if (isFamilyArchived(family, uiState, runningIds)) {
      archivedCount++;
      continue;
    }
    resolver.noteFamily(family);
    const key = familyProjectKey(family);
    const activity = timeOf(family.latestModified);
    projectActivity.set(key, Math.max(projectActivity.get(key) ?? -Infinity, activity));
    if (!family.root.transient) savedKeys.add(key);
    if (isFamilyPinned(family, uiState, runningIds)) {
      pinnedFamilies.push(family);
      continue;
    }
    const list = projectFamilies.get(key);
    if (list) list.push(family);
    else projectFamilies.set(key, [family]);
  }

  const rows: SidebarRow[] = [];

  // Pinned section: newest pin first; ties keep family activity order.
  if (pinnedFamilies.length > 0) {
    const pinnedAt = (family: SessionFamily) => finiteNumber(familyEntry(uiState, family.root.id)?.pinnedAt) ?? 0;
    const sorted = pinnedFamilies
      .map((family, index) => ({ family, index }))
      .sort((a, b) => compareDesc(pinnedAt(a.family), pinnedAt(b.family)) || a.index - b.index)
      .map(({ family }) => family);
    let running = 0;
    let unread = 0;
    for (const family of sorted) {
      if (anyMemberIn(family, runningIds)) running++;
      if (anyMemberIn(family, input.unreadIds)) unread++;
    }
    rows.push({ kind: "pinned-header", key: "pinned-header", count: sorted.length, collapsed: input.pinnedCollapsed, running, unread });
    if (!input.pinnedCollapsed) {
      const { visible, revealed } = visibleFamilies(sorted, PINNED_VISIBLE_LIMIT, shownMoreFor(input.moreShown, PINNED_MORE_KEY), input);
      for (const family of visible) {
        rows.push(sessionRow(family, "pinned", resolver.get(familyProjectKey(family)), input, null));
      }
      const more = moreRowState(sorted.length, visible.length, revealed);
      if (more) rows.push({ kind: "pinned-more", key: "pinned-more", ...more });
    }
    // Group spacers are "spacer:<projectKey>", so this key cannot collide.
    rows.push({ kind: "spacer", key: "pinned-spacer" });
  }

  // Projects: live non-pinned families, the current project, pinned projects.
  const projectKeys: string[] = [...projectFamilies.keys()];
  const seen = new Set(projectKeys);
  const addKey = (key: string) => {
    if (seen.has(key)) return;
    seen.add(key);
    projectKeys.push(key);
  };
  if (currentProject) addKey(currentProject.key);
  for (const key of Object.keys(uiState.projects)) addKey(key);

  const projects = projectKeys.map((key) => resolver.get(key));
  // A Map: a stored key such as "constructor" must not find a prototype member.
  const rank = new Map<string, number>();
  (uiState.projectOrder ?? []).forEach((key, index) => {
    if (!rank.has(key)) rank.set(key, index);
  });
  const recordable = (project: SidebarProject) => project.pinned || savedKeys.has(project.key);
  // Projects without a place come first, in the fallback order, the ones that
  // are not saved on their own (transient only, the empty current project)
  // before the others: saving those then changes nothing on screen.
  type Indexed = { project: SidebarProject; index: number };
  const orderBand = (band: Indexed[], fallback: (a: Indexed, b: Indexed) => number): SidebarProject[] => [
    ...band
      .filter(({ project }) => !rank.has(project.key))
      .sort((a, b) => Number(recordable(a.project)) - Number(recordable(b.project)) || fallback(a, b)),
    ...band
      .filter(({ project }) => rank.has(project.key))
      .sort((a, b) => (rank.get(a.project.key) ?? 0) - (rank.get(b.project.key) ?? 0)),
  ].map(({ project }) => project);
  const activityOf = (project: SidebarProject) => projectActivity.get(project.key)
    ?? (project.current ? Infinity : -Infinity);
  const projectPinnedAt = (project: SidebarProject) => finiteNumber(uiState.projects[project.key]?.pinnedAt) ?? 0;
  const indexed = projects.map((project, index) => ({ project, index }));
  const pinnedProjects = orderBand(
    indexed.filter(({ project }) => project.pinned),
    (a, b) => compareDesc(projectPinnedAt(b.project), projectPinnedAt(a.project)) || a.index - b.index,
  );
  const otherProjects = orderBand(
    indexed.filter(({ project }) => !project.pinned),
    (a, b) => compareDesc(activityOf(a.project), activityOf(b.project)) || a.index - b.index,
  );
  const orderedProjects = [...pinnedProjects, ...otherProjects];
  const unorderedKeys = (band: SidebarProject[]) => band.filter((project) => !rank.has(project.key)).map((project) => project.key);
  const unorderedKeysByBand = { pinned: unorderedKeys(pinnedProjects), other: unorderedKeys(otherProjects) };
  const projectKeysToRecord = orderedProjects
    .filter((project) => !rank.has(project.key) && recordable(project))
    .map((project) => project.key);

  for (const project of orderedProjects) {
    const groupFamilies = projectFamilies.get(project.key) ?? [];
    const expanded = isGroupExpanded(project, input.groupExpansion);
    let running = 0;
    let unread = 0;
    for (const family of groupFamilies) {
      if (anyMemberIn(family, runningIds)) running++;
      if (anyMemberIn(family, input.unreadIds)) unread++;
    }
    rows.push({ kind: "group", key: `group:${project.key}`, project, expanded, running, unread });

    if (expanded) {
      if (groupFamilies.length === 0) {
        rows.push({ kind: "group-empty", key: `empty:${project.key}`, project });
      } else {
        const { visible, revealed } = visibleFamilies(groupFamilies, GROUP_VISIBLE_LIMIT, shownMoreFor(input.moreShown, project.key), input);
        for (const family of visible) rows.push(sessionRow(family, "group", project, input, null));
        const more = moreRowState(groupFamilies.length, visible.length, revealed);
        if (more) rows.push({ kind: "group-more", key: `more:${project.key}`, projectKey: project.key, ...more });
      }
    }
    rows.push({ kind: "spacer", key: `spacer:${project.key}` });
  }

  rows.push({ kind: "footer-open", key: "footer-open" });
  if (archivedCount > 0) rows.push({ kind: "footer-archived", key: "footer-archived", count: archivedCount });

  return { rows, projects: orderedProjects, archivedCount, unorderedKeysByBand, projectKeysToRecord };
}

/**
 * The next `projectKeysToRecord` the sidebar saves on its own, at most `limit`,
 * taken from the bottom up. Saved keys go in front of the list and render right
 * below the unsaved ones, so each batch lands where it already shows and the
 * unsaved keys above it stay above it. A key sent before but still unsaved
 * (refused, or no room left) ends the batch: a key saved above it would drop
 * below it.
 */
export function nextProjectKeysToRecord(toRecord: readonly string[], sent: ReadonlySet<string>, limit: number): string[] {
  let first = toRecord.length;
  while (first > 0 && toRecord.length - first < limit && !sent.has(toRecord[first - 1])) first--;
  return toRecord.slice(first);
}

/**
 * The archive view: archived families of every project, grouped by project.
 * Groups by their newest archivedAt (desc), families by archivedAt (desc).
 */
export function buildArchiveRows(
  input: Pick<SessionTreeInput, "sessions" | "uiState" | "runningIds" | "awaitingIds" | "unreadIds" | "selectedSessionId" | "currentProject">,
): SidebarRow[] {
  const { uiState, runningIds } = input;
  const flags: FamilyFlagsInput = input;
  const resolver = createProjectResolver(uiState, input.currentProject);
  const groups = new Map<string, { newest: number; families: { family: SessionFamily; archivedAt: number }[] }>();

  for (const family of listSessionFamilies(input.sessions)) {
    if (!isFamilyArchived(family, uiState, runningIds)) continue;
    resolver.noteFamily(family);
    const archivedAt = finiteNumber(familyEntry(uiState, family.root.id)?.archivedAt) ?? 0;
    const key = familyProjectKey(family);
    const group = groups.get(key);
    if (group) {
      group.families.push({ family, archivedAt });
      group.newest = Math.max(group.newest, archivedAt);
    } else {
      groups.set(key, { newest: archivedAt, families: [{ family, archivedAt }] });
    }
  }

  const rows: SidebarRow[] = [];
  const ordered = [...groups.entries()]
    .map(([key, group], index) => ({ key, group, index }))
    .sort((a, b) => compareDesc(a.group.newest, b.group.newest) || a.index - b.index);
  for (const { key, group } of ordered) {
    const project = resolver.get(key);
    rows.push({ kind: "archive-group", key: `archive:${key}`, project, count: group.families.length });
    const families = group.families
      .map((entry, index) => ({ ...entry, index }))
      .sort((a, b) => compareDesc(a.archivedAt, b.archivedAt) || a.index - b.index);
    for (const { family, archivedAt } of families) {
      rows.push(sessionRow(family, "archive", project, flags, archivedAt));
    }
  }
  return rows;
}

/**
 * Root ids of live, non-pinned, non-running, non-unread, non-selected
 * families of `projectKey` whose latestModified is older than
 * now - olderThanMs. Transient families have no file and are never archived.
 */
export function familiesToArchive(
  input: Pick<SessionTreeInput, "sessions" | "uiState" | "runningIds" | "awaitingIds" | "unreadIds" | "selectedSessionId">,
  projectKey: string,
  olderThanMs: number,
  now: number,
): string[] {
  const cutoff = now - olderThanMs;
  const ids: string[] = [];
  for (const family of listSessionFamilies(input.sessions)) {
    if (familyProjectKey(family) !== projectKey) continue;
    if (isFamilyArchived(family, input.uiState, input.runningIds)) continue;
    if (isFamilyPinned(family, input.uiState, input.runningIds)) continue;
    const status = familyStatus(family, input);
    if (status.running || status.unread || status.selected || status.transient) continue;
    const modified = Date.parse(family.latestModified);
    if (Number.isNaN(modified) || modified >= cutoff) continue;
    ids.push(family.root.id);
  }
  return ids;
}

/** Prefix sums of row heights: length rows.length + 1, offsets[0] = 0. */
export function getRowOffsets(rows: readonly SidebarRow[], layout: SidebarLayout): number[] {
  const heights = SIDEBAR_ROW_HEIGHTS[layout];
  const offsets = new Array<number>(rows.length + 1);
  offsets[0] = 0;
  for (let index = 0; index < rows.length; index++) {
    offsets[index + 1] = offsets[index] + heights[rows[index].kind];
  }
  return offsets;
}

/** One project group as it is laid out: from its header row to the bottom of its spacer row. */
export interface GroupBlock { key: string; pinned: boolean; top: number; bottom: number }

/** The group blocks of `rows` (every group ends with its `spacer:<key>` row), top to bottom. */
export function groupBlocks(rows: readonly SidebarRow[], offsets: readonly number[]): GroupBlock[] {
  const blocks: GroupBlock[] = [];
  let open: GroupBlock | null = null;
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    if (row.kind === "group") {
      open = { key: row.project.key, pinned: row.project.pinned, top: offsets[index], bottom: offsets[index + 1] };
      blocks.push(open);
    } else if (open && row.kind === "spacer" && row.key === `spacer:${open.key}`) {
      open.bottom = offsets[index + 1];
      open = null;
    }
  }
  return blocks;
}

/** Where a dragged group would go: next to `anchorKey`, with its drop line at `lineY` (content coordinates). */
export interface GroupDrop { anchorKey: string; position: ProjectMovePosition; lineY: number }

/** Spacer rows are 8px: the drop line sits in the middle of one. */
const DROP_LINE_INSET = 4;
/** The line's 6px dot is centred on it: this low, at the top of the list, it is still whole. */
const DROP_LINE_MIN_Y = 3;

/**
 * The drop target for a group dragged to content position `y`. Only the
 * dragged group's band counts (a drag never crosses from pinned projects to
 * the others), so a pointer above the band (the pinned section) means its
 * top and one below it (the footer) its bottom. The dragged block goes
 * before the first other block whose middle is below `y`. Null when that is
 * where it already is, or the band has no other group. Works from the rows
 * and offsets alone: collapsed groups, "show more" and rows not mounted
 * count as laid out.
 */
export function groupDropAt(blocks: readonly GroupBlock[], draggedKey: string, y: number): GroupDrop | null {
  const dragged = blocks.find((block) => block.key === draggedKey);
  if (!dragged) return null;
  const band = blocks.filter((block) => block.pinned === dragged.pinned);
  const from = band.indexOf(dragged);
  const others = band.filter((block) => block !== dragged);
  if (others.length === 0) return null;
  const to = others.filter((block) => (block.top + block.bottom) / 2 < y).length;
  if (to === from) return null;
  const lineY = Math.max(DROP_LINE_MIN_Y, to < others.length ? others[to].top - DROP_LINE_INSET : others[others.length - 1].bottom - DROP_LINE_INSET);
  return to > 0
    ? { anchorKey: others[to - 1].key, position: "after", lineY }
    : { anchorKey: others[0].key, position: "before", lineY };
}

/**
 * Move up / Move down in a group's menu: the move that swaps `key` with its
 * neighbour in its band (`projects` in group order). Null at the band's edge.
 */
export function adjacentProjectMove(
  projects: readonly SidebarProject[],
  key: string,
  direction: "up" | "down",
): { anchorKey: string; position: ProjectMovePosition } | null {
  const project = projects.find((item) => item.key === key);
  if (!project) return null;
  const band = projects.filter((item) => item.pinned === project.pinned);
  const index = band.indexOf(project);
  const neighbour = band[direction === "up" ? index - 1 : index + 1];
  if (!neighbour) return null;
  return { anchorKey: neighbour.key, position: direction === "up" ? "before" : "after" };
}

/**
 * Auto-scroll while a group is dragged near an edge of the list (`top` and
 * `bottom` of its box, `clientY` the pointer): up to `maxStep` px a frame,
 * faster the deeper into the `edge` band (at most half the box), at full
 * speed past it; negative scrolls up, 0 outside both bands.
 */
export function autoScrollDelta(clientY: number, top: number, bottom: number, edge: number, maxStep: number): number {
  const band = Math.min(edge, (bottom - top) / 2);
  if (!(band > 0) || !Number.isFinite(clientY)) return 0;
  const speed = (depth: number) => Math.ceil(maxStep * Math.min(1, depth / band));
  if (clientY < top + band) return -speed(top + band - clientY);
  if (clientY > bottom - band) return speed(clientY - (bottom - band));
  return 0;
}

/** Where the drag ghost goes; one coordinate space for all (the hook uses the page's). */
export interface GhostPlacement {
  pointerY: number;
  /** The drop line, or null without a drop target. */
  lineY: number | null;
  ghostHeight: number;
  /** Space kept between the ghost and the pointer. */
  pointerGap: number;
  /** Space kept between the ghost and the drop line. */
  lineGap: number;
  /** The list's visible top. */
  minTop: number;
  /** The lowest top that keeps the ghost in the list: its visible bottom less ghostHeight. */
  maxTop: number;
}

/**
 * The drag ghost's top while a group is dragged. It follows the pointer, its
 * bottom `pointerGap` above it, and moves only as far as keeping clear of the
 * pointer and the drop line (`lineGap`) and inside the list takes: to the
 * nearest top that does. A line far from the pointer leaves it where it is;
 * a line just above the pointer puts it above the line, or below the pointer
 * when there is no room up there; at the list's top it goes below the
 * pointer, and below the line too when that is just under the pointer. A
 * line outside the visible box is scrolled away and cannot be covered: only
 * the pointer counts, as without a drop target. Only a list too short to
 * hold the ghost clear of both puts it over the pointer (over the line only
 * when no top in the list keeps clear of it), and one shorter than the ghost
 * keeps its top.
 */
export function ghostTopFor({ pointerY, lineY, ghostHeight, pointerGap, lineGap, minTop, maxTop }: GhostPlacement): number {
  const bottom = Math.max(minTop, maxTop);
  const wanted = pointerY - pointerGap - ghostHeight;
  const line = lineY !== null && lineY >= minTop && lineY <= bottom + ghostHeight ? lineY : null;
  const inList = (top: number) => top >= minTop && top <= bottom;
  // Tops at which the ghost comes closer than its gap to the pointer or the line.
  const nearPointer = (top: number) => top > wanted && top < pointerY + pointerGap;
  const nearLine = (top: number) => line !== null && top > line - lineGap - ghostHeight && top < line + lineGap;
  // The nearest top that fits is the one the pointer wants or one at the edge
  // of what it keeps clear of; on a tie the first listed, above before below.
  const candidates = line === null
    ? [wanted, minTop, pointerY + pointerGap, bottom]
    : [wanted, line - lineGap - ghostHeight, minTop, pointerY + pointerGap, line + lineGap, bottom];
  const nearest = (fits: (top: number) => boolean): number | null => {
    let best: number | null = null;
    for (const top of candidates) {
      if (fits(top) && (best === null || Math.abs(top - wanted) < Math.abs(best - wanted))) best = top;
    }
    return best;
  };
  return nearest((top) => inList(top) && !nearPointer(top) && !nearLine(top))
    ?? nearest((top) => inList(top) && !nearLine(top))
    ?? Math.min(bottom, Math.max(minTop, wanted));
}

const UNMEASURED_VIEWPORT_HEIGHT = 600;

/**
 * Indices to render: rows intersecting [scrollTop - overscanPx,
 * scrollTop + viewportHeight + overscanPx] (an unmeasured viewport of 0 counts
 * as 600px), plus every valid index in `keepMounted`. Sorted and unique.
 */
export function getVisibleRowIndices(
  offsets: readonly number[],
  scrollTop: number,
  viewportHeight: number,
  overscanPx: number,
  keepMounted: readonly number[] = [],
): number[] {
  const count = Math.max(0, offsets.length - 1);
  const top = Number.isFinite(scrollTop) ? Math.max(0, scrollTop) : 0;
  const height = Number.isFinite(viewportHeight) && viewportHeight > 0 ? viewportHeight : UNMEASURED_VIEWPORT_HEIGHT;
  const overscan = Number.isFinite(overscanPx) && overscanPx > 0 ? overscanPx : 0;
  const windowStart = top - overscan;
  const windowEnd = top + height + overscan;

  // First row whose bottom edge is below windowStart.
  let low = 0;
  let high = count;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (offsets[mid + 1] > windowStart) high = mid;
    else low = mid + 1;
  }
  const first = low;

  // First row whose top edge is at or past windowEnd; the range ends before it.
  low = first;
  high = count;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (offsets[mid] >= windowEnd) high = mid;
    else low = mid + 1;
  }
  const end = low;

  const indices: number[] = [];
  for (let index = first; index < end; index++) indices.push(index);
  if (keepMounted.length === 0) return indices;

  const extra = keepMounted.filter((index) => Number.isInteger(index) && index >= 0 && index < count && (index < first || index >= end));
  if (extra.length === 0) return indices;
  return [...new Set([...indices, ...extra])].sort((a, b) => a - b);
}

/**
 * The scrollTop that brings row `index` into a viewport of `viewportHeight`
 * now scrolled to `scrollTop`: centred when it is partly or wholly out of
 * view, null when it is already in view (or there is no such row).
 */
export function revealScrollTop(
  offsets: readonly number[],
  index: number,
  scrollTop: number,
  viewportHeight: number,
): number | null {
  if (!Number.isInteger(index) || index < 0 || index >= offsets.length - 1) return null;
  const top = offsets[index];
  const bottom = offsets[index + 1];
  if (top >= scrollTop && bottom <= scrollTop + viewportHeight) return null;
  return Math.max(0, top - Math.max(0, (viewportHeight - (bottom - top)) / 2));
}

/** A reveal request is dropped once its row has missed this many rows updates, or this long after it was made. */
export const REVEAL_MAX_MISSES = 3;
export const REVEAL_EXPIRY_MS = 3000;

/** How many rows updates have missed one reveal request's row so far. */
export interface RevealMisses { id: number; misses: number }

/**
 * One look at the rows for a reveal request (SessionTreeReveal in
 * components/SessionTree.tsx): "reveal" when its row is there, "wait" for the
 * next rows update, "drop" when it is older than REVEAL_EXPIRY_MS (found or
 * not: a row that turns up later, for another reason, is not scrolled to) or
 * its row has now missed REVEAL_MAX_MISSES updates. `misses` is the count
 * so far, kept for this id only; the next one comes back with the verdict.
 */
export function revealStep(
  misses: RevealMisses | null,
  request: { id: number; at: number },
  found: boolean,
  now: number,
): { misses: RevealMisses; action: "reveal" | "wait" | "drop" } {
  const current = misses?.id === request.id ? misses : { id: request.id, misses: 0 };
  // Written so an unreadable time counts as too old.
  if (!(now - request.at <= REVEAL_EXPIRY_MS)) return { misses: current, action: "drop" };
  if (found) return { misses: current, action: "reveal" };
  const next = { id: request.id, misses: current.misses + 1 };
  return { misses: next, action: next.misses >= REVEAL_MAX_MISSES ? "drop" : "wait" };
}
