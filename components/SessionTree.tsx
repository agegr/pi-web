"use client";

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import type { SessionFamily } from "@/lib/session-family";
import { splitForkSuffix } from "@/lib/session-fork-name";
import { MAX_PROJECT_NAME_LENGTH, type ProjectMovePosition } from "@/lib/session-ui-state-shared";
import {
  PINNED_MORE_KEY,
  SIDEBAR_ROW_HEIGHTS,
  getRowOffsets,
  getVisibleRowIndices,
  revealScrollTop,
  revealStep,
  type RevealMisses,
  type SidebarLayout,
  type SidebarProject,
  type SidebarRow,
} from "@/lib/session-tree";
import type { SessionInfo } from "@/lib/types";
import { formatRelativeTime, formatShortRelativeTime } from "@/lib/i18n/format";
import { skillExpansionToCommand } from "@/lib/slash-display";
import { useGroupDrag, type GroupDragHandlers } from "@/hooks/useGroupDrag";
import { useI18n } from "@/hooks/useI18n";
import { useScrollbarVisibility } from "@/hooks/useScrollbarVisibility";
import type { SidebarMenuAnchor } from "./SidebarMenu";
import {
  ArchiveIcon,
  ChevronIcon,
  FolderPlusIcon,
  MoreIcon,
  PinIcon,
  PlusIcon,
  RestoreIcon,
  SpinnerIcon,
  TrashIcon,
} from "./SidebarIcons";

/**
 * The sessions tab's tree: the pinned section, every project as a group of
 * session families, and the footer links, or the archive view's rows. It
 * renders the flat rows of lib/session-tree.ts in one virtualized scroll and
 * owns nothing but scroll position, viewport size, which row has focus and a
 * group being dragged (hooks/useGroupDrag.ts); every decision (what is shown,
 * what is open, what is being renamed, where a group goes) comes in through
 * props, so a row scrolled out of view loses no state.
 */

type SessionRow = Extract<SidebarRow, { kind: "session" }>;

/**
 * A request to bring one row into view, made by the parent after a change
 * that puts it somewhere the user is not looking (a fork's new row, a moved
 * group). Until it is handled the row is kept mounted. It is handled once:
 * scrolled to when its row is in the rows, or dropped (revealStep(): its row
 * missed REVEAL_MAX_MISSES rows updates, or it is older than
 * REVEAL_EXPIRY_MS), so it never fires later, when that row shows up for
 * another reason (its group expanded minutes after). Either way the tree
 * calls onRevealHandled(id), and the parent drops the request: kept, a tree
 * mounted again (search results replace it while a query is typed) would
 * take it for a new one.
 */
export interface SessionTreeReveal {
  /** Unique: a new number for every request. */
  id: number;
  /** When it was made (Date.now()). */
  at: number;
  /** Any row's key: a session row, a group header. */
  rowKey: string;
  /**
   * Also focus the row's first button once it is on the page: when focus has
   * fallen to <body>, or when this says the element that has it may give it
   * up (it is still where the request came from). Omitted: focus stays put.
   */
  takeFocusFrom?: (active: Element) => boolean;
}

export interface SessionTreeProps {
  rows: SidebarRow[];
  layout: SidebarLayout;
  /** Shown above the footer rows when there are no session/group rows; null = none. */
  emptyLabel: string | null;
  /** Shows t("sidebar.loading") instead of rows. */
  loading: boolean;
  error: string | null;
  renamingRootId: string | null;
  /** The project whose group header is a name field (its menu's Rename…). */
  renamingProjectKey: string | null;
  confirmDeleteRootId: string | null;
  /** Row whose menu is open: kept mounted, its ⋯ shown pressed. A group row's key works too. */
  activeMenuRowKey: string | null;
  onSelectFamily(family: SessionFamily): void;
  /** `all` (Alt+click): every group follows this one. */
  onToggleGroup(projectKey: string, all: boolean): void;
  /** Reveal SHOW_MORE_STEP more families; key is a projectKey or PINNED_MORE_KEY. */
  onShowMore(key: string): void;
  /** Back to the base limit; key is a projectKey or PINNED_MORE_KEY. */
  onShowLess(key: string): void;
  onTogglePinned(): void;
  onArchiveFamily(family: SessionFamily): void;
  onRestoreFamily(family: SessionFamily): void;
  onOpenRowMenu(row: SessionRow, anchor: SidebarMenuAnchor, opener: HTMLElement | null): void;
  /** The sidebar dispatches the downstream event first. */
  onRowContextMenu(row: SessionRow, event: ReactMouseEvent): void;
  /** `value` is the raw input text; the caller trims and skips unchanged titles. */
  onRenameCommit(family: SessionFamily, value: string): void;
  onRenameCancel(): void;
  /** `value` is the raw input text; the caller decides what it saves. */
  onRenameProjectCommit(project: SidebarProject, value: string): void;
  onRenameProjectCancel(): void;
  onDeleteConfirm(family: SessionFamily, event: ReactMouseEvent): void;
  onDeleteCancel(): void;
  /** A group's "+": a new session in that project at once. */
  onGroupNew(project: SidebarProject): void;
  onGroupMenu(project: SidebarProject, opener: HTMLElement): void;
  onOpenOtherProject(opener: HTMLElement): void;
  onOpenArchive(): void;
  /** Scroll a row into view (and maybe focus it); see SessionTreeReveal. */
  reveal?: SessionTreeReveal | null;
  /** The reveal request with this id was scrolled to or dropped: the parent lets go of it. */
  onRevealHandled?(id: number): void;
  /** A group dropped next to another of its band. Without it no group can be dragged. */
  onMoveGroup?(projectKey: string, anchorKey: string, position: ProjectMovePosition): void;
}

/** Rows rendered beyond each edge of the viewport. */
const OVERSCAN_PX = 240;
/** How often relative times ("5m") move on while nothing else re-renders. */
const CLOCK_TICK_MS = 60_000;
const DELETE_TITLE_MAX = 22;

/**
 * A session's display title: its stored name, else its first message (an
 * SDK-expanded <skill> block collapsed back to the /skill:name command the
 * user typed, as MessageView shows it), else its id.
 */
export function sessionRowTitle(session: SessionInfo): string {
  const displayFirstMessage = skillExpansionToCommand(session.firstMessage) ?? session.firstMessage;
  return session.name || displayFirstMessage.slice(0, 50) || session.id.slice(0, 12);
}

function isImeKey(event: ReactKeyboardEvent): boolean {
  return event.nativeEvent.isComposing || event.keyCode === 229;
}

function anchorOf(button: HTMLElement): SidebarMenuAnchor {
  const rect = button.getBoundingClientRect();
  return { kind: "rect", rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }, align: "end" };
}

export function SessionTree(props: SessionTreeProps): ReactNode {
  const {
    rows,
    layout,
    emptyLabel,
    loading,
    error,
    renamingRootId,
    renamingProjectKey,
    confirmDeleteRootId,
    activeMenuRowKey,
    reveal,
  } = props;
  const { t } = useI18n();
  // Rows read the handlers at event time, so memoized rows need not re-render
  // when the parent passes new callbacks.
  const handlersRef = useRef(props);
  handlersRef.current = props;

  const treeRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  useScrollbarVisibility(scrollRef);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [focusedRowKey, setFocusedRowKey] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const scrollFrameRef = useRef<number | null>(null);

  const handleScroll = useCallback(() => {
    if (scrollFrameRef.current !== null) return;
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      const element = scrollRef.current;
      if (element) setScrollTop(element.scrollTop);
    });
  }, []);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    // A classic scrollbar takes width on the right only; the rows read its
    // width so their inset box keeps equal margins on both sides.
    const syncScrollbarWidth = () => {
      element.style.setProperty("--session-tree-scrollbar", `${Math.max(0, element.offsetWidth - element.clientWidth)}px`);
    };
    syncScrollbarWidth();
    setViewportHeight(element.clientHeight);
    setScrollTop(element.scrollTop);
    if (typeof ResizeObserver === "undefined") return;
    // The gutter is reserved (scrollbar-gutter in sidebar.css), but its width
    // still changes with the pointer media query, which resizes the content box.
    const observer = new ResizeObserver(() => {
      syncScrollbarWidth();
      setViewportHeight(element.clientHeight);
      // Inside a hidden tab the height was 0; coming back, the position may
      // have changed without a scroll event.
      setScrollTop(element.scrollTop);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => {
    if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  // Focus is tracked by row key, so a focused row stays mounted while it is
  // scrolled away (an inline rename, a keyboard user on ⋯).
  const handleFocus = useCallback((event: ReactFocusEvent<HTMLDivElement>) => {
    const row = event.target instanceof Element ? event.target.closest("[data-row-key]") : null;
    setFocusedRowKey(row?.getAttribute("data-row-key") ?? null);
  }, []);
  const handleBlur = useCallback((event: ReactFocusEvent<HTMLDivElement>) => {
    // Moving within the tree: the next focus event names the new row.
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setFocusedRowKey(null);
  }, []);

  const offsets = useMemo(() => getRowOffsets(rows, layout), [rows, layout]);
  // A group header can be dragged to another place in its band (pinned
  // projects, or the others) when the band has another group.
  const canMoveGroups = Boolean(props.onMoveGroup);
  const groupsPerBand = useMemo(() => {
    const count = { pinned: 0, other: 0 };
    for (const row of rows) {
      if (row.kind === "group") count[row.project.pinned ? "pinned" : "other"]++;
    }
    return count;
  }, [rows]);
  const groupDrag = useGroupDrag({
    rows,
    offsets,
    layout,
    enabled: canMoveGroups && !loading,
    scrollRef,
    innerRef,
    treeRef,
    ghostRef,
    onMove: (projectKey, anchorKey, position) => handlersRef.current.onMoveGroup?.(projectKey, anchorKey, position),
  });
  const dragView = groupDrag.view;
  // The header holding the pointer stays mounted while auto-scroll moves it away.
  const draggedRowKey = dragView ? `group:${dragView.projectKey}` : null;
  // The last reveal request handled (scrolled to, or dropped), ignored from
  // then on, until the parent's answer to onRevealHandled arrives.
  const [handledRevealId, setHandledRevealId] = useState<number | null>(null);
  const pendingReveal = reveal && reveal.id !== handledRevealId ? reveal : null;
  const pendingRevealKey = pendingReveal?.rowKey ?? null;
  const keepMounted = useMemo(() => {
    const indices: number[] = [];
    rows.forEach((row, index) => {
      if (row.key === focusedRowKey || row.key === activeMenuRowKey || row.key === pendingRevealKey || row.key === draggedRowKey) indices.push(index);
      else if (row.kind === "session" && (row.family.root.id === renamingRootId || row.family.root.id === confirmDeleteRootId)) indices.push(index);
      else if (row.kind === "group" && row.project.key === renamingProjectKey) indices.push(index);
    });
    return indices;
  }, [rows, focusedRowKey, activeMenuRowKey, pendingRevealKey, draggedRowKey, renamingRootId, renamingProjectKey, confirmDeleteRootId]);
  const visibleIndices = useMemo(
    () => (loading ? [] : getVisibleRowIndices(offsets, scrollTop, viewportHeight, OVERSCAN_PX, keepMounted)),
    [loading, offsets, scrollTop, viewportHeight, keepMounted],
  );

  // "Show more" / "show less" change the rows under the pointer. After "show
  // less" the list can shrink by hundreds of pixels, and after a keyboard
  // "show more" the focused button moves 20 rows down: either way the more
  // row is scrolled back into view. The button a keyboard user was on may be
  // the one that disappears (the last "show more", any "show less"), or the
  // whole row may go; focus then moves to what remains of the row, else to
  // the group or pinned header. Focus waits in its own ref until a commit has
  // the target mounted, so a second rows change in between cannot drop it.
  const pendingMoreRef = useRef<{ rowKey: string; fallbackKey: string; focus: boolean; scroll: boolean } | null>(null);
  const pendingFocusRef = useRef<{
    rowKey: string;
    fallbackKey: string;
    tries: number;
    /** A reveal's rule for focus that is still on the page (see SessionTreeReveal). */
    takeFocusFrom?: (active: Element) => boolean;
  } | null>(null);
  const handleMoreAction = useCallback((rowKey: string, key: string, action: "more" | "less", button: HTMLElement) => {
    const focus = document.activeElement === button;
    const keyboard = focus && button.matches(":focus-visible");
    const fallbackKey = key === PINNED_MORE_KEY ? "pinned-header" : `group:${key}`;
    pendingMoreRef.current = { rowKey, fallbackKey, focus, scroll: action === "less" || keyboard };
    if (action === "more") handlersRef.current.onShowMore(key);
    else handlersRef.current.onShowLess(key);
  }, []);
  useLayoutEffect(() => {
    const pending = pendingMoreRef.current;
    if (!pending) return;
    pendingMoreRef.current = null;
    const element = scrollRef.current;
    let index = rows.findIndex((row) => row.key === pending.rowKey);
    if (index < 0) index = rows.findIndex((row) => row.key === pending.fallbackKey);
    if (pending.scroll && element && index >= 0) {
      const next = revealScrollTop(offsets, index, element.scrollTop, element.clientHeight);
      if (next !== null) element.scrollTop = next;
      // The browser may clamp scrollTop when the list shrank: keep the window in step either way.
      setScrollTop(element.scrollTop);
    }
    if (pending.focus) pendingFocusRef.current = { rowKey: pending.rowKey, fallbackKey: pending.fallbackKey, tries: 0 };
  }, [rows, offsets]);
  // A reveal request: scrolled to once its row is in the rows (it is kept
  // mounted meanwhile, so focus can go to it in the same commit), or dropped.
  // Its age is checked on every look, so a late one is dropped even when its
  // row has just turned up, and a tree mounted after it has gone stale.
  const revealMissesRef = useRef<RevealMisses | null>(null);
  useLayoutEffect(() => {
    if (!pendingReveal) return;
    const index = rows.findIndex((row) => row.key === pendingReveal.rowKey);
    const step = revealStep(revealMissesRef.current, pendingReveal, index >= 0, Date.now());
    revealMissesRef.current = step.misses;
    if (step.action === "wait") return;
    if (step.action === "reveal") {
      const element = scrollRef.current;
      // A tree in a hidden tab has no box to scroll: it gets its saved position back when shown.
      if (element && element.getClientRects().length > 0) {
        const next = revealScrollTop(offsets, index, element.scrollTop, element.clientHeight);
        if (next !== null) element.scrollTop = next;
        setScrollTop(element.scrollTop);
      }
      if (pendingReveal.takeFocusFrom) {
        pendingFocusRef.current = { rowKey: pendingReveal.rowKey, fallbackKey: pendingReveal.rowKey, tries: 0, takeFocusFrom: pendingReveal.takeFocusFrom };
      }
    }
    setHandledRevealId(pendingReveal.id);
    handlersRef.current.onRevealHandled?.(pendingReveal.id);
  }, [pendingReveal, rows, offsets]);
  useLayoutEffect(() => {
    const target = pendingFocusRef.current;
    if (!target) return;
    const active = document.activeElement;
    // Focus that survived (the clicked button is still there) stays put,
    // unless a reveal may take it from where it is.
    if (active && active !== document.body && document.contains(active) && !target.takeFocusFrom?.(active)) {
      pendingFocusRef.current = null;
      return;
    }
    const root = scrollRef.current;
    const rowElement = (key: string) => root?.querySelector(`[data-row-key="${CSS.escape(key)}"]`) ?? null;
    const row = rowElement(target.rowKey);
    const button = row?.querySelector<HTMLElement>("[data-more-action=\"more\"]")
      ?? row?.querySelector<HTMLElement>("button")
      ?? rowElement(target.fallbackKey)?.querySelector<HTMLElement>("button");
    if (button) {
      button.focus({ preventScroll: true });
      pendingFocusRef.current = null;
    } else if (++target.tries > 2) {
      pendingFocusRef.current = null;
    }
  }, [visibleIndices]);

  const hasTreeRows = rows.some((row) => row.kind === "session" || row.kind === "group");
  const showEmpty = !loading && !error && emptyLabel !== null && !hasTreeRows;
  // While dragging: the group's block is dimmed in place (groups never fold
  // up under the pointer), a line marks the drop, and a pill with the
  // project's name follows the pointer, clear of it and of the line
  // (useGroupDrag places it), outside the scroll box, where it cannot make
  // room to scroll into.
  const dragSource = dragView?.source ?? null;
  const dropLineY = dragView?.drop?.lineY ?? null;
  const ghostProject = dragView?.phase === "dragging"
    ? rows.find((row): row is Extract<SidebarRow, { kind: "group" }> => row.kind === "group" && row.project.key === dragView.projectKey)?.project ?? null
    : null;

  return (
    <div ref={treeRef} className={`session-tree${layout === "mobile" ? " is-mobile" : ""}${ghostProject ? " is-group-dragging" : ""}`}>
      {loading && <div className="session-tree-message">{t("sidebar.loading")}</div>}
      {error && <div className="session-tree-message is-error">{error}</div>}
      {showEmpty && <div className="session-tree-message">{emptyLabel}</div>}
      <div
        ref={scrollRef}
        className="session-tree-scroll scrollbar-subtle"
        onScroll={handleScroll}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onPointerDownCapture={groupDrag.onPointerDownCapture}
        onClickCapture={groupDrag.onClickCapture}
      >
        {!loading && (
          <div ref={innerRef} className="session-tree-inner" style={{ height: offsets[rows.length] }}>
            {visibleIndices.map((index) => {
              const row = rows[index];
              if (row.kind === "spacer") return null;
              const top = offsets[index];
              const height = offsets[index + 1] - top;
              const menuOpen = row.key === activeMenuRowKey;
              if (row.kind === "session") {
                return (
                  <SessionRowView
                    key={row.key}
                    row={row}
                    layout={layout}
                    top={top}
                    height={height}
                    now={now}
                    renaming={row.family.root.id === renamingRootId}
                    confirming={row.family.root.id === confirmDeleteRootId}
                    menuOpen={menuOpen}
                    handlers={handlersRef}
                  />
                );
              }
              if (row.kind === "group") {
                const renaming = row.project.key === renamingProjectKey;
                return (
                  <GroupRowView
                    key={row.key}
                    row={row}
                    top={top}
                    height={height}
                    menuOpen={menuOpen}
                    renaming={renaming}
                    // A header that is a name field is no handle to drag.
                    canDrag={canMoveGroups && !renaming && groupsPerBand[row.project.pinned ? "pinned" : "other"] > 1}
                    dragPhase={dragView?.projectKey === row.project.key ? dragView.phase : null}
                    drag={groupDrag.handlers}
                    handlers={handlersRef}
                  />
                );
              }
              return <PlainRowView key={row.key} row={row} top={top} height={height} handlers={handlersRef} onMoreAction={handleMoreAction} />;
            })}
            {dragSource && (
              <div
                className="session-tree-drag-source"
                aria-hidden="true"
                style={{ top: dragSource.top, height: dragSource.bottom - dragSource.top - SIDEBAR_ROW_HEIGHTS[layout].spacer }}
              />
            )}
            {dropLineY !== null && <div className="session-tree-drop-line" aria-hidden="true" style={{ top: dropLineY }} />}
          </div>
        )}
      </div>
      {ghostProject && (
        <div ref={ghostRef} className="session-tree-drag-ghost" aria-hidden="true">
          <span className="session-tree-group-name">{ghostProject.name}</span>
        </div>
      )}
    </div>
  );
}

type Handlers = RefObject<SessionTreeProps>;

function rowStyle(top: number, height: number) {
  return { top, height };
}

const SessionRowView = memo(function SessionRowView({
  row,
  layout,
  top,
  height,
  now,
  renaming,
  confirming,
  menuOpen,
  handlers,
}: {
  row: SessionRow;
  layout: SidebarLayout;
  top: number;
  height: number;
  now: number;
  renaming: boolean;
  confirming: boolean;
  menuOpen: boolean;
  handlers: Handlers;
}) {
  const { locale, t } = useI18n();
  const { family, context, status } = row;
  const root = family.root;
  const title = sessionRowTitle(root);
  const nowDate = new Date(now);
  const className = [
    "session-tree-row session-tree-session",
    status.selected ? "is-selected" : "",
    status.running ? "is-running" : "",
    context === "archive" ? "is-archived" : "",
    menuOpen ? "is-menu-open" : "",
    confirming ? "is-confirming" : "",
    renaming ? "is-renaming" : "",
  ].filter(Boolean).join(" ");

  if (confirming) {
    const shortTitle = title.slice(0, DELETE_TITLE_MAX) + (title.length > DELETE_TITLE_MAX ? "…" : "");
    return (
      <div
        className={className}
        style={rowStyle(top, height)}
        data-row-key={row.key}
        onKeyDown={(event) => {
          if (event.key !== "Escape" || isImeKey(event)) return;
          event.preventDefault();
          event.stopPropagation();
          handlers.current.onDeleteCancel();
        }}
      >
        <DeleteConfirm
          label={t("sidebar.deleteSession", { title: shortTitle })}
          deleteLabel={t("sidebar.delete")}
          cancelLabel={t("sidebar.cancel")}
          onConfirm={(event) => {
            event.stopPropagation();
            handlers.current.onDeleteConfirm(family, event);
          }}
          onCancel={(event) => {
            event.stopPropagation();
            handlers.current.onDeleteCancel();
          }}
        />
      </div>
    );
  }

  if (renaming) {
    return (
      <div className={className} style={rowStyle(top, height)} data-row-key={row.key}>
        <RenameInput
          initialValue={title}
          label={t("sidebar.rename")}
          onCommit={(value) => handlers.current.onRenameCommit(family, value)}
          onCancel={() => handlers.current.onRenameCancel()}
        />
      </div>
    );
  }

  const branch = root.isWorktree && root.branch ? root.branch : null;
  // A fork named by the sidebar's Fork: the ellipsis cuts its title before
  // the suffix that tells it from its source, never the suffix.
  const forkTitle = root.name && root.relation?.kind === "fork" ? splitForkSuffix(root.name) : null;
  const details = root.detailsPending ? "…" : t("sidebar.messagesCount", { count: root.messageCount });
  const tooltip = `${title}\n${details} · ${formatRelativeTime(root.modified, locale, nowDate)}${branch ? ` · ⑂ ${branch}` : ""}`;

  // The right column says the one thing worth knowing: running, else unread,
  // else when (a pinned row names its project instead, an archived row says
  // when it was archived). Nothing sits before the title, so it gets the room.
  let meta: ReactNode;
  let metaState = "";
  let metaTitle: string | undefined;
  if (status.running) {
    meta = <SpinnerIcon size={12} label={t("sidebar.agentRunning")} />;
    metaState = " is-running";
    metaTitle = t("sidebar.agentRunning");
  } else if (status.unread) {
    meta = <span className="session-tree-unread" role="img" aria-label={t("sidebar.newSessionActivity")} />;
    metaState = " is-unread";
    metaTitle = t("sidebar.newActivity");
  } else if (context === "pinned") {
    meta = <span className="session-tree-project">{row.project.name}</span>;
  } else if (context === "archive" && row.archivedAt !== null) {
    meta = formatShortRelativeTime(new Date(row.archivedAt), locale, nowDate);
  } else {
    meta = formatShortRelativeTime(family.latestModified, locale, nowDate);
  }

  // Archive (or restore) one click away: desktop only, never for a running
  // family, which would come straight back.
  const quickAction = layout === "desktop" && (context === "archive" || !status.running);

  return (
    <div
      className={className}
      style={rowStyle(top, height)}
      data-row-key={row.key}
      onClick={() => handlers.current.onSelectFamily(family)}
      onContextMenu={(event) => handlers.current.onRowContextMenu(row, event)}
    >
      <button type="button" className="session-tree-main" title={tooltip} aria-current={status.selected ? "true" : undefined}>
        {forkTitle ? (
          <span className="session-tree-title has-fork-suffix">
            <span className="session-tree-title-base">{forkTitle.base}</span>
            <span className="session-tree-title-suffix">{forkTitle.suffix}</span>
          </span>
        ) : (
          <span className="session-tree-title">{title}</span>
        )}
        {branch && <span className="session-tree-branch">⑂ {branch}</span>}
        <span className={`session-tree-meta${metaState}`} title={metaTitle}>{meta}</span>
      </button>
      {!status.transient && (
        <span className="session-tree-actions">
          {quickAction && (context === "archive" ? (
            <button
              type="button"
              className="session-tree-action session-tree-quick-action"
              aria-label={t("sidebar.restore")}
              title={t("sidebar.restore")}
              onClick={(event) => {
                event.stopPropagation();
                handlers.current.onRestoreFamily(family);
              }}
            >
              <RestoreIcon size={13} />
            </button>
          ) : (
            <button
              type="button"
              className="session-tree-action session-tree-quick-action"
              aria-label={t("sidebar.archive")}
              title={t("sidebar.archive")}
              onClick={(event) => {
                event.stopPropagation();
                handlers.current.onArchiveFamily(family);
              }}
            >
              <ArchiveIcon size={13} />
            </button>
          ))}
          <button
            type="button"
            className={`session-tree-action session-tree-more-action${menuOpen ? " is-active" : ""}`}
            aria-label={t("sidebar.moreActions")}
            title={t("sidebar.moreActions")}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={(event) => {
              event.stopPropagation();
              const button = event.currentTarget;
              handlers.current.onOpenRowMenu(row, anchorOf(button), button);
            }}
          >
            <MoreIcon size={14} />
          </button>
        </span>
      )}
    </div>
  );
});

function RenameInput({
  initialValue,
  label,
  maxLength,
  onCommit,
  onCancel,
}: {
  initialValue: string;
  label: string;
  maxLength?: number;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);
  // Enter or Escape ends the rename; the blur that follows when the input
  // goes away must not commit a second time (or after a cancel).
  const doneRef = useRef(false);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, []);

  const commit = (text: string) => {
    if (doneRef.current) return;
    doneRef.current = true;
    onCommit(text);
  };

  return (
    <input
      ref={inputRef}
      className="session-tree-rename"
      value={value}
      aria-label={label}
      maxLength={maxLength}
      onChange={(event) => setValue(event.target.value)}
      onBlur={(event) => commit(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (isImeKey(event)) return;
        if (event.key === "Enter") {
          event.preventDefault();
          commit(event.currentTarget.value);
        } else if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          if (doneRef.current) return;
          doneRef.current = true;
          onCancel();
        }
      }}
    />
  );
}

function DeleteConfirm({
  label,
  deleteLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: {
  label: string;
  deleteLabel: string;
  cancelLabel: string;
  onConfirm: (event: ReactMouseEvent) => void;
  onCancel: (event: ReactMouseEvent) => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Opened from a menu, focus has nowhere to be (the menu and the row's ⋯ are
  // gone): put it on the safe choice so the keyboard can answer.
  useEffect(() => {
    const active = document.activeElement;
    if (!active || active === document.body) cancelRef.current?.focus();
  }, []);

  return (
    <>
      <span className="session-tree-confirm-text">{label}</span>
      <button type="button" className="session-tree-confirm-delete" onClick={onConfirm}>
        <TrashIcon size={12} />
        {deleteLabel}
      </button>
      <button ref={cancelRef} type="button" className="session-tree-confirm-cancel" onClick={onCancel}>
        {cancelLabel}
      </button>
    </>
  );
}

/**
 * Spinner + count and dot + count; the label carries the count for screen
 * readers. Also a project's badge in the project menus (ProjectWorktreePicker).
 */
export function ActivitySummary({ running, unread, t }: { running: number; unread: number; t: (key: string) => string }) {
  if (running === 0 && unread === 0) return null;
  return (
    <span className="session-tree-summary">
      {running > 0 && (
        <span
          className="session-tree-summary-running"
          role="img"
          title={t("sidebar.agentRunning")}
          aria-label={`${t("sidebar.agentRunning")} (${running})`}
        >
          <SpinnerIcon size={10} />
          {running}
        </span>
      )}
      {unread > 0 && (
        <span
          className="session-tree-summary-unread"
          role="img"
          title={t("sidebar.newSessionActivity")}
          aria-label={`${t("sidebar.newSessionActivity")} (${unread})`}
        >
          <span className="session-tree-summary-dot" />
          {unread}
        </span>
      )}
    </span>
  );
}

const GroupRowView = memo(function GroupRowView({
  row,
  top,
  height,
  menuOpen,
  renaming,
  canDrag,
  dragPhase,
  drag,
  handlers,
}: {
  row: Extract<SidebarRow, { kind: "group" }>;
  top: number;
  height: number;
  /** The group's ⋯ menu is open. */
  menuOpen: boolean;
  /** The header is a field for the project's display name. */
  renaming: boolean;
  /** Its band has another group to move it past. */
  canDrag: boolean;
  /** This group is picked up by a long-press, or being dragged. */
  dragPhase: "armed" | "dragging" | null;
  drag: GroupDragHandlers;
  handlers: Handlers;
}) {
  const { t } = useI18n();
  const { project, expanded } = row;
  const rowRef = useRef<HTMLDivElement>(null);
  const className = [
    "session-tree-row session-tree-group",
    project.current ? "is-current" : "",
    menuOpen ? "is-active" : "",
    dragPhase === "armed" ? "is-drag-armed" : "",
  ].filter(Boolean).join(" ");

  // Once a long-press has picked the group up, the finger's moves must not
  // scroll the list. That takes a touchmove listener that is not passive
  // (React's onTouchMove is) and is in place before the touch starts: added
  // later, the browser has already taken the gesture for a scroll. It sits on
  // the header alone, so only touches that start on one wait for it.
  useEffect(() => {
    const element = rowRef.current;
    if (!canDrag || !element) return;
    const onTouchMove = (event: TouchEvent) => drag.onTouchMove(event);
    element.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => element.removeEventListener("touchmove", onTouchMove);
  }, [canDrag, drag]);

  // Seeded with the name shown. The field counts UTF-16 units, the server
  // code points: whatever fits the field, the server takes.
  if (renaming) {
    return (
      <div ref={rowRef} className={`${className} is-renaming`} style={rowStyle(top, height)} data-row-key={row.key}>
        <RenameInput
          initialValue={project.name}
          label={t("sidebar.projectName")}
          maxLength={MAX_PROJECT_NAME_LENGTH}
          onCommit={(value) => handlers.current.onRenameProjectCommit(project, value)}
          onCancel={() => handlers.current.onRenameProjectCancel()}
        />
      </div>
    );
  }

  return (
    <div
      ref={rowRef}
      className={className}
      style={rowStyle(top, height)}
      data-row-key={row.key}
      onPointerDown={canDrag ? (event) => drag.onPointerDown(event, project.key) : undefined}
    >
      <button
        type="button"
        className="session-tree-group-toggle"
        aria-expanded={expanded}
        title={project.root}
        onClick={(event) => handlers.current.onToggleGroup(project.key, event.altKey)}
      >
        <span className="session-tree-group-name">{project.name}</span>
        {project.pinned && <PinIcon size={10} className="session-tree-group-pin" label={t("sidebar.pinnedProject")} />}
        <ChevronIcon size={10} className={`session-tree-chevron${expanded ? " is-open" : ""}`} />
        {!expanded && <ActivitySummary running={row.running} unread={row.unread} t={t} />}
      </button>
      <span className="session-tree-group-actions">
        <button
          type="button"
          className="session-tree-group-action"
          aria-label={t("sidebar.newSessionInProject", { name: project.name })}
          title={t("sidebar.newSessionInProject", { name: project.name })}
          onClick={(event) => {
            event.stopPropagation();
            handlers.current.onGroupNew(project);
          }}
        >
          <PlusIcon size={13} />
        </button>
        <button
          type="button"
          className={`session-tree-group-action${menuOpen ? " is-active" : ""}`}
          aria-label={t("sidebar.projectActions", { name: project.name })}
          title={t("sidebar.projectActions", { name: project.name })}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={(event) => {
            event.stopPropagation();
            handlers.current.onGroupMenu(project, event.currentTarget);
          }}
        >
          <MoreIcon size={13} />
        </button>
      </span>
    </div>
  );
});

/** The rows with at most one control: section headers, "show more", footer links. */
const PlainRowView = memo(function PlainRowView({
  row,
  top,
  height,
  handlers,
  onMoreAction,
}: {
  row: Exclude<SidebarRow, { kind: "session" | "group" | "spacer" }>;
  top: number;
  height: number;
  handlers: Handlers;
  onMoreAction: (rowKey: string, key: string, action: "more" | "less", button: HTMLElement) => void;
}) {
  const { t } = useI18n();
  const style = rowStyle(top, height);

  switch (row.kind) {
    case "pinned-header":
      return (
        <div className="session-tree-row session-tree-pinned-header" style={style} data-row-key={row.key}>
          <button
            type="button"
            className="session-tree-pinned-toggle"
            aria-expanded={!row.collapsed}
            onClick={() => handlers.current.onTogglePinned()}
          >
            <span className="session-tree-pinned-label">{t("sidebar.pinned")}</span>
            <span className="session-tree-pinned-count">· {row.count}</span>
            <ChevronIcon size={9} className={`session-tree-chevron${row.collapsed ? "" : " is-open"}`} />
            {row.collapsed && row.running > 0 && (
              <span
                className="session-tree-pinned-dot is-running"
                role="img"
                title={t("sidebar.agentRunning")}
                aria-label={`${t("sidebar.agentRunning")} (${row.running})`}
              />
            )}
            {row.collapsed && row.unread > 0 && (
              <span
                className="session-tree-pinned-dot is-unread"
                role="img"
                title={t("sidebar.newSessionActivity")}
                aria-label={`${t("sidebar.newSessionActivity")} (${row.unread})`}
              />
            )}
          </button>
        </div>
      );
    case "pinned-more":
    case "group-more": {
      const moreKey = row.kind === "pinned-more" ? PINNED_MORE_KEY : row.projectKey;
      return (
        <div className="session-tree-row session-tree-more" style={style} data-row-key={row.key}>
          {row.hidden > 0 && (
            <button
              type="button"
              className="session-tree-more-toggle"
              data-more-action="more"
              onClick={(event) => onMoreAction(row.key, moreKey, "more", event.currentTarget)}
            >
              {t("sidebar.showMore", { count: row.hidden })}
            </button>
          )}
          {row.canShowLess && (
            <button
              type="button"
              className="session-tree-more-toggle"
              data-more-action="less"
              onClick={(event) => onMoreAction(row.key, moreKey, "less", event.currentTarget)}
            >
              {t("sidebar.showLess")}
            </button>
          )}
        </div>
      );
    }
    case "group-empty":
      return (
        <div className="session-tree-row session-tree-group-empty" style={style} data-row-key={row.key}>
          {t("sidebar.noLiveSessions")}
        </div>
      );
    case "footer-open":
      return (
        <div className="session-tree-row session-tree-footer" style={style} data-row-key={row.key}>
          <button
            type="button"
            className="session-tree-footer-button"
            onClick={(event) => handlers.current.onOpenOtherProject(event.currentTarget)}
          >
            <FolderPlusIcon size={12} />
            <span className="session-tree-footer-label">{t("sidebar.openOtherProject")}</span>
          </button>
        </div>
      );
    case "footer-archived":
      return (
        <div className="session-tree-row session-tree-footer" style={style} data-row-key={row.key}>
          <button type="button" className="session-tree-footer-button" onClick={() => handlers.current.onOpenArchive()}>
            <ArchiveIcon size={12} />
            <span className="session-tree-footer-label">{t("sidebar.archivedCount", { count: row.count })}</span>
            <ChevronIcon size={10} className="session-tree-footer-chevron" />
          </button>
        </div>
      );
    case "archive-group":
      return (
        <div className="session-tree-row session-tree-archive-group" style={style} data-row-key={row.key} title={row.project.root}>
          <span className="session-tree-archive-group-name">{row.project.name}</span>
          <span className="session-tree-archive-group-count">· {row.count}</span>
        </div>
      );
  }
});
