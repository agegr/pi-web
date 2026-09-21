import type { SessionFamily } from "./session-family";

/**
 * Pure row model for the session sidebar's virtualized list.
 *
 * The list mixes three row kinds — pinned-project group headers, session
 * rows and empty-group hint rows — in ONE flat array with cumulative
 * offsets, so a single windowing pass can mount just the visible slice
 * regardless of row type. Keeps all layout math framework-free and
 * unit-testable in isolation from the React component.
 */

/** Fixed height of one session row (SessionItem renders at exactly this). */
export const SESSION_LIST_ITEM_HEIGHT = 54;

/** Height of a pinned-group header row and of the empty-group hint row. */
export const GROUP_HEADER_HEIGHT = 40;

/** A pinned project as the row model needs it: stable key + display root. */
export interface SidebarProject {
  key: string;
  root: string;
}

export interface GroupHeaderRow {
  kind: "groupHeader";
  /** React key and pinned project key. */
  key: string;
  project: SidebarProject;
  offset: number;
  height: number;
}

export interface SessionRow {
  kind: "session";
  /** Session family root id — unique across the whole list. */
  key: string;
  family: SessionFamily;
  /** Owning pinned project key; null for main-list rows. */
  groupKey: string | null;
  offset: number;
  height: number;
}

export interface GroupEmptyRow {
  kind: "groupEmpty";
  key: string;
  groupKey: string;
  offset: number;
  height: number;
}

export type SidebarRow = GroupHeaderRow | SessionRow | GroupEmptyRow;

export interface BuildSidebarRowsInput {
  /** Pinned projects, most-recently-pinned first. */
  pinnedProjects: readonly SidebarProject[];
  /** Session families per pinned project key (all worktrees included). */
  familiesByProject: ReadonlyMap<string, readonly SessionFamily[]>;
  /** Expanded group keys — collapsed groups contribute only their header. */
  expandedKeys: ReadonlySet<string>;
  /** Main-list families rendered below the pinned groups. */
  mainFamilies: readonly SessionFamily[];
}

/**
 * Assemble the unified sidebar row array: each pinned project in pin order
 * contributes a header row and, when expanded, its session rows or one
 * empty-group hint row; the main-list families follow below. Rows carry
 * cumulative offsets; every row is exactly `height` tall, so the container
 * height equals the last row's bottom edge (`sidebarRowsHeight`).
 */
export function buildSidebarRows({
  pinnedProjects,
  familiesByProject,
  expandedKeys,
  mainFamilies,
}: BuildSidebarRowsInput): SidebarRow[] {
  const rows: SidebarRow[] = [];
  let offset = 0;
  // Per-kind argument type: `Omit<SidebarRow, "offset">` would collapse
  // the union to its common keys and reject the per-kind literals below.
  type PushableRow =
    | Omit<GroupHeaderRow, "offset">
    | Omit<SessionRow, "offset">
    | Omit<GroupEmptyRow, "offset">;
  const push = (row: PushableRow): void => {
    const height = row.height;
    rows.push({ ...row, offset } as SidebarRow);
    offset += height;
  };

  for (const project of pinnedProjects) {
    push({
      kind: "groupHeader",
      key: `group:${project.key}`,
      project,
      height: GROUP_HEADER_HEIGHT,
    });
    if (!expandedKeys.has(project.key)) continue;
    const families = familiesByProject.get(project.key) ?? [];
    if (families.length === 0) {
      push({
        kind: "groupEmpty",
        key: `group-empty:${project.key}`,
        groupKey: project.key,
        height: GROUP_HEADER_HEIGHT,
      });
      continue;
    }
    for (const family of families) {
      push({
        kind: "session",
        key: family.root.id,
        family,
        groupKey: project.key,
        height: SESSION_LIST_ITEM_HEIGHT,
      });
    }
  }

  for (const family of mainFamilies) {
    push({
      kind: "session",
      key: family.root.id,
      family,
      groupKey: null,
      height: SESSION_LIST_ITEM_HEIGHT,
    });
  }

  return rows;
}

/** Total scroll height of the row list — the positioning container's height. */
export function sidebarRowsHeight(rows: readonly SidebarRow[]): number {
  if (rows.length === 0) return 0;
  const last = rows[rows.length - 1];
  return last.offset + last.height;
}

interface WindowedResult {
  start: number;
  end: number;
}

/**
 * Row-index window that covers the viewport plus an overscan margin, for
 * mixed-height rows. `start` is the first row overlapping or after the top
 * edge minus overscan rows; `end` is one past the last row overlapping the
 * bottom edge plus overscan rows.
 */
function rowWindow(
  rows: readonly SidebarRow[],
  scrollTop: number,
  viewportHeight: number,
): WindowedResult {
  const viewHeight = viewportHeight || 600;
  const bottom = scrollTop + viewHeight;

  // First index whose row bottom edge is past the top of the viewport.
  let lo = 0;
  let hi = rows.length - 1;
  let first = rows.length;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].offset + rows[mid].height > scrollTop) {
      first = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }

  // First index at or beyond the bottom edge of the viewport.
  lo = 0;
  hi = rows.length - 1;
  let afterLast = rows.length;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].offset >= bottom) {
      afterLast = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }

  const overscan = 8;
  return {
    start: Math.max(0, first - overscan),
    end: Math.min(rows.length, afterLast + overscan),
  };
}

/**
 * Windowed slice of the unified row list: the rows covering the viewport
 * plus an overscan margin, with the focused session row kept mounted even
 * when it falls outside the window (so scrolling cannot discard an inline
 * rename). Mirrors the old fixed-height `getSessionListIndices` semantics
 * over mixed row heights.
 */
export function getWindowedRows(
  rows: readonly SidebarRow[],
  scrollTop: number,
  viewportHeight: number,
  focusedSessionId: string | null = null,
): SidebarRow[] {
  if (rows.length === 0) return [];
  const { start, end } = rowWindow(rows, scrollTop, viewportHeight);
  const windowRows = rows.slice(start, end);
  if (!focusedSessionId) return windowRows;
  const focusedIndex = rows.findIndex(
    (row) => row.kind === "session" && row.family.root.id === focusedSessionId,
  );
  if (focusedIndex < 0 || (focusedIndex >= start && focusedIndex < end)) return windowRows;
  return focusedIndex < start
    ? [rows[focusedIndex], ...windowRows]
    : [...windowRows, rows[focusedIndex]];
}
