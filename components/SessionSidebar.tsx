"use client";

import { useEffect, useImperativeHandle, useLayoutEffect, useState, useCallback, useMemo, useRef, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode, type Ref, type RefObject, type UIEvent as ReactUIEvent } from "react";
import type { SessionInfo } from "@/lib/types";
import { listSessionFamilies, type SessionFamily } from "@/lib/session-family";
import { dispatchSessionRowContextMenu } from "@/lib/session-row-context-menu";
import { getProjectActivity, getRecentProjects } from "@/lib/project-groups";
import { workspaceKeyOf } from "@/lib/workspace-memory";
import {
  adjacentProjectMove,
  buildArchiveRows,
  buildSessionTree,
  familiesToArchive,
  familyIds,
  isFamilyArchived,
  isGroupExpanded,
  keepOutgoingGroupOpen,
  nextProjectKeysToRecord,
  showLessFamilies,
  showMoreFamilies,
  type SidebarProject,
  type SidebarRow,
} from "@/lib/session-tree";
import {
  forgetRetiredSidebarKeys,
  loadGroupExpansion,
  loadPinnedCollapsed,
  loadSidebarTab,
  saveGroupExpansion,
  savePinnedCollapsed,
  saveSidebarTab,
  type SidebarTab,
} from "@/lib/sidebar-prefs";
import { forkFailureMessage, sessionMenuEntries, type SessionMenuActionId } from "@/lib/sidebar-actions";
import { splitBeforeForkSuffix } from "@/lib/session-fork-name";
import {
  mergeProjectChoices,
  newSessionContextKey,
  type NewSessionContext,
  type NewSessionOptions,
  type NewSessionTarget,
  type ProjectChoice,
  type WorktreeChoice,
} from "@/lib/new-session-context";
import {
  chunkForSessionUiRequests,
  MAX_PROJECT_ORDER_KEYS,
  MAX_SESSION_UI_IDS_PER_REQUEST,
  type ProjectMovePosition,
  type SessionUiStateRequest,
} from "@/lib/session-ui-state-shared";
import { focusIfLost } from "@/lib/stacked-dialog";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useScrollbarVisibility } from "@/hooks/useScrollbarVisibility";
import { useSessionUiState } from "@/hooks/useSessionUiState";
import { DirectoryPicker } from "./DirectoryPicker";
import { DismissButton } from "./DismissButton";
import { FileExplorer, type FileExplorerHandle } from "./FileExplorer";
import { ProjectWorktreePicker, type ProjectWorktreePickerHandle, type WorktreeRemoval } from "./ProjectWorktreePicker";
import { SessionSearch } from "./SessionSearch";
import { SessionTree, sessionRowTitle, type SessionTreeReveal } from "./SessionTree";
import { SidebarMenu, type SidebarMenuAnchor, type SidebarMenuItem } from "./SidebarMenu";
import { SidebarToast, type SidebarToastAction, type SidebarToastData } from "./SidebarToast";
import {
  ArchiveIcon,
  ChangesIcon,
  CheckIcon,
  ChevronIcon,
  DotIcon,
  DotOutlineIcon,
  FolderIcon,
  MessageIcon,
  ForkIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
  PlusIcon,
  RefreshIcon,
  RestoreIcon,
  SearchIcon,
  TerminalIcon,
  TrashIcon,
  UploadIcon,
} from "./SidebarIcons";

interface FileManagerAvailability {
  supported: boolean;
  reason: string | null;
  platform: string;
}

// Server error codes with a translation; any other code is shown verbatim.
const FILE_MANAGER_ERROR_KEYS: Record<string, string> = {
  remote: "sidebar.openInExplorerRemoteOnly",
  "unsupported-platform": "sidebar.openInExplorerUnsupported",
};

declare global {
  interface Window {
    piDesktop?: {
      selectDirectory: () => Promise<string | null>;
    };
  }
}

/** An icon button of the files tab's action row, under the project and worktree. */
function ToolbarIconButton({
  onClick,
  title,
  disabled,
  pressed,
  done,
  children,
}: {
  onClick: () => void;
  title: string;
  disabled?: boolean;
  /** A toggle's state: shown pressed (accent) and exposed as aria-pressed. */
  pressed?: boolean;
  /** Brief confirmation after an action (refresh). */
  done?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      aria-pressed={pressed}
      className={`sidebar-tool-button${pressed ? " is-active" : ""}${done ? " is-done" : ""}`}
    >
      {children}
    </button>
  );
}

function sessionListUrl(summary: boolean, force: boolean): string {
  if (summary) return "/api/sessions?summary=1";
  if (force) return "/api/sessions?force=1";
  return "/api/sessions";
}

/** How a pick in the sidebar opens a session. */
export interface SelectSessionOptions {
  /** Leave a phone's drawer open: the sidebar has more to show (a fork's revealed row and its toast). */
  keepSidebarOpen?: boolean;
}

interface Props {
  selectedSessionId: string | null;
  onSelectSession: (session: SessionInfo, isRestore?: boolean, entryId?: string, blockIndex?: number, options?: SelectSessionOptions) => void;
  /** projectKey: the target's project identity when it is known (a group's "+", the composer's bar). */
  onNewSession?: (sessionId: string, cwd: string, projectKey?: string | null, options?: NewSessionOptions) => void;
  /** What the bar above a fresh composer moves through (`SessionSidebarControl`). */
  controlRef?: Ref<SessionSidebarControl>;
  /** The sidebar's cwd as the bar above a fresh composer shows it; reported when that changes. */
  onNewSessionContextChange?: (context: NewSessionContext | null) => void;
  initialSessionId?: string | null;
  skipInitialProjectSelection?: boolean;
  onInitialRestoreDone?: () => void;
  refreshKey?: number;
  onSessionDeleted?: (sessionId: string) => void;
  selectedCwd?: string | null;
  onCwdChange?: (
    cwd: string | null,
    projectRoot?: string | null,
    projectKey?: string | null,
  ) => void;
  onOpenFile?: (filePath: string, fileName: string, options?: { sourceSessionId?: string | null; modeHint?: "diff" }) => void;
  onOpenTerminal?: (cwd: string) => void;
  explorerRefreshKey?: number;
  onExplorerRefresh?: () => void;
  onAtMention?: (relativePath: string, isDir: boolean) => void;
  onAtMentions?: (relativePaths: string[]) => void;
  /** Fired when a session that is not currently selected finishes running.
   *  Lets the app play a cross-workspace completion tone. */
  onBackgroundTaskDone?: () => void;
  onRunningSessionIdsChange?: (ids: Set<string>) => void;
  onSessionsChange?: (sessions: SessionInfo[]) => void;
}

/**
 * How the bar above a fresh composer (components/NewSessionContextBar.tsx)
 * moves it: the sidebar keeps the cwd and the project identity, so every
 * move goes through here, as the sidebar's own "+" buttons do.
 */
export interface SessionSidebarControl {
  /** Identity, then the sidebar's cwd, then `onNewSession`, as any new session. */
  startNewSessionIn(target: NewSessionTarget): void;
  /**
   * Opens the folder picker; the validated folder goes to `onPicked`, which
   * decides whether to start there. Focus goes back to `returnFocusTo` when
   * the picker closes without moving the composer.
   */
  openFolderForNewSession(onPicked: (target: NewSessionTarget) => void, returnFocusTo: HTMLElement | null): void;
  /** "Use default directory": today's ~/pi-cwd folder, validated as the folder picker's, goes to `onPicked`. */
  openDefaultDirectoryForNewSession(onPicked: (target: NewSessionTarget) => void): void;
  /** Lists the worktrees of the sidebar's cwd again (the composer's worktree menu opening). */
  refreshWorktrees(): void;
  /** Creates a worktree of `project` and lists it at once; the caller starts the session in it. */
  createWorktree(project: ProjectChoice, branch: string): Promise<{ path: string } | { error: string }>;
}

type WorktreeEntry = WorktreeChoice;

interface WorktreeState {
  /** The cwd this data was fetched for — guards against stale responses */
  forCwd: string;
  projectRoot: string;
  /** Stable server-computed identity; never derive OS path semantics here. */
  projectKey: string;
  isGit: boolean;
  /** False when forCwd is a repo subdirectory — the switcher is hidden there
   *  because subdir sessions keep their own project identity */
  isTopLevel: boolean;
  /** Canonical path of the checkout containing forCwd, resolved server-side. */
  currentWorktreePath: string | null;
  worktrees: WorktreeEntry[];
}

interface ProjectSelection {
  root: string;
  key: string;
}

interface ValidatedProject {
  cwd: string;
  root: string;
  key: string;
}

type SessionRow = Extract<SidebarRow, { kind: "session" }>;

/** The one popup menu of the sidebar; kept here, above the virtualized rows. */
type SidebarMenuState =
  | { kind: "row"; row: SessionRow; anchor: SidebarMenuAnchor; opener: HTMLElement | null }
  | { kind: "group"; project: SidebarProject; olderCount: number; anchor: SidebarMenuAnchor; opener: HTMLElement };

const UNREAD_SESSIONS_STORAGE_KEY = "pi-web:unread-session-ids";
const LAST_CUSTOM_CWD_STORAGE_KEY = "pi-web:last-custom-cwd";
const RUNNING_SESSIONS_POLL_MS = 2500;
const SESSION_DETAILS_HYDRATION_DELAY_MS = 750;
/** "Archive sessions older than 7 days" in a project's menu. */
const ARCHIVE_OLDER_THAN_MS = 7 * 24 * 60 * 60 * 1000;
const TOAST_TITLE_MAX = 28;

const SESSION_ACTION_LABEL_KEYS: Record<SessionMenuActionId, string> = {
  pin: "sidebar.pin",
  unpin: "sidebar.unpin",
  rename: "sidebar.rename",
  fork: "sidebar.fork",
  "mark-read": "sidebar.markRead",
  "mark-unread": "sidebar.markUnread",
  archive: "sidebar.archive",
  unarchive: "sidebar.unarchive",
  delete: "sidebar.delete",
};

function sessionActionIcon(id: SessionMenuActionId): ReactNode {
  switch (id) {
    case "pin": return <PinIcon />;
    case "unpin": return <PinOffIcon />;
    case "rename": return <PencilIcon />;
    case "fork": return <ForkIcon />;
    case "mark-read": return <DotOutlineIcon />;
    case "mark-unread": return <DotIcon />;
    case "archive": return <ArchiveIcon />;
    case "unarchive": return <RestoreIcon />;
    case "delete": return <TrashIcon />;
  }
}

function loadLastCustomCwd(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(LAST_CUSTOM_CWD_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function saveLastCustomCwd(cwd: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LAST_CUSTOM_CWD_STORAGE_KEY, cwd);
  } catch {
    // Persistence is best-effort.
  }
}

function loadUnreadSessionIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(UNREAD_SESSIONS_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return new Set(parsed.filter((id): id is string => typeof id === "string"));
    return new Set();
  } catch {
    return new Set();
  }
}

function saveUnreadSessionIds(ids: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    if (ids.size === 0) window.localStorage.removeItem(UNREAD_SESSIONS_STORAGE_KEY);
    else window.localStorage.setItem(UNREAD_SESSIONS_STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // ignore storage quota / privacy-mode errors
  }
}

/**
 * The running set for a polled id list: `previous` itself while it holds the
 * same ids. A new Set every 2.5 s poll would rebuild every tree row (memoized
 * by identity) and re-run everything that watches the set, for nothing.
 */
export function sameIdsOr(previous: Set<string>, ids: readonly string[]): Set<string> {
  const next = new Set(ids);
  if (next.size !== previous.size) return next;
  for (const id of next) {
    if (!previous.has(id)) return next;
  }
  return previous;
}

/** Temporary id for a session that does not exist yet: pi is spawned lazily
 *  when the user sends the first message, so no backend call is needed. */
function createTempSessionId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function shortTitle(title: string, max: number): string {
  return title.length > max ? `${title.slice(0, max)}…` : title;
}

/**
 * focusIfLost, also when focus is still on an element that is no longer
 * rendered (in a view just hidden): browsers move it to <body> only at their
 * next rendering update, so it does not count as lost yet.
 */
function focusIfHidden(target: HTMLElement | null): void {
  const active = document.activeElement;
  if (target && active instanceof HTMLElement && active !== document.body && active.getClientRects().length === 0) {
    target.focus({ preventScroll: true });
    return;
  }
  focusIfLost(document, target);
}

/** A menu placed below (or above) a button, lined up with one of its edges. */
/**
 * How much of the toolbar row's labels fit (`data-fit`, app/sidebar.css):
 * all (0), New's + alone (1), the tabs' icons too (2). Measured, not a fixed
 * width, since the labels' widths change with the language; on the row
 * itself, before paint, again whenever it resizes or `labels` change.
 */
function useHeaderFit(ref: RefObject<HTMLElement | null>, labels: string): void {
  useLayoutEffect(() => {
    const header = ref.current;
    if (!header) return;
    const fit = () => {
      for (const level of ["0", "1", "2"]) {
        header.dataset.fit = level;
        if (header.scrollWidth <= header.clientWidth) return;
      }
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(header);
    return () => observer.disconnect();
  }, [ref, labels]);
}

function buttonAnchor(element: HTMLElement, align: "start" | "end"): SidebarMenuAnchor {
  const rect = element.getBoundingClientRect();
  return { kind: "rect", rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }, align };
}

export function SessionSidebar({ selectedSessionId, onSelectSession, onNewSession, controlRef, onNewSessionContextChange, initialSessionId, skipInitialProjectSelection, onInitialRestoreDone, refreshKey, onSessionDeleted, selectedCwd: selectedCwdProp, onCwdChange, onOpenFile, onOpenTerminal, explorerRefreshKey, onExplorerRefresh, onAtMention, onAtMentions, onBackgroundTaskDone, onRunningSessionIdsChange, onSessionsChange }: Props) {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const [allSessions, setAllSessions] = useState<SessionInfo[]>([]);
  // Tracked in a ref only: the version is compared against the polled value to
  // decide whether the list needs reloading, and no render reads it.
  const sessionListVersionRef = useRef<number | null>(null);
  const sessionLoadIdRef = useRef(0);
  const [loading, setLoading] = useState(true);
  // The first paint lists summary rows (their time is the file's mtime); the
  // project order is first saved from the full details.
  const [sessionDetailsLoaded, setSessionDetailsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedCwd, setSelectedCwd] = useState<string | null>(null);
  const [homeDir, setHomeDir] = useState<string>("");
  // Open for the files tab's project list, or for the composer's bar ("new-session").
  const [customPathOpen, setCustomPathOpen] = useState<false | "files" | "new-session">(false);
  const [customPathValue, setCustomPathValue] = useState(loadLastCustomCwd);
  const [customPathError, setCustomPathError] = useState<string | null>(null);
  const [customPathValidating, setCustomPathValidating] = useState(false);
  const [validatedProject, setValidatedProject] = useState<ValidatedProject | null>(null);
  // The files tab's project and worktree picker.
  const filesPickerRef = useRef<ProjectWorktreePickerHandle>(null);
  const [worktreeState, setWorktreeState] = useState<WorktreeState | null>(null);
  const [worktreeLoadingCwd, setWorktreeLoadingCwd] = useState<string | null>(null);
  const [explorerKey, setExplorerKey] = useState(0);
  const [explorerUploadBusy, setExplorerUploadBusy] = useState(false);
  const [fileSearchOpen, setFileSearchOpen] = useState(false);
  const [sessionSearchOpen, setSessionSearchOpen] = useState(false);
  const [sessionSearchQuery, setSessionSearchQuery] = useState("");
  const [changesCount, setChangesCount] = useState(0);
  const [changesCollapsed, setChangesCollapsed] = useState(true);
  const [explorerRefreshDone, setExplorerRefreshDone] = useState(false);
  const [fileManager, setFileManager] = useState<FileManagerAvailability | null>(null);
  const [fileManagerError, setFileManagerError] = useState<string | null>(null);
  const [runningSessionIds, setRunningSessionIds] = useState<Set<string>>(() => new Set());
  const [unreadSessionIds, setUnreadSessionIds] = useState<Set<string>>(() => loadUnreadSessionIds());
  const previousRunningSessionIdsRef = useRef<Set<string>>(new Set());
  const currentSuppressedCompletionSessionIdsRef = useRef<Set<string>>(new Set());
  const previousSuppressedCompletionSessionIdsRef = useRef<Set<string>>(new Set());
  // Once polling has delivered a snapshot it is the source of truth for
  // running state; late /api/sessions responses must not overwrite it.
  const runningPollAuthoritativeRef = useRef(false);
  const detailsHydrationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const explorerRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileExplorerRef = useRef<FileExplorerHandle>(null);

  // Sessions | Files. Both panels stay mounted; only the active one is shown.
  // The tab, the group choices and the pinned section start as the server
  // renders them and are restored from browser storage after hydration.
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("sessions");
  const sessionsTabRef = useRef<HTMLButtonElement>(null);
  const filesTabRef = useRef<HTMLButtonElement>(null);
  const sessionsPanelRef = useRef<HTMLDivElement>(null);
  const filesPanelRef = useRef<HTMLDivElement>(null);
  const panelScrollTopsRef = useRef(new WeakMap<Element, number>());
  // Project groups: explicit expand/collapse choices, how many families "show
  // more" has revealed per group (SHOW_MORE_STEP a click), the pinned section,
  // the archive view.
  const [groupExpansion, setGroupExpansion] = useState<Readonly<Record<string, boolean>>>({});
  const [moreShown, setMoreShown] = useState<Readonly<Record<string, number>>>({});
  const [pinnedCollapsed, setPinnedCollapsed] = useState(false);
  const [archiveView, setArchiveView] = useState(false);
  // Row states that must survive virtualization live here, not in the rows.
  const [renamingRootId, setRenamingRootId] = useState<string | null>(null);
  const [confirmDeleteRootId, setConfirmDeleteRootId] = useState<string | null>(null);
  const [menu, setMenu] = useState<SidebarMenuState | null>(null);
  // A row the main tree should scroll to (a fork's new row); see
  // SessionTreeReveal. Held until the tree says it is done with it.
  const [treeReveal, setTreeReveal] = useState<SessionTreeReveal | null>(null);
  const treeRevealIdRef = useRef(0);
  const handleRevealHandled = useCallback((id: number) => {
    setTreeReveal((current) => (current?.id === id ? null : current));
  }, []);
  const selectedSessionIdRef = useRef(selectedSessionId);
  selectedSessionIdRef.current = selectedSessionId;
  const [toast, setToast] = useState<SidebarToastData | null>(null);
  const toastIdRef = useRef(0);
  const [uiWriteFailures, setUiWriteFailures] = useState(0);
  const shownUiWriteFailuresRef = useRef(0);
  // Focus to hand to the files tab once it shows (the control that moved
  // there was in the sessions tab, which hides with its focus).
  const filesTabFocusRef = useRef<"project-button" | "project-list" | null>(null);
  const contextMenuFocusRef = useRef<HTMLElement | null>(null);
  // The composer's "Open another project…": where the validated folder goes,
  // and the control focus returns to when the composer does not move.
  const folderPickRef = useRef<((target: NewSessionTarget) => void) | null>(null);
  const folderReturnFocusRef = useRef<HTMLElement | null>(null);

  // Focus to settle once a change is on the page, after the control that had
  // it went away with that change (a toast's button, a delete confirmation's
  // Cancel, the folder picker). Only focus that fell to <body> moves
  // (focusIfLost): focus the user put elsewhere stays.
  const focusAfterCommitRef = useRef<(() => HTMLElement | null) | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const focusAfterCommit = useCallback((target: () => HTMLElement | null) => {
    focusAfterCommitRef.current = target;
    setFocusRequest((count) => count + 1);
  }, []);
  useEffect(() => {
    const target = focusAfterCommitRef.current;
    focusAfterCommitRef.current = null;
    if (target) focusIfLost(document, target());
  }, [focusRequest]);

  // Pins, archive and project order: pi-web's own state, kept on the server for every window.
  const {
    state: uiState,
    loaded: uiStateLoaded,
    synced: uiStateSynced,
    error: uiStateError,
    apply: applyUiStateRequest,
    snapshot: snapshotUiState,
    noteRevision: noteUiRevision,
  } = useSessionUiState();

  // The explorer's scroll container is always mounted (empty without a cwd),
  // so the scrollbar hook stays bound to the element that is on the page.
  const headerRef = useRef<HTMLDivElement>(null);
  const explorerScrollRef = useRef<HTMLDivElement>(null);
  useScrollbarVisibility(explorerScrollRef);

  // Browser storage is unavailable during server rendering. Restore the
  // sidebar preferences after hydration: read in a state initializer, a saved
  // Files tab would make the first client render differ from the server's
  // HTML (a hydration error, and the server markup thrown away).
  useEffect(() => {
    const tab = loadSidebarTab();
    if (tab !== "sessions") setSidebarTab(tab);
    const groups = loadGroupExpansion();
    if (Object.keys(groups).length > 0) setGroupExpansion(groups);
    if (loadPinnedCollapsed()) setPinnedCollapsed(true);
    forgetRetiredSidebarKeys();
  }, []);

  const loadSessions = useCallback(async (showLoading = false, force = false, summary = false) => {
    const loadId = ++sessionLoadIdRef.current;
    try {
      if (showLoading) setLoading(true);
      const res = await fetch(sessionListUrl(summary, force), {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as {
        sessions: SessionInfo[];
        sessionListVersion: number;
        runningSessionIds?: string[];
        completionNotificationSuppressedSessionIds?: string[];
      };
      if (loadId !== sessionLoadIdRef.current) return;
      sessionListVersionRef.current = data.sessionListVersion;
      setAllSessions(data.sessions);
      if (!summary) setSessionDetailsLoaded(true);
      // Treat the fetched running set as an initial fallback only. Once the
      // lightweight poll is live, a slow session-list fetch cannot overwrite it.
      if (!runningPollAuthoritativeRef.current) {
        currentSuppressedCompletionSessionIdsRef.current = new Set(
          data.completionNotificationSuppressedSessionIds ?? [],
        );
        setRunningSessionIds((previous) => sameIdsOr(previous, data.runningSessionIds ?? []));
      }
      // Drop markers for deleted sessions and for subagents, whose completion
      // is intentionally silent even if an older client marked them unread.
      const unreadEligibleIds = new Set(
        data.sessions
          .filter((session) => session.relation?.kind !== "subagent")
          .map((session) => session.id),
      );
      setUnreadSessionIds((prev) => {
        if (prev.size === 0) return prev;
        const next = new Set([...prev].filter((id) => unreadEligibleIds.has(id)));
        return next.size === prev.size ? prev : next;
      });
      setError(null);
    } catch (e) {
      if (loadId === sessionLoadIdRef.current) setError(String(e));
    } finally {
      if (loadId === sessionLoadIdRef.current) setLoading(false);
    }
  }, []);

  const initialLoadDone = useRef(false);
  useEffect(() => {
    const isFirst = !initialLoadDone.current;
    initialLoadDone.current = true;
    let active = true;

    if (isFirst) {
      // Header/stat metadata is enough to select the URL session and paint the
      // sidebar. Hydrate exact counts, names, and first messages once the
      // selected chat has had a chance to start loading.
      void loadSessions(true, false, true).then(() => {
        if (!active) return;
        detailsHydrationTimerRef.current = setTimeout(() => {
          detailsHydrationTimerRef.current = null;
          if (active) void loadSessions(false, true);
        }, SESSION_DETAILS_HYDRATION_DELAY_MS);
      });
    } else {
      void loadSessions(false, true);
    }

    return () => {
      active = false;
      if (detailsHydrationTimerRef.current) {
        clearTimeout(detailsHydrationTimerRef.current);
        detailsHydrationTimerRef.current = null;
      }
    };
  }, [loadSessions, refreshKey]);

  // Only the server can raise a file-manager window, and only when the browser
  // runs on that same machine. Ask it once so the button can pick the right
  // label (Explorer / Finder / generic) and disable itself when unavailable.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/open-in-explorer")
      .then((res) => res.ok ? res.json() as Promise<FileManagerAvailability> : null)
      .then((data) => { if (!cancelled && data) setFileManager(data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // A failure belongs to the project it happened on.
  useEffect(() => {
    setFileManagerError(null);
  }, [selectedCwd, selectedCwdProp]);

  const openInFileManager = useCallback(async () => {
    const dir = selectedCwd ?? selectedCwdProp;
    if (!dir) return;
    try {
      const res = await fetch("/api/open-in-explorer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: dir }),
      });
      if (res.ok) {
        setFileManagerError(null);
        return;
      }
      const data = await res.json().catch(() => ({})) as { error?: string };
      setFileManagerError(data.error ?? `HTTP ${res.status}`);
    } catch (error) {
      setFileManagerError(error instanceof Error ? error.message : String(error));
    }
  }, [selectedCwd, selectedCwdProp]);

  const fileManagerLabel = t(
    fileManager?.platform === "darwin"
      ? "sidebar.openInFinder"
      : fileManager?.platform === "win32"
        ? "sidebar.openInExplorer"
        : "sidebar.openInFileManager",
  );
  const fileManagerUnavailable = fileManager?.supported === false;
  const fileManagerErrorMessage = fileManagerError
    ? t(FILE_MANAGER_ERROR_KEYS[fileManagerError] ?? fileManagerError)
    : null;

  // Persist unread markers so they survive a browser refresh before the user
  // has actually opened the completed session.
  useEffect(() => {
    saveUnreadSessionIds(unreadSessionIds);
  }, [unreadSessionIds]);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let controller: AbortController | null = null;

    const clearTimer = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };

    const schedule = () => {
      clearTimer();
      if (stopped || document.visibilityState !== "visible") return;
      timer = setTimeout(() => void poll(), RUNNING_SESSIONS_POLL_MS);
    };

    const poll = async () => {
      if (stopped || document.visibilityState !== "visible") return;
      const current = new AbortController();
      controller?.abort();
      controller = current;
      try {
        const res = await fetch("/api/agent/running", {
          cache: "no-store",
          signal: current.signal,
        });
        if (!res.ok) return;
        const data = await res.json() as {
          sessionListVersion: number;
          runningSessionIds?: string[];
          completionNotificationSuppressedSessionIds?: string[];
          sessionUiStateRevision?: number | null;
        };
        if (stopped || controller !== current) return;
        runningPollAuthoritativeRef.current = true;
        currentSuppressedCompletionSessionIdsRef.current = new Set(
          data.completionNotificationSuppressedSessionIds ?? [],
        );
        setRunningSessionIds((previous) => sameIdsOr(previous, data.runningSessionIds ?? []));
        // Pins and archive changed in another window: reload them.
        noteUiRevision(data.sessionUiStateRevision);
        if (data.sessionListVersion !== sessionListVersionRef.current) {
          // Reuse the invalidated cache; forcing a scan would change the version again.
          await loadSessions();
        }
      } catch {
        // Keep the last known state; the next visible-tab poll retries.
      } finally {
        if (controller === current) controller = null;
        schedule();
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void poll();
        return;
      }
      clearTimer();
      controller?.abort();
      controller = null;
    };

    void poll();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stopped = true;
      clearTimer();
      controller?.abort();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [loadSessions, noteUiRevision]);

  useEffect(() => {
    onRunningSessionIdsChange?.(runningSessionIds);
  }, [onRunningSessionIdsChange, runningSessionIds]);

  useEffect(() => {
    onSessionsChange?.(allSessions);
  }, [allSessions, onSessionsChange]);

  useEffect(() => {
    const previous = previousRunningSessionIdsRef.current;
    const completedInBackground = [...previous].filter((id) => !runningSessionIds.has(id) && id !== selectedSessionId);
    const knownSubagentIds = new Set(
      allSessions
        .filter((session) => session.relation?.kind === "subagent")
        .map((session) => session.id),
    );
    const completedWithNotifications = completedInBackground.filter(
      (id) => !previousSuppressedCompletionSessionIdsRef.current.has(id) && !knownSubagentIds.has(id),
    );
    const newlyRunning = [...runningSessionIds].filter((id) => !previous.has(id));

    if (completedWithNotifications.length > 0 || newlyRunning.length > 0) {
      setUnreadSessionIds((prev) => {
        const next = new Set(prev);
        runningSessionIds.forEach((id) => next.delete(id));
        completedWithNotifications.forEach((id) => next.add(id));
        return next;
      });
    }
    const hasUnlistedRunningSession = newlyRunning.some(
      (id) => !allSessions.some((session) => session.id === id),
    );
    if (completedInBackground.length > 0 || hasUnlistedRunningSession) {
      loadSessions(false, true);
    }
    if (completedWithNotifications.length > 0) {
      onBackgroundTaskDone?.();
    }

    previousRunningSessionIdsRef.current = runningSessionIds;
    previousSuppressedCompletionSessionIdsRef.current = new Set(
      [...runningSessionIds].filter(
        (id) => currentSuppressedCompletionSessionIdsRef.current.has(id) || knownSubagentIds.has(id),
      ),
    );
  }, [runningSessionIds, selectedSessionId, allSessions, loadSessions, onBackgroundTaskDone]);

  useEffect(() => {
    if (!selectedSessionId) return;
    setUnreadSessionIds((prev) => {
      if (!prev.has(selectedSessionId)) return prev;
      const next = new Set(prev);
      next.delete(selectedSessionId);
      return next;
    });
  }, [selectedSessionId]);

  useEffect(() => {
    if (explorerRefreshKey !== undefined) setExplorerKey((k) => k + 1);
  }, [explorerRefreshKey]);

  useEffect(() => {
    fetch("/api/home").then((r) => r.json()).then((d: { home?: string }) => {
      if (d.home) setHomeDir(d.home);
    }).catch(() => {});
  }, []);

  const restoredRef = useRef(false);

  const projectSelection = useCallback((root: string, key: string): ProjectSelection => ({
    root,
    key,
  }), []);

  /** Resolve both display root and stable identity from server-provided data. */
  const projectFor = useCallback((cwd: string | null): ProjectSelection | null => {
    if (!cwd) return null;
    // /api/cwd/validate resolves identity before a custom path becomes active,
    // preventing one render with a raw path key from looking like a switch.
    if (validatedProject?.cwd === cwd) {
      return projectSelection(validatedProject.root, validatedProject.key);
    }
    if (worktreeState && worktreeState.forCwd === cwd) {
      return projectSelection(worktreeState.projectRoot, worktreeState.projectKey);
    }
    // Any path in the loaded worktree list belongs to that project — covers
    // worktrees without sessions, so switching to them keeps the row mounted.
    if (worktreeState?.worktrees.some((w) => w.path === cwd)) {
      return projectSelection(worktreeState.projectRoot, worktreeState.projectKey);
    }
    const match = allSessions.find((session) => (
      session.cwd === cwd || (session.projectRoot ?? session.cwd) === cwd
    ));
    return match
      ? projectSelection(match.projectRoot ?? match.cwd, workspaceKeyOf(match))
      : projectSelection(cwd, cwd);
  }, [validatedProject, worktreeState, allSessions, projectSelection]);

  // The project of the sidebar's cwd: the files tab shows it, and its group in
  // the sessions tab exists even before it has a session.
  const selectedProject = useMemo(() => projectFor(selectedCwd), [projectFor, selectedCwd]);

  // A worktree/session refresh can hydrate the stable key without changing
  // cwd, so notify when either changes. The parent treats same-cwd key changes
  // as identity hydration rather than a workspace switch.
  const lastNotifiedProjectRef = useRef<{ cwd: string | null; key: string | null } | null>(null);
  useEffect(() => {
    const project = projectFor(selectedCwd);
    const previous = lastNotifiedProjectRef.current;
    if (previous?.cwd === selectedCwd && previous.key === (project?.key ?? null)) return;
    lastNotifiedProjectRef.current = { cwd: selectedCwd, key: project?.key ?? null };
    onCwdChange?.(
      selectedCwd,
      project?.root ?? null,
      project?.key ?? null,
    );
  }, [selectedCwd, onCwdChange, projectFor]);

  // Sync the worktree switcher to the selected session's cwd. Sessions of all
  // worktrees in a project share one group, so clicking a session from another
  // worktree should move the effective cwd there. Only fires when the prop
  // value changes, so a manual switcher change is not snapped back. The prop
  // goes null when the shell switches project from here; forgetting the last
  // value then lets a restored session in a worktree that was synced before
  // move the cwd again, so the files tab shows the checkout the chat uses.
  const lastSyncedCwdPropRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedCwdProp) {
      lastSyncedCwdPropRef.current = null;
      return;
    }
    if (selectedCwdProp !== lastSyncedCwdPropRef.current) {
      lastSyncedCwdPropRef.current = selectedCwdProp;
      setSelectedCwd(selectedCwdProp);
    }
  }, [selectedCwdProp]);

  // Load worktrees for the current effective cwd
  const [wtRefreshKey, setWtRefreshKey] = useState(0);
  useLayoutEffect(() => {
    if (!selectedCwd) {
      setWorktreeState(null);
      setWorktreeLoadingCwd(null);
      return;
    }
    let cancelled = false;
    setWorktreeLoadingCwd(selectedCwd);
    fetch(`/api/worktrees?cwd=${encodeURIComponent(selectedCwd)}`)
      .then((r) => r.json())
      .then((d: { projectRoot?: string; projectKey?: string; isGit?: boolean; isTopLevel?: boolean; currentWorktreePath?: string | null; worktrees?: WorktreeEntry[]; error?: string }) => {
        if (cancelled) return;
        setWorktreeLoadingCwd(null);
        if (d.error || !d.projectRoot) {
          setWorktreeState(null);
          return;
        }
        setWorktreeState({
          forCwd: selectedCwd,
          projectRoot: d.projectRoot,
          projectKey: d.projectKey ?? d.projectRoot,
          isGit: d.isGit ?? false,
          isTopLevel: d.isTopLevel ?? false,
          currentWorktreePath: d.currentWorktreePath ?? null,
          worktrees: d.worktrees ?? [],
        });
      })
      .catch(() => {
        if (!cancelled) {
          setWorktreeLoadingCwd(null);
          setWorktreeState(null);
        }
      });
    return () => { cancelled = true; };
  }, [selectedCwd, wtRefreshKey, refreshKey]);

  // Auto-select cwd and restore session from URL on first load
  useEffect(() => {
    if (allSessions.length === 0 || skipInitialProjectSelection) return;

    if (selectedCwd === null) {
      // If restoring a session, set cwd to match that session
      if (initialSessionId && !restoredRef.current) {
        restoredRef.current = true;
        const target = allSessions.find((s) => s.id === initialSessionId);
        if (target) {
          setSelectedCwd(target.cwd);
          onSelectSession(target, true);
          return;
        }
        // Session not found — notify parent so it can show the placeholder
        onInitialRestoreDone?.();
      }
      const projects = getRecentProjects(allSessions);
      if (projects.length > 0) setSelectedCwd(projects[0].root);
    }
  }, [allSessions, selectedCwd, initialSessionId, skipInitialProjectSelection, onSelectSession, onInitialRestoreDone]);

  // Prefer an exact UI selection while a refetch is in flight. Once the
  // response catches up, the server-resolved path handles Windows case and
  // separator differences without teaching the browser OS path semantics.
  const currentWorktree = worktreeState
    ? worktreeState.worktrees.find((worktree) => worktree.path === selectedCwd)
      ?? (worktreeState.forCwd === selectedCwd && worktreeState.currentWorktreePath
        ? worktreeState.worktrees.find((worktree) => worktree.path === worktreeState.currentWorktreePath)
        : undefined)
      ?? worktreeState.worktrees.find((worktree) => worktree.isMain)
    : undefined;
  const currentWorktreePath = currentWorktree?.path ?? null;

  // `purpose`: who asked, the folder picker's opener by default ("Use default directory" names its own).
  const commitCustomPath = useCallback(async (candidate?: string, { remember = true, purpose = customPathOpen } = {}) => {
    const path = (candidate ?? customPathValue).trim();
    if (!path || customPathValidating) return;

    setCustomPathValidating(true);
    setCustomPathError(null);
    try {
      const res = await fetch("/api/cwd/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: path }),
      });
      const data = await res.json().catch(() => ({})) as {
        cwd?: string;
        projectRoot?: string;
        projectKey?: string;
        error?: string;
      };
      if (!res.ok || data.error || !data.cwd || !data.projectRoot || !data.projectKey) {
        setCustomPathError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      if (remember) {
        saveLastCustomCwd(data.cwd);
        setCustomPathValue(data.cwd);
      }
      setCustomPathOpen(false);
      if (purpose === "new-session") {
        // The composer's bar asked: the shell decides whether its fresh
        // composer moves there, and the sidebar's cwd moves only with it.
        const pick = folderPickRef.current;
        const opener = folderReturnFocusRef.current;
        folderPickRef.current = null;
        folderReturnFocusRef.current = null;
        pick?.({ cwd: data.cwd, projectKey: data.projectKey, projectRoot: data.projectRoot });
        // Not moved (the folder in use): the bar's control takes focus back.
        focusAfterCommit(() => (opener?.isConnected ? opener : null));
        return;
      }
      setValidatedProject({
        cwd: data.cwd,
        root: data.projectRoot,
        key: data.projectKey,
      });
      setSelectedCwd(data.cwd);
    } catch (e) {
      setCustomPathError(e instanceof Error ? e.message : String(e));
    } finally {
      setCustomPathValidating(false);
    }
  }, [customPathOpen, customPathValue, customPathValidating, focusAfterCommit]);

  const handleCustomPathClick = useCallback(() => {
    setCustomPathOpen("files");
    setCustomPathError(null);
  }, []);
  const handleDefaultCwd = useCallback(async (purpose: "files" | "new-session" = "files") => {
    try {
      const res = await fetch("/api/default-cwd", { method: "POST" });
      const data = await res.json() as { cwd?: string; error?: string };
      // Select it like any other directory, so validation, project identity and
      // the file allow-list all go through /api/cwd/validate. It is not a path
      // the user typed, so the custom-path picker does not remember it.
      if (data.cwd) await commitCustomPath(data.cwd, { remember: false, purpose });
    } catch {
      // ignore
    }
  }, [commitCustomPath]);
  // The composer's bar asks through the handle, which is made once.
  const handleDefaultCwdRef = useRef(handleDefaultCwd);
  handleDefaultCwdRef.current = handleDefaultCwd;

  // Both pickers create through here: the worktree is listed at once, so
  // projectFor() keeps it in the project before the refetch lands, and
  // listed even when nobody moves there. The picker moves there itself.
  const createWorktree = useCallback(async (project: ProjectChoice, branch: string): Promise<{ path: string } | { error: string }> => {
    try {
      const res = await fetch("/api/worktrees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: project.root, branch }),
      });
      const data = await res.json().catch(() => ({})) as { path?: string; error?: string };
      if (!res.ok || data.error || !data.path) return { error: data.error ?? `HTTP ${res.status}` };
      const path = data.path;
      setWorktreeState((prev) => (prev && prev.projectKey === project.key && !prev.worktrees.some((worktree) => worktree.path === path)
        ? { ...prev, worktrees: [...prev.worktrees, { path, branch, isMain: false }] }
        : prev));
      setWtRefreshKey((k) => k + 1);
      return { path };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, []);

  // The files tab's remove button. A checkout with changes answers "dirty",
  // and the picker asks before retrying with force.
  const handleRemoveWorktree = useCallback(async (project: ProjectChoice, path: string, force: boolean): Promise<WorktreeRemoval> => {
    try {
      const res = await fetch("/api/worktrees", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: project.root, path, force }),
      });
      const data = await res.json().catch(() => ({})) as { error?: string; dirty?: boolean };
      if (!res.ok) {
        if (data.dirty && !force) return "dirty";
        return { error: data.error ?? `HTTP ${res.status}` };
      }
      if (currentWorktreePath === path) setSelectedCwd(project.root);
      setWtRefreshKey((k) => k + 1);
      return "removed";
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, [currentWorktreePath]);

  const refreshWorktrees = useCallback(() => setWtRefreshKey((k) => k + 1), []);

  // The files tab's picks move the sidebar's cwd, with the identity the
  // picker read from the project list or the worktree listing: a pinned
  // project without sessions keeps its server key, as in startNewSessionIn.
  const handleFilesPick = useCallback(({ cwd, projectKey, projectRoot }: NewSessionTarget) => {
    if (projectKey && projectRoot) setValidatedProject({ cwd, root: projectRoot, key: projectKey });
    setSelectedCwd(cwd);
  }, []);

  // Clicking a session moves the effective cwd to that session's worktree.
  // Done on the click path (not via the selectedCwd prop sync) so it also
  // works when the prop value won't change — e.g. re-clicking the already
  // open session after manually switching worktrees.
  const handleSelectSessionFromList = useCallback((s: SessionInfo, entryId?: string, blockIndex?: number, options?: SelectSessionOptions) => {
    setAllSessions((current) => current.some((session) => session.id === s.id) ? current : [s, ...current]);
    if (s.cwd) setSelectedCwd(s.cwd);
    onSelectSession(s, false, entryId, blockIndex, options);
  }, [onSelectSession]);

  // Every "new session" goes through here. The cwd moves first, on the click
  // path like a session pick, and the shell gets the target's project so it
  // adopts it up front: a session in another project closes the previous
  // project's file tabs instead of being mistaken for identity hydration.
  const startNewSessionIn = useCallback(({ cwd, projectKey, projectRoot, carryComposer }: NewSessionTarget) => {
    // A worktree without sessions has no other source of identity yet.
    if (projectKey && projectRoot) setValidatedProject({ cwd, root: projectRoot, key: projectKey });
    setSelectedCwd(cwd);
    onNewSession?.(createTempSessionId(), cwd, projectKey, carryComposer ? { carryComposer: true } : undefined);
  }, [onNewSession]);
  // The handle below is made once: it calls the newest closure.
  const startNewSessionInRef = useRef(startNewSessionIn);
  startNewSessionInRef.current = startNewSessionIn;

  useImperativeHandle(controlRef, () => ({
    startNewSessionIn: (target) => startNewSessionInRef.current(target),
    openFolderForNewSession: (onPicked, returnFocusTo) => {
      folderPickRef.current = onPicked;
      folderReturnFocusRef.current = returnFocusTo;
      setCustomPathError(null);
      setCustomPathOpen("new-session");
    },
    openDefaultDirectoryForNewSession: (onPicked) => {
      folderPickRef.current = onPicked;
      folderReturnFocusRef.current = null;
      void handleDefaultCwdRef.current("new-session");
    },
    refreshWorktrees,
    createWorktree,
  }), [createWorktree, refreshWorktrees]);

  // Header "+": a new session in the sidebar's current cwd (worktree).
  const handleNewSession = useCallback(() => {
    if (!selectedCwd) return;
    startNewSessionIn({ cwd: selectedCwd });
  }, [selectedCwd, startNewSessionIn]);

  const recentProjects = useMemo(() => getRecentProjects(allSessions), [allSessions]);

  const sessionFamilies = useMemo(() => listSessionFamilies(allSessions), [allSessions]);
  const familyByRootId = useMemo(
    () => new Map(sessionFamilies.map((family) => [family.root.id, family])),
    [sessionFamilies],
  );

  // Every session id of an archived family (search tags them), and how many
  // families each project has in the archive.
  const archiveIndex = useMemo(() => {
    const ids = new Set<string>();
    const countByProject = new Map<string, number>();
    for (const family of sessionFamilies) {
      if (!isFamilyArchived(family, uiState, runningSessionIds)) continue;
      for (const id of familyIds(family)) ids.add(id);
      const key = workspaceKeyOf(family.root);
      countByProject.set(key, (countByProject.get(key) ?? 0) + 1);
    }
    return { ids, countByProject };
  }, [sessionFamilies, uiState, runningSessionIds]);

  // Per-project activity counts (running / unread) for the files tab's project menu.
  // Uses the same stable server key as the project list and filtering. An
  // archived family is out of sight, so it does not count as activity.
  const projectActivity = useMemo(
    () => getProjectActivity(
      archiveIndex.ids.size === 0 ? allSessions : allSessions.filter((session) => !archiveIndex.ids.has(session.id)),
      runningSessionIds,
      unreadSessionIds,
    ),
    [allSessions, archiveIndex, runningSessionIds, unreadSessionIds],
  );

  const showWorktreeSwitcher = Boolean(
    worktreeState?.isGit
    && worktreeState.isTopLevel
    && selectedCwd
    && selectedProject?.key === worktreeState.projectKey
  );
  const worktreeGuide = selectedCwd
    && worktreeState
    && selectedProject?.key === worktreeState.projectKey
    && !showWorktreeSwitcher
    ? (worktreeState.isGit
        ? {
             label: t("sidebar.openRepoRoot"),
             title: t("sidebar.openRepoRootTitle"),
          }
        : {
             label: t("sidebar.gitRepoRootOnly"),
             title: t("sidebar.gitRepoRootOnlyTitle"),
          })
    : null;
  const worktreeLoading = Boolean(selectedCwd && worktreeLoadingCwd === selectedCwd);
  const inactiveWorktreeSelector = worktreeGuide
    ?? (worktreeLoading && !showWorktreeSwitcher
      ? {
           label: t("sidebar.worktrees"),
           title: t("sidebar.checkingWorktrees"),
        }
      : null);

  // The tree of every project. Its group for the current project exists even
  // without sessions (a fresh custom path, a new worktree).
  const currentProjectKey = selectedProject?.key ?? null;
  const currentProjectRoot = selectedProject?.root ?? null;
  const currentProject = useMemo(
    () => (currentProjectKey && currentProjectRoot ? { key: currentProjectKey, root: currentProjectRoot } : null),
    [currentProjectKey, currentProjectRoot],
  );
  const model = useMemo(() => buildSessionTree({
    sessions: allSessions,
    uiState,
    runningIds: runningSessionIds,
    unreadIds: unreadSessionIds,
    selectedSessionId,
    currentProject,
    groupExpansion,
    moreShown,
    pinnedCollapsed,
  }), [allSessions, uiState, runningSessionIds, unreadSessionIds, selectedSessionId, currentProject, groupExpansion, moreShown, pinnedCollapsed]);
  const archiveRows = useMemo(() => (archiveView ? buildArchiveRows({
    sessions: allSessions,
    uiState,
    runningIds: runningSessionIds,
    unreadIds: unreadSessionIds,
    selectedSessionId,
    currentProject,
  }) : []), [archiveView, allSessions, uiState, runningSessionIds, unreadSessionIds, selectedSessionId, currentProject]);
  const projectByKey = useMemo(
    () => new Map(model.projects.map((project) => [project.key, project])),
    [model.projects],
  );

  // The project order is saved as projects turn up: a project without a place
  // renders at the top of its band, and saving it puts it at the top of the
  // list, so nothing moves on screen; from then on only a drag or Move up/down
  // moves it. The first save (an empty order) records the activity order the
  // user sees. It waits for real server state (a failed GET leaves the local
  // state empty: archived projects would count as live) and for the session
  // details (the summary rows' times are file mtimes). When more keys wait
  // than one request holds, the bottom ones go first
  // (nextProjectKeysToRecord): a batch never lands below keys still unsaved.
  // Each key is sent once per page: a refused save is not retried in a loop,
  // and keys that do not fit a full list are not sent again and again. A
  // background save fails quietly (the raw apply, no toast).
  const recordedOrderKeysRef = useRef(new Set<string>());
  const projectKeysToRecord = model.projectKeysToRecord;
  const storedOrderLength = uiState.projectOrder?.length ?? 0;
  useEffect(() => {
    if (loading || !uiStateSynced || !sessionDetailsLoaded) return;
    if (storedOrderLength >= MAX_PROJECT_ORDER_KEYS) return;
    const recorded = recordedOrderKeysRef.current;
    const keys = nextProjectKeysToRecord(projectKeysToRecord, recorded, MAX_SESSION_UI_IDS_PER_REQUEST);
    if (keys.length === 0) return;
    for (const key of keys) recorded.add(key);
    void applyUiStateRequest({ action: "add-projects", keys });
  }, [applyUiStateRequest, loading, projectKeysToRecord, sessionDetailsLoaded, storedOrderLength, uiStateSynced]);

  // Every project in the groups' order, then those with sessions but no
  // group (all of them archived, or pinned while the project is not): the
  // project menus of the files tab and of the bar above a fresh composer.
  const projectChoiceList = useMemo(() => mergeProjectChoices(model.projects, recentProjects), [model.projects, recentProjects]);

  // What both pickers show for this cwd: the project, its worktrees where the
  // files tab offers them (the top of a git checkout), every project. The
  // tree is rebuilt on every refresh and running poll; the bar above a fresh
  // composer hears of it only when something it shows changed.
  const newSessionContext = useMemo<NewSessionContext | null>(() => {
    if (!selectedCwd || !selectedProject) return null;
    const listed = showWorktreeSwitcher && worktreeState !== null;
    return {
      cwd: selectedCwd,
      project: { key: selectedProject.key, root: selectedProject.root },
      worktrees: listed ? worktreeState.worktrees.map(({ path, branch, isMain }) => ({ path, branch, isMain })) : null,
      currentWorktreePath: listed ? currentWorktreePath : null,
      projects: projectChoiceList,
    };
  }, [selectedCwd, selectedProject, showWorktreeSwitcher, worktreeState, currentWorktreePath, projectChoiceList]);
  const newSessionContextRef = useRef(newSessionContext);
  newSessionContextRef.current = newSessionContext;
  const newSessionContextSignature = newSessionContextKey(newSessionContext);
  useEffect(() => {
    onNewSessionContextChange?.(newSessionContextRef.current);
  }, [newSessionContextSignature, onNewSessionContextChange]);

  // Picking a session in another group makes its project current. The group
  // that was current keeps its look instead of folding up under the pointer
  // (keepOutgoingGroupOpen), before the browser paints the change.
  const previousCurrentProjectKeyRef = useRef(currentProjectKey);
  useLayoutEffect(() => {
    const previous = previousCurrentProjectKeyRef.current;
    previousCurrentProjectKeyRef.current = currentProjectKey;
    if (previous === null || previous === currentProjectKey) return;
    const next = keepOutgoingGroupOpen(groupExpansion, projectByKey.get(previous));
    if (next === groupExpansion) return;
    setGroupExpansion(next);
    saveGroupExpansion(next);
  }, [currentProjectKey, groupExpansion, projectByKey]);

  const showToast = useCallback((message: string, actions: SidebarToastAction[] = [], tail?: string) => {
    toastIdRef.current += 1;
    setToast({ id: toastIdRef.current, message, ...(tail ? { tail } : {}), actions });
  }, []);

  /** The selected tab: focus has somewhere to go when the control it was on is gone. */
  const selectedTabButton = useCallback(
    () => (sessionsPanelRef.current?.hidden ? filesTabRef : sessionsTabRef).current,
    [],
  );

  // A family's row where the tree shows it now (pinned, in its group, or in
  // the open archive view), else the selected tab.
  const familyRowButton = useCallback((rootId: string): HTMLElement | null => {
    const panel = sessionsPanelRef.current;
    for (const context of ["pinned", "group", "archive"]) {
      const key = CSS.escape(`session:${context}:${rootId}`);
      const button = panel?.querySelector<HTMLElement>(`[data-row-key="${key}"] .session-tree-main`);
      if (button && button.getClientRects().length > 0) return button;
    }
    return selectedTabButton();
  }, [selectedTabButton]);

  // Pin and archive changes apply at once and are saved in the background; a
  // refused save rolls back (useSessionUiState) and says why in a toast.
  const applyUiState = useCallback(async (request: SessionUiStateRequest) => {
    const ok = await applyUiStateRequest(request);
    if (!ok) setUiWriteFailures((count) => count + 1);
    return ok;
  }, [applyUiStateRequest]);
  useEffect(() => {
    if (uiWriteFailures === shownUiWriteFailuresRef.current) return;
    shownUiWriteFailuresRef.current = uiWriteFailures;
    showToast(t("sidebar.uiStateFailed", { error: uiStateError ?? "" }));
  }, [uiWriteFailures, uiStateError, showToast, t]);

  // A drop, or Move up/down: the project goes next to another of its band.
  // Its band's projects without a place are saved first, top to bottom, so
  // it lands where the user saw it; past one request's worth (a full list, a
  // move before the first save), the bottom ones, which land where they
  // show. The moved group is then scrolled into view (a drop past a tall
  // group, a keyboard move); kept mounted until then, it is still there for
  // the menu to give focus back to.
  const moveProject = useCallback((projectKey: string, anchorKey: string, position: ProjectMovePosition) => {
    const project = projectByKey.get(projectKey);
    const anchor = projectByKey.get(anchorKey);
    // Pinned or unpinned in another window meanwhile: a move never crosses bands.
    if (!project || !anchor || project === anchor || project.pinned !== anchor.pinned) return;
    const add = model.unorderedKeysByBand[project.pinned ? "pinned" : "other"].slice(-MAX_SESSION_UI_IDS_PER_REQUEST);
    void applyUiState({ action: "move-project", projectKey, anchorKey, position, add });
    treeRevealIdRef.current += 1;
    setTreeReveal({ id: treeRevealIdRef.current, at: Date.now(), rowKey: `group:${projectKey}` });
  }, [applyUiState, model.unorderedKeysByBand, projectByKey]);

  const switchTab = useCallback((tab: SidebarTab) => {
    setSidebarTab(tab);
    saveSidebarTab(tab);
  }, []);

  // A hidden panel is display: none, and browsers do not reliably keep the
  // scroll position of what it holds. Positions are noted as the user
  // scrolls and put back when the panel (or the tree under the archive
  // view) shows again; SessionTree then re-reads its window from them.
  const rememberScroll = useCallback((event: ReactUIEvent<HTMLDivElement>) => {
    const target = event.target;
    if (target instanceof Element) panelScrollTopsRef.current.set(target, target.scrollTop);
  }, []);
  useLayoutEffect(() => {
    const panel = (sidebarTab === "sessions" ? sessionsPanelRef : filesPanelRef).current;
    if (!panel) return;
    for (const element of panel.querySelectorAll<HTMLElement>(".session-tree-scroll, .sidebar-files-scroll")) {
      const saved = panelScrollTopsRef.current.get(element);
      if (saved !== undefined && element.scrollTop !== saved) element.scrollTop = saved;
    }
  }, [sidebarTab, archiveView]);

  const openArchiveView = useCallback(() => {
    setMenu(null);
    setArchiveView(true);
    // Search results would cover it.
    setSessionSearchOpen(false);
    switchTab("sessions");
  }, [switchTab]);

  // Opening the archive hides the tree that held focus (the footer link, a
  // menu's opener, the toast's View) and Back removes the archive's own
  // controls. Focus that went with them moves to the archive's Back button,
  // then back to the footer link, or to the tab when that row is not shown.
  const archiveBackRef = useRef<HTMLButtonElement>(null);
  const previousArchiveViewRef = useRef(archiveView);
  // Where closing the archive put focus: a fork opened from the archive
  // reveals its row and may take focus from there.
  const archiveCloseFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (previousArchiveViewRef.current === archiveView) return;
    previousArchiveViewRef.current = archiveView;
    if (archiveView) {
      focusIfHidden(archiveBackRef.current);
      return;
    }
    const footer = sessionsPanelRef.current?.querySelector<HTMLElement>('[data-row-key="footer-archived"] button');
    const target = footer && footer.getClientRects().length > 0 ? footer : selectedTabButton();
    focusIfHidden(target);
    if (target && document.activeElement === target) archiveCloseFocusRef.current = target;
  }, [archiveView, selectedTabButton]);

  const handleTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const next: SidebarTab = event.key === "Home" ? "sessions"
      : event.key === "End" ? "files"
      : sidebarTab === "sessions" ? "files" : "sessions";
    switchTab(next);
    (next === "sessions" ? sessionsTabRef : filesTabRef).current?.focus();
  };

  // A session family's pin and archive flags live on its root session.
  const setFamilyPinned = useCallback((family: SessionFamily, pinned: boolean) => {
    void applyUiState({ action: "set", ids: [family.root.id], pinned });
  }, [applyUiState]);

  const markFamilyRead = useCallback((family: SessionFamily, read: boolean) => {
    setUnreadSessionIds((prev) => {
      const next = new Set(prev);
      if (read) {
        for (const id of familyIds(family)) next.delete(id);
      } else {
        // Subagents never carry the marker (loadSessions prunes them).
        next.add(family.root.id);
      }
      return next;
    });
  }, []);

  // Unread markers coming back (Undo, a refused archive), except on the
  // session that is open by now: it has been read.
  const restoreUnread = useCallback((ids: readonly string[]) => {
    if (ids.length === 0) return;
    setUnreadSessionIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (id !== selectedSessionIdRef.current) next.add(id);
      }
      return next.size === prev.size ? prev : next;
    });
  }, []);

  const archiveFamilies = useCallback((families: readonly SessionFamily[]) => {
    const archivable = families.filter((family) => !family.root.transient);
    if (archivable.length === 0) return;
    const snapshot = snapshotUiState(archivable.map((family) => family.root.id));
    // Archived means dealt with: its unread markers go, and Undo brings them back.
    const memberIds = archivable.flatMap((family) => familyIds(family));
    const unreadBefore = memberIds.filter((id) => unreadSessionIds.has(id));
    // A request carries at most MAX_SESSION_UI_IDS_PER_REQUEST families, so a
    // big "Archive sessions older than 7 days" goes in parts; the write queue
    // of useSessionUiState keeps them, and an Undo after them, in order.
    for (const part of chunkForSessionUiRequests(archivable)) {
      const ids = part.map((family) => family.root.id);
      void applyUiState({ action: "set", ids, archived: true }).then((ok) => {
        // A refused part is back in the tree (rolled back): so are its markers.
        if (ok || unreadBefore.length === 0) return;
        const partIds = new Set(part.flatMap((family) => familyIds(family)));
        restoreUnread(unreadBefore.filter((id) => partIds.has(id)));
      });
    }
    if (unreadBefore.length > 0) {
      setUnreadSessionIds((prev) => {
        const next = new Set(prev);
        for (const id of memberIds) next.delete(id);
        return next;
      });
    }
    const message = archivable.length === 1
      ? t("sidebar.archivedToast", { title: shortTitle(sessionRowTitle(archivable[0].root), TOAST_TITLE_MAX) })
      : t("sidebar.archivedManyToast", { count: archivable.length });
    showToast(message, [
      {
        id: "undo",
        label: t("sidebar.undo"),
        onClick: () => {
          for (const entries of chunkForSessionUiRequests(snapshot)) {
            void applyUiState({ action: "restore", entries });
          }
          restoreUnread(unreadBefore);
          // The toast held focus; the first family back in the tree takes it.
          focusAfterCommit(() => familyRowButton(archivable[0].root.id));
        },
      },
      { id: "view", label: t("sidebar.viewArchive"), onClick: openArchiveView },
    ]);
  }, [applyUiState, focusAfterCommit, familyRowButton, openArchiveView, restoreUnread, showToast, snapshotUiState, t, unreadSessionIds]);

  // The row's archive button. A running family would come straight back, so
  // it is not archived (the row offers no button for it either).
  const archiveFamily = useCallback((family: SessionFamily) => {
    if (familyIds(family).some((id) => runningSessionIds.has(id))) return;
    archiveFamilies([family]);
  }, [archiveFamilies, runningSessionIds]);

  const restoreFamily = useCallback((family: SessionFamily) => {
    const ids = [family.root.id];
    const snapshot = snapshotUiState(ids);
    void applyUiState({ action: "set", ids, archived: false });
    showToast(t("sidebar.restoredToast", { title: shortTitle(sessionRowTitle(family.root), TOAST_TITLE_MAX) }), [
      {
        id: "undo",
        label: t("sidebar.undo"),
        onClick: () => {
          void applyUiState({ action: "restore", entries: snapshot });
          // Back in the archive view if it is open; else the tab takes focus.
          focusAfterCommit(() => familyRowButton(family.root.id));
        },
      },
    ]);
  }, [applyUiState, familyRowButton, focusAfterCommit, showToast, snapshotUiState, t]);

  const startRename = useCallback((family: SessionFamily) => {
    if (family.root.transient) return;
    setConfirmDeleteRootId(null);
    setRenamingRootId(family.root.id);
  }, []);

  const commitRename = useCallback(async (family: SessionFamily, renameValue: string) => {
    const session = family.root;
    const title = sessionRowTitle(session);
    const name = renameValue.trim();
    setRenamingRootId((current) => (current === session.id ? null : current));
    // No-op when unchanged: the fallback title (first message / id) isn't a
    // real stored name, so don't persist it as one. (The rename input seeds
    // from the same collapsed first message, so an untouched rename of a
    // skill-invoked session stays a no-op instead of persisting raw XML.)
    if (renameValue === title || name === (session.name ?? "")) return;
    try {
      await fetch(`/api/sessions/${encodeURIComponent(session.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      void loadSessions();
    } catch {
      // ignore
    }
  }, [loadSessions]);

  const performDelete = useCallback(async (family: SessionFamily) => {
    const session = family.root;
    if (session.transient) return;
    setConfirmDeleteRootId((current) => (current === session.id ? null : current));
    try {
      // The server deletes the family's subagent sessions with it.
      await fetch(`/api/sessions/${encodeURIComponent(session.id)}`, { method: "DELETE" });
      onSessionDeleted?.(session.id);
      void loadSessions();
    } catch {
      // The row stays; the next refresh shows what happened.
    }
  }, [loadSessions, onSessionDeleted]);

  // Only Shift skips the confirmation (Shift+click, Shift+Enter or Shift+D in the menu).
  const requestDelete = useCallback((family: SessionFamily, shiftKey: boolean) => {
    if (shiftKey) {
      void performDelete(family);
    } else {
      setRenamingRootId(null);
      setConfirmDeleteRootId(family.root.id);
    }
  }, [performDelete]);

  // Fork (the row menu's F): the server copies the family's current branch
  // into a new session beside it (POST /api/sessions/[id]/fork) and leaves
  // the source as it is, running or not. The copy opens where its row is: the
  // archive view closes (the copy has no pin or archive flag), a group the
  // user collapsed opens, and the main tree scrolls to the row, which takes
  // focus when it is still on the source's row (or fell to the page). Called
  // after a request and from a toast, so always through openForkedRef: the
  // newest state and AppShell's newest selection handler, never a click-time
  // closure. `fromRowKey` is the row whose Fork this answers: focus may move
  // from it, and a phone's drawer stays open, since the copy looks just like
  // its source and only the sidebar (its row, the toast) tells them apart.
  // null is the toast's Open, which opens the copy as a row click does.
  const openForked = (forked: SessionInfo, fromRowKey: string | null) => {
    archiveCloseFocusRef.current = null;
    if (archiveView) {
      // The main tree's saved position would be put back over the reveal.
      const main = sessionsPanelRef.current?.querySelector(".sidebar-sessions-view .session-tree-scroll");
      if (main) panelScrollTopsRef.current.delete(main);
      setArchiveView(false);
    }
    const groupKey = workspaceKeyOf(forked);
    if (Object.hasOwn(groupExpansion, groupKey) && groupExpansion[groupKey] === false) {
      const next = { ...groupExpansion };
      // Re-inserted, so the choice counts as the newest one kept.
      delete next[groupKey];
      next[groupKey] = true;
      setGroupExpansion(next);
      saveGroupExpansion(next);
    }
    handleSelectSessionFromList(forked, undefined, undefined, { keepSidebarOpen: fromRowKey !== null });
    // The route invalidated the list: the next load has the copy.
    void loadSessions();
    const fromRow = fromRowKey ? `[data-row-key="${CSS.escape(fromRowKey)}"]` : null;
    treeRevealIdRef.current += 1;
    setTreeReveal({
      id: treeRevealIdRef.current,
      at: Date.now(),
      rowKey: `session:group:${forked.id}`,
      takeFocusFrom: (active) => (fromRow !== null && active.closest(fromRow) !== null) || active === archiveCloseFocusRef.current,
    });
  };
  const openForkedRef = useRef(openForked);
  openForkedRef.current = openForked;

  // One fork per session at a time: F again on a session whose fork is under
  // way does nothing; another session's Fork goes ahead.
  const forkingIdsRef = useRef(new Set<string>());
  const forkFamily = useCallback(async (row: SessionRow) => {
    const source = row.family.root;
    if (source.transient || forkingIdsRef.current.has(source.id)) return;
    forkingIdsRef.current.add(source.id);
    const selectedAtClick = selectedSessionIdRef.current;
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(source.id)}/fork`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = await res.json().catch(() => ({})) as { session?: SessionInfo; code?: string; error?: string };
      if (!res.ok || !data.session) {
        const { key, params } = forkFailureMessage(data.code, data.error ?? `HTTP ${res.status}`);
        showToast(t(key, params));
        // Deleted elsewhere (the pi CLI, another window): its row goes.
        if (data.code === "not_found") void loadSessions();
        return;
      }
      const forked = data.session;
      // The copy's name ends in the suffix that tells it from its source: the
      // toast's ellipsis cuts the name before it, never the suffix. A copy
      // left unnamed (its source had no title) is cut as other toasts are.
      const title = sessionRowTitle(forked);
      const { head: message, tail } = splitBeforeForkSuffix(t("sidebar.forkedToast", { title }), title)
        ?? { head: t("sidebar.forkedToast", { title: shortTitle(title, TOAST_TITLE_MAX) }), tail: undefined };
      if (selectedSessionIdRef.current !== selectedAtClick) {
        // Another session was opened meanwhile: the user stays there. The
        // copy waits in its group, unread (so it shows beyond the group's
        // limit), and the toast offers to open it.
        setAllSessions((current) => (current.some((session) => session.id === forked.id) ? current : [forked, ...current]));
        setUnreadSessionIds((prev) => new Set(prev).add(forked.id));
        void loadSessions();
        showToast(message, [{ id: "open", label: t("sidebar.open"), onClick: () => openForkedRef.current(forked, null) }], tail);
        return;
      }
      openForkedRef.current(forked, row.key);
      showToast(message, [], tail);
    } catch (error) {
      showToast(t("sidebar.forkFailed", { error: error instanceof Error ? error.message : String(error) }));
    } finally {
      forkingIdsRef.current.delete(source.id);
    }
  }, [loadSessions, showToast, t]);

  const runSessionAction = (id: SessionMenuActionId, row: SessionRow, shiftKey: boolean) => {
    const { family } = row;
    switch (id) {
      case "pin": setFamilyPinned(family, true); break;
      case "unpin": setFamilyPinned(family, false); break;
      case "rename": startRename(family); break;
      case "fork": void forkFamily(row); break;
      case "mark-read": markFamilyRead(family, true); break;
      case "mark-unread": markFamilyRead(family, false); break;
      case "archive": archiveFamily(family); break;
      case "unarchive": restoreFamily(family); break;
      case "delete": requestDelete(family, shiftKey); break;
    }
  };

  const openRowMenu = useCallback((row: SessionRow, anchor: SidebarMenuAnchor, opener: HTMLElement | null) => {
    if (row.status.transient) return;
    setMenu({ kind: "row", row, anchor, opener });
  }, []);

  // Right-click: an extension listening for the downstream event (a pi-web
  // integration) claims the row first; only an unclaimed event opens the
  // built-in menu. A transient row has nothing to offer, so the browser's own
  // menu stays.
  const handleContextMenu = useCallback((row: SessionRow, event: ReactMouseEvent) => {
    const session = row.family.root;
    if (session.id === renamingRootId || session.id === confirmDeleteRootId) return;
    if (dispatchSessionRowContextMenu({
      id: session.id,
      path: session.path,
      cwd: session.cwd,
      name: session.name,
      clientX: event.clientX,
      clientY: event.clientY,
      refresh: () => { void loadSessions(); },
    })) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (session.transient) return;
    event.preventDefault();
    const rowElement = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    // The keyboard's context-menu key reports no pointer position.
    const anchor: SidebarMenuAnchor = event.clientX === 0 && event.clientY === 0 && rowElement
      ? buttonAnchor(rowElement, "start")
      : { kind: "point", x: event.clientX, y: event.clientY };
    // Focus goes back into the row it came from (the keyboard case). An
    // element elsewhere (the composer) is not made the menu's opener, whose
    // next click the menu would take as "close"; it gets focus back after.
    const active = document.activeElement;
    const inRow = active instanceof HTMLElement && rowElement !== null && rowElement.contains(active);
    contextMenuFocusRef.current = !inRow && active instanceof HTMLElement && active !== document.body ? active : null;
    openRowMenu(row, anchor, inRow ? active : null);
  }, [confirmDeleteRootId, loadSessions, openRowMenu, renamingRootId]);

  const treeSelectionInput = useMemo(() => ({
    sessions: allSessions,
    uiState,
    runningIds: runningSessionIds,
    unreadIds: unreadSessionIds,
    selectedSessionId,
  }), [allSessions, uiState, runningSessionIds, unreadSessionIds, selectedSessionId]);

  const handleGroupMenu = useCallback((project: SidebarProject, opener: HTMLElement) => {
    const olderCount = familiesToArchive(treeSelectionInput, project.key, ARCHIVE_OLDER_THAN_MS, Date.now()).length;
    setMenu({ kind: "group", project, olderCount, anchor: buttonAnchor(opener, "end"), opener });
  }, [treeSelectionInput]);

  const archiveOlderSessions = useCallback((project: SidebarProject) => {
    const ids = familiesToArchive(treeSelectionInput, project.key, ARCHIVE_OLDER_THAN_MS, Date.now());
    archiveFamilies(ids.flatMap((id) => {
      const family = familyByRootId.get(id);
      return family ? [family] : [];
    }));
  }, [archiveFamilies, familyByRootId, treeSelectionInput]);

  // A group's "+": a new session at once. The current project starts in the
  // sidebar's worktree, another one in its root (the main checkout); the bar
  // above the fresh composer picks another worktree. The group's own key and
  // root go along, so a worktree is never taken for another project, and a
  // pinned project without sessions keeps its server identity.
  const handleGroupNew = useCallback((project: SidebarProject) => {
    setMenu(null);
    startNewSessionIn({
      cwd: project.current && selectedCwd ? selectedCwd : project.root,
      projectKey: project.key,
      projectRoot: project.root,
    });
  }, [selectedCwd, startNewSessionIn]);

  const closeMenu = useCallback(() => setMenu(null), []);

  // After a right-click menu, focus returns to where it was unless the chosen
  // action put it somewhere (a rename field, a delete confirmation).
  useEffect(() => {
    if (menu !== null) return;
    const previous = contextMenuFocusRef.current;
    contextMenuFocusRef.current = null;
    if (!previous?.isConnected) return;
    const active = document.activeElement;
    if (!active || active === document.body) previous.focus({ preventScroll: true });
  }, [menu]);

  // A row whose menu is open can leave the tree (archived or deleted in
  // another window): its menu goes with it.
  const visibleRows = archiveView ? archiveRows : model.rows;
  useEffect(() => {
    if (menu?.kind !== "row") return;
    if (!visibleRows.some((row) => row.key === menu.row.key)) setMenu(null);
  }, [menu, visibleRows]);

  // Rows are rebuilt on every refresh; the menu acts on the current one.
  const menuRow = menu?.kind === "row"
    ? (visibleRows.find((row): row is SessionRow => row.kind === "session" && row.key === menu.row.key) ?? menu.row)
    : null;

  const handleSelectFamily = useCallback((family: SessionFamily) => {
    handleSelectSessionFromList(family.root);
  }, [handleSelectSessionFromList]);

  // Every group at once: a group's menu, or Alt+click on its header.
  // Re-inserted, so the choices count as the newest ones kept.
  const setAllGroupsExpanded = useCallback((expanded: (project: SidebarProject) => boolean) => {
    const next = { ...groupExpansion };
    for (const project of model.projects) {
      delete next[project.key];
      next[project.key] = expanded(project);
    }
    setGroupExpansion(next);
    saveGroupExpansion(next);
  }, [groupExpansion, model.projects]);

  // Expanding or collapsing a group only changes the view: it never moves the
  // cwd (picking a project does that, in the files tab). With Alt, every
  // group follows the one clicked, as in a Finder outline.
  const handleToggleGroup = useCallback((projectKey: string, all: boolean) => {
    const project = projectByKey.get(projectKey);
    if (!project) return;
    const expanded = !isGroupExpanded(project, groupExpansion);
    if (all) {
      setAllGroupsExpanded(() => expanded);
      return;
    }
    const next = { ...groupExpansion };
    // Re-inserted, so the choice counts as the newest one kept.
    delete next[projectKey];
    next[projectKey] = expanded;
    setGroupExpansion(next);
    saveGroupExpansion(next);
  }, [groupExpansion, projectByKey, setAllGroupsExpanded]);

  const handleShowMore = useCallback((key: string) => {
    setMoreShown((prev) => showMoreFamilies(prev, key));
  }, []);
  const handleShowLess = useCallback((key: string) => {
    setMoreShown((prev) => showLessFamilies(prev, key));
  }, []);

  const handleTogglePinned = () => {
    const next = !pinnedCollapsed;
    setPinnedCollapsed(next);
    savePinnedCollapsed(next);
  };

  // "Open in Files" of another project is a deliberate project switch, the
  // same as choosing it in the files tab's project list.
  const openProjectInFiles = (project: SidebarProject) => {
    if (!project.current) setSelectedCwd(project.root);
    filesTabFocusRef.current = "project-button";
    switchTab("files");
  };

  const handleOpenOtherProject = () => {
    filesTabFocusRef.current = "project-list";
    switchTab("files");
  };
  // Once the files tab shows, the project button takes the focus, or its
  // menu opens below it (the menu takes the focus: its filter or first project).
  useEffect(() => {
    const target = filesTabFocusRef.current;
    if (!target || sidebarTab !== "files") return;
    filesTabFocusRef.current = null;
    if (target === "project-list") filesPickerRef.current?.openMenu("project");
    else filesPickerRef.current?.button("project")?.focus({ preventScroll: true });
  }, [sidebarTab]);

  const sessionMenuItems = (row: SessionRow): SidebarMenuItem[] => sessionMenuEntries(row.context, row.status).map((entry, index) => {
    if (entry.kind === "separator") return { type: "separator", id: `separator-${index}` };
    const label = t(SESSION_ACTION_LABEL_KEYS[entry.id]);
    return {
      type: "item",
      id: entry.id,
      label: entry.id === "delete" ? `${label}…` : label,
      icon: sessionActionIcon(entry.id),
      shortcut: entry.shortcut,
      danger: entry.id === "delete",
      disabled: entry.disabledReason !== undefined,
      disabledReason: entry.disabledReason === "running" ? t("sidebar.cannotArchiveRunning") : undefined,
      onSelect: ({ shiftKey }) => runSessionAction(entry.id, row, shiftKey),
    };
  });

  const groupMenuItems = (project: SidebarProject, olderCount: number): SidebarMenuItem[] => {
    const archivedCount = archiveIndex.countByProject.get(project.key) ?? 0;
    // Within the project's band; disabled at its edges.
    const up = adjacentProjectMove(model.projects, project.key, "up");
    const down = adjacentProjectMove(model.projects, project.key, "down");
    return [
      {
        type: "item",
        id: "pin-project",
        label: t(project.pinned ? "sidebar.unpinProject" : "sidebar.pinProject"),
        icon: project.pinned ? <PinOffIcon /> : <PinIcon />,
        onSelect: () => { void applyUiState({ action: "pin-project", projectKey: project.key, root: project.root, pinned: !project.pinned }); },
      },
      {
        type: "item",
        id: "move-up",
        label: t("sidebar.moveProjectUp"),
        icon: <ChevronIcon className="sidebar-icon-up" />,
        disabled: up === null,
        onSelect: () => { if (up) moveProject(project.key, up.anchorKey, up.position); },
      },
      {
        type: "item",
        id: "move-down",
        label: t("sidebar.moveProjectDown"),
        icon: <ChevronIcon className="sidebar-icon-down" />,
        disabled: down === null,
        onSelect: () => { if (down) moveProject(project.key, down.anchorKey, down.position); },
      },
      {
        type: "item",
        id: "archive-older",
        label: t("sidebar.archiveOlderThanWeek", { count: olderCount }),
        icon: <ArchiveIcon />,
        disabled: olderCount === 0,
        onSelect: () => archiveOlderSessions(project),
      },
      {
        type: "item",
        id: "open-in-files",
        label: t("sidebar.openInFilesTab"),
        icon: <FolderIcon />,
        onSelect: () => openProjectInFiles(project),
      },
      { type: "separator", id: "separator-groups" },
      {
        // This project open, every other one closed.
        type: "item",
        id: "collapse-others",
        label: t("sidebar.collapseOtherGroups"),
        icon: <ChevronIcon />,
        disabled: model.projects.every((other) => isGroupExpanded(other, groupExpansion) === (other.key === project.key)),
        onSelect: () => setAllGroupsExpanded((other) => other.key === project.key),
      },
      {
        type: "item",
        id: "expand-all",
        label: t("sidebar.expandAllGroups"),
        icon: <ChevronIcon className="sidebar-icon-down" />,
        disabled: model.projects.every((other) => isGroupExpanded(other, groupExpansion)),
        onSelect: () => setAllGroupsExpanded(() => true),
      },
      { type: "separator", id: "separator" },
      {
        type: "item",
        id: "view-archived",
        label: t("sidebar.viewArchived", { count: archivedCount }),
        icon: <ArchiveIcon />,
        disabled: archivedCount === 0,
        onSelect: openArchiveView,
      },
    ];
  };

  let menuTitle: string | undefined;
  let menuLabel = "";
  // Room for "Archive sessions older than 7 days · N".
  let menuWidth: number | undefined;
  let menuItems: SidebarMenuItem[] | undefined;
  if (menu?.kind === "row" && menuRow) {
    menuTitle = sessionRowTitle(menuRow.family.root);
    menuLabel = t("sidebar.sessionActions");
    menuItems = sessionMenuItems(menuRow);
  } else if (menu?.kind === "group") {
    menuTitle = menu.project.name;
    menuLabel = t("sidebar.projectActions", { name: menu.project.name });
    // The project as the tree has it now: pinned, unpinned or moved in another window while the menu is open.
    menuItems = groupMenuItems(projectByKey.get(menu.project.key) ?? menu.project, menu.olderCount);
    menuWidth = 264;
  }

  // The tree row (and the button in it) that the open menu belongs to.
  const activeMenuRowKey = menu?.kind === "row"
    ? menu.row.key
    : menu?.kind === "group" ? `group:${menu.project.key}` : null;

  const treeLayout = isMobile ? "mobile" : "desktop";
  // Until pins and archive have loaded, archived rows would flash in.
  const treeLoading = loading || !uiStateLoaded;
  const treeProps = {
    layout: treeLayout,
    loading: treeLoading,
    error,
    renamingRootId,
    confirmDeleteRootId,
    activeMenuRowKey,
    onSelectFamily: handleSelectFamily,
    onToggleGroup: handleToggleGroup,
    onShowMore: handleShowMore,
    onShowLess: handleShowLess,
    onTogglePinned: handleTogglePinned,
    onArchiveFamily: archiveFamily,
    onRestoreFamily: restoreFamily,
    onOpenRowMenu: openRowMenu,
    onRowContextMenu: handleContextMenu,
    onRenameCommit: (family: SessionFamily, value: string) => { void commitRename(family, value); },
    onRenameCancel: () => setRenamingRootId(null),
    onDeleteConfirm: (family: SessionFamily) => { void performDelete(family); },
    onDeleteCancel: () => {
      const rootId = confirmDeleteRootId;
      setConfirmDeleteRootId(null);
      // Cancel goes with the confirmation: the row's own button takes focus.
      if (rootId) focusAfterCommit(() => familyRowButton(rootId));
    },
    onGroupNew: handleGroupNew,
    onGroupMenu: handleGroupMenu,
    onOpenOtherProject: handleOpenOtherProject,
    onOpenArchive: openArchiveView,
    // The archive view has no group rows: only the main tree's can be dragged.
    onMoveGroup: moveProject,
  } as const;

  const explorerCwd = selectedCwd ?? selectedCwdProp ?? null;
  // The toolbar row's search button searches the files on the files tab:
  // the head has no search of its own.
  const searchesFiles = sidebarTab === "files" && explorerCwd !== null;
  // What the toolbar row's widths depend on (the chosen tab's label is bolder).
  useHeaderFit(headerRef, [t("sidebar.tabSessions"), t("sidebar.tabFiles"), t("sidebar.new"), explorerCwd && changesCount > 0 ? changesCount : "", sidebarTab].join("\n"));
  const archivedCount = model.archivedCount;

  return (
    <div className={`session-sidebar${toast ? " has-toast" : ""}`}>
      {customPathOpen && (
        <DirectoryPicker
          initialPath={customPathValue}
          busy={customPathValidating}
          error={customPathError}
          onCancel={() => {
            // The composer's "Open another project…" puts focus back on its
            // control: the picker took it and leaves nothing behind.
            const opener = customPathOpen === "new-session" ? folderReturnFocusRef.current : null;
            folderPickRef.current = null;
            folderReturnFocusRef.current = null;
            setCustomPathOpen(false);
            setCustomPathError(null);
            if (opener) focusAfterCommit(() => (opener.isConnected ? opener : null));
          }}
          onSelect={(path) => void commitCustomPath(path)}
        />
      )}
      {/* One toolbar row, in the cells of the chat's top bar beside it (its
          line continues that bar's): Sessions | Files, then New and the
          search of the tab in view. Only the two tabs are the tablist. */}
      <div ref={headerRef} className="sidebar-header">
        <div className="sidebar-tabs-list" role="tablist" aria-label={t("sidebar.tabsLabel")}>
          <button
            ref={sessionsTabRef}
            type="button"
            role="tab"
            id="session-sidebar-tab-sessions"
            aria-selected={sidebarTab === "sessions"}
            aria-controls="session-sidebar-panel-sessions"
            tabIndex={sidebarTab === "sessions" ? 0 : -1}
            className={`sidebar-tab${sidebarTab === "sessions" ? " is-selected" : ""}`}
            onClick={() => switchTab("sessions")}
            onKeyDown={handleTabKeyDown}
          >
            <MessageIcon size={13} className="sidebar-tab-icon" />
            <span className="sidebar-tab-label">{t("sidebar.tabSessions")}</span>
          </button>
          <button
            ref={filesTabRef}
            type="button"
            role="tab"
            id="session-sidebar-tab-files"
            aria-selected={sidebarTab === "files"}
            aria-controls="session-sidebar-panel-files"
            tabIndex={sidebarTab === "files" ? 0 : -1}
            title={explorerCwd && changesCount > 0 ? t("sidebar.changedFiles", { count: changesCount }) : undefined}
            className={`sidebar-tab${sidebarTab === "files" ? " is-selected" : ""}`}
            onClick={() => switchTab("files")}
            onKeyDown={handleTabKeyDown}
          >
            <FolderIcon size={13} className="sidebar-tab-icon" />
            <span className="sidebar-tab-label">{t("sidebar.tabFiles")}</span>
            {explorerCwd && changesCount > 0 && <span className="sidebar-tab-count" aria-hidden="true">{changesCount}</span>}
          </button>
        </div>
        <span className="sidebar-header-spacer" />
        <button
          type="button"
          className="sidebar-new-button"
          onClick={handleNewSession}
          disabled={!selectedCwd}
          title={selectedCwd ? t("sidebar.newSessionTitle", { path: selectedCwd }) : t("sidebar.selectProject")}
        >
          <PlusIcon size={12} />
          <span className="sidebar-new-label">{t("sidebar.new")}</span>
        </button>
        <button
          type="button"
          onClick={() => {
            // The search of the tab in view: the files tab's searches its
            // files; without a folder there, it opens the sessions tab's.
            if (searchesFiles) {
              setFileSearchOpen((open) => !open);
              return;
            }
            if (sidebarTab !== "sessions") {
              switchTab("sessions");
              setSessionSearchOpen(true);
              return;
            }
            setSessionSearchOpen((open) => !open);
          }}
          title={searchesFiles ? t("sidebar.searchFiles") : t("sidebar.toggleSessionSearch")}
          aria-label={searchesFiles ? t("sidebar.searchFiles") : t("sidebar.toggleSessionSearch")}
          aria-expanded={searchesFiles ? fileSearchOpen : sessionSearchOpen}
          aria-controls={searchesFiles ? "file-search-input" : "session-search-input"}
          className={`sidebar-search-toggle${(searchesFiles ? fileSearchOpen : sessionSearchOpen) ? " is-active" : ""}`}
        >
          <SearchIcon size={16} />
        </button>
      </div>

      {/* Sessions tab: every project's sessions, or the archive */}
      <div
        ref={sessionsPanelRef}
        id="session-sidebar-panel-sessions"
        role="tabpanel"
        aria-labelledby="session-sidebar-tab-sessions"
        hidden={sidebarTab !== "sessions"}
        className="sidebar-panel"
        onScrollCapture={rememberScroll}
      >
        {sessionSearchOpen && (
          <div className="sidebar-search">
            <input
              id="session-search-input"
              type="search"
              autoFocus
              value={sessionSearchQuery}
              maxLength={200}
              aria-label={t("sidebar.searchSessions")}
              placeholder={t("sidebar.searchSessions")}
              onChange={(event) => setSessionSearchQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape" && !event.nativeEvent.isComposing && event.keyCode !== 229) {
                  event.stopPropagation();
                  setSessionSearchQuery("");
                }
              }}
              className="sidebar-search-input"
            />
          </div>
        )}
        <SessionSearch
          open={sessionSearchOpen}
          query={sessionSearchQuery}
          selectedSessionId={selectedSessionId}
          onSelectSession={handleSelectSessionFromList}
          archivedSessionIds={archiveIndex.ids}
        >
          {/* Kept mounted under the archive view, so going back finds it as it was. */}
          <div className="sidebar-sessions-view" hidden={archiveView}>
            <SessionTree
              {...treeProps}
              rows={model.rows}
              emptyLabel={t("sidebar.noSessions")}
              reveal={treeReveal}
              onRevealHandled={handleRevealHandled}
            />
          </div>
          {archiveView && (
            <div className="sidebar-sessions-view">
              <div className="sidebar-archive-bar">
                <button
                  ref={archiveBackRef}
                  type="button"
                  className="sidebar-archive-back"
                  title={t("sidebar.backToSessions")}
                  aria-label={`${t("sidebar.backToSessions")}: ${t("sidebar.archivedCount", { count: archivedCount })}`}
                  onClick={() => setArchiveView(false)}
                >
                  <ChevronIcon size={13} className="sidebar-icon-back" />
                  <span>{t("sidebar.archived")}</span>
                  <span className="sidebar-archive-count">· {archivedCount}</span>
                </button>
              </div>
              <SessionTree {...treeProps} rows={archiveRows} emptyLabel={t("sidebar.noArchived")} />
            </div>
          )}
        </SessionSearch>
      </div>

      {/* Files tab: the project and worktree in use, and its files */}
      <div
        ref={filesPanelRef}
        id="session-sidebar-panel-files"
        role="tabpanel"
        aria-labelledby="session-sidebar-tab-files"
        hidden={sidebarTab !== "files"}
        className="sidebar-panel"
        onScrollCapture={rememberScroll}
      >
        {/* One head: the folder in use, then what is done with it. The
            buttons are the head's, not the picker's: its group names only
            the project and worktree. */}
        <div className="sidebar-files-head">
          {/* The project and worktree in use: the same picker as the bar above a
              fresh composer, as two boxes. Its worktree box shows only at the
              top of a git checkout (repo subdirs keep their own project
              identity, so switching from them would jump projects); a disabled
              box says why elsewhere. The list comes from the loaded project
              (not just its forCwd), so switching between worktrees of one
              project keeps the box instead of flickering while it refetches. */}
          <ProjectWorktreePicker
            handleRef={filesPickerRef}
            layout="stacked"
            context={newSessionContext ?? { project: null, worktrees: null, currentWorktreePath: null, projects: projectChoiceList }}
            mobile={isMobile}
            label={t("sidebar.projectAndWorktree")}
            placeholder={initialSessionId && !restoredRef.current ? "" : t("sidebar.selectProject")}
            homeDir={homeDir}
            projectActivity={projectActivity}
            worktreeHint={inactiveWorktreeSelector}
            newWorktreeTitle={t("sidebar.createWorktreeTitle")}
            onPick={handleFilesPick}
            onUseDefaultDirectory={() => { void handleDefaultCwd(); }}
            onOpenFolder={handleCustomPathClick}
            onRefreshWorktrees={refreshWorktrees}
            onCreateWorktree={createWorktree}
            onRemoveWorktree={handleRemoveWorktree}
          />
          {/* Always the same buttons in the same places: the changes view
              stays (disabled) while there is nothing changed, so nothing
              moves as an agent edits files and commits. The folder's
              actions first, the tree's changes view last; its search is the
              header's search button. */}
          {explorerCwd && (
            <div className="sidebar-files-actions" role="group" aria-label={t("sidebar.fileActions")}>
              {onOpenTerminal && (
                <ToolbarIconButton
                  onClick={() => onOpenTerminal(explorerCwd)}
                  title={t("terminal.open")}
                >
                  <TerminalIcon size={14} />
                </ToolbarIconButton>
              )}
              <ToolbarIconButton
                onClick={() => { void openInFileManager(); }}
                disabled={fileManagerUnavailable}
                title={fileManagerUnavailable
                  ? t(fileManager?.reason === "remote" ? "sidebar.openInExplorerRemoteOnly" : "sidebar.openInExplorerUnsupported")
                  : fileManagerLabel}
              >
                <FolderIcon size={14} />
              </ToolbarIconButton>
              <ToolbarIconButton
                onClick={() => fileExplorerRef.current?.openUploadPicker()}
                disabled={explorerUploadBusy}
                title={t("sidebar.uploadFilesTitle")}
              >
                <UploadIcon size={14} />
              </ToolbarIconButton>
              <ToolbarIconButton
                onClick={() => {
                  if (onExplorerRefresh) onExplorerRefresh();
                  else setExplorerKey((k) => k + 1);
                  setExplorerRefreshDone(true);
                  if (explorerRefreshTimerRef.current) clearTimeout(explorerRefreshTimerRef.current);
                  explorerRefreshTimerRef.current = setTimeout(() => setExplorerRefreshDone(false), 2000);
                }}
                title={t("sidebar.refreshExplorer")}
                done={explorerRefreshDone}
              >
                {explorerRefreshDone ? <CheckIcon size={14} /> : <RefreshIcon size={14} />}
              </ToolbarIconButton>
              <ToolbarIconButton
                onClick={() => setChangesCollapsed((v) => !v)}
                disabled={changesCount === 0}
                title={t("sidebar.changedFiles", { count: changesCount })}
                pressed={changesCount > 0 && !changesCollapsed}
              >
                <ChangesIcon size={14} />
              </ToolbarIconButton>
            </div>
          )}
        </div>

        {explorerCwd && fileManagerErrorMessage && (
          <div role="alert" className="sidebar-files-error">
            <span className="sidebar-files-error-text">{fileManagerErrorMessage}</span>
            <DismissButton onClick={() => setFileManagerError(null)} title={t("files.dismissError")} />
          </div>
        )}
        {/* Mounted whenever there is a cwd, also while the tab is hidden, so the
            expanded tree, a search and an upload in progress survive a switch. */}
        <div ref={explorerScrollRef} className="sidebar-files-scroll scrollbar-subtle">
          {explorerCwd && (
            <FileExplorer
              ref={fileExplorerRef}
              cwd={explorerCwd}
              onOpenFile={onOpenFile ?? (() => {})}
              refreshKey={explorerKey}
              onAtMention={onAtMention}
              onAtMentions={onAtMentions}
              onUploadBusyChange={setExplorerUploadBusy}
              changesCollapsed={changesCollapsed}
              onChangesCountChange={setChangesCount}
              fileSearchOpen={fileSearchOpen}
              onFileSearchOpenChange={setFileSearchOpen}
            />
          )}
        </div>
      </div>

      <SidebarMenu
        open={menu !== null}
        anchor={menu?.anchor ?? null}
        sheet={isMobile}
        ariaLabel={menuLabel}
        title={menuTitle}
        items={menuItems}
        cancelLabel={t("sidebar.cancel")}
        onClose={closeMenu}
        returnFocusTo={menu?.opener ?? null}
        width={menuWidth}
      />
      <SidebarToast toast={toast} onDismiss={() => setToast(null)} dismissLabel={t("sidebar.dismiss")} />
    </div>
  );
}
