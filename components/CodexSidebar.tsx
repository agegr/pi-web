"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Archive, ArrowDown, ArrowUp, ChevronRight, Ellipsis, Folder, FolderPlus, LoaderCircle, MessageSquare, PanelLeft, Pencil, Pin, PinOff, Plus, RefreshCw, Search, Trash2, X } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import { formatRelativeTime } from "@/lib/i18n/format";
import { readArchivedSessionIds, writeArchivedSessionIds } from "@/lib/archived-sessions";
import { filterProjectSessions, matchesSidebarQuery, sidebarProjectName, sidebarSessionTitle } from "@/lib/codex-sidebar-search";
import type { ProjectPreference } from "@/lib/project-registry";
import { buildRecentSessions } from "@/lib/recent-sessions";
import { dispatchSessionRowContextMenu } from "@/lib/session-row-context-menu";
import { activeSessionRoots } from "@/lib/session-relations";
import type { SessionInfo } from "@/lib/types";
import { DirectoryPicker } from "./DirectoryPicker";
import { DialogShell } from "./DialogShell";

interface Props {
  selectedSessionId: string | null;
  onSelectSession: (session: SessionInfo, isRestore?: boolean) => void;
  onNewSession?: (sessionId: string, cwd: string) => void;
  initialSessionId?: string | null;
  skipInitialProjectSelection?: boolean;
  onInitialRestoreDone?: () => void;
  refreshKey?: number;
  onSessionDeleted?: (sessionId: string) => void;
  selectedCwd?: string | null;
  onCwdChange?: (cwd: string | null, projectRoot?: string | null) => void;
  onBackgroundTaskDone?: () => void;
  onRunningSessionIdsChange?: (ids: Set<string>) => void;
  onToggleSidebar?: () => void;
}

interface ProjectView extends ProjectPreference {
  sessions: SessionInfo[];
  latestModified: string;
}

interface WorktreeEntry {
  path: string;
  branch: string | null;
  isMain: boolean;
}

type QuickResult =
  | { type: "project"; project: ProjectView }
  | { type: "session"; session: SessionInfo; project: ProjectView };

const COLLAPSED_STORAGE_KEY = "pi-web:collapsed-projects";
const UNREAD_STORAGE_KEY = "pi-web:unread-session-ids";

function readStringSet(key: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "[]") as unknown;
    return Array.isArray(value)
      ? new Set(value.filter((item): item is string => typeof item === "string"))
      : new Set();
  } catch {
    return new Set();
  }
}

function writeStringSet(key: string, values: Set<string>): void {
  try {
    if (values.size) localStorage.setItem(key, JSON.stringify([...values]));
    else localStorage.removeItem(key);
  } catch {
    // Browser storage is best-effort.
  }
}

function projectName(path: string): string {
  return sidebarProjectName(path);
}

function sessionTitle(session: SessionInfo): string {
  return sidebarSessionTitle(session);
}

function newDraftId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

const IconButton = forwardRef<HTMLButtonElement, {
  label: string;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  children: ReactNode;
  disabled?: boolean;
}>(function IconButton({ label, onClick, children, disabled }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      className="codex-sidebar-icon-button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
});

function Chevron({ open }: { open: boolean }) {
  return <ChevronRight className="codex-sidebar-chevron" data-open={open} size={14} strokeWidth={2} aria-hidden="true" />;
}

function FolderIcon() {
  return <Folder size={15} strokeWidth={1.8} aria-hidden="true" />;
}

export function CodexSidebar({
  selectedSessionId,
  onSelectSession,
  onNewSession,
  initialSessionId,
  skipInitialProjectSelection,
  onInitialRestoreDone,
  refreshKey,
  onSessionDeleted,
  selectedCwd: selectedCwdProp,
  onCwdChange,
  onBackgroundTaskDone,
  onRunningSessionIdsChange,
  onToggleSidebar,
}: Props) {
  const { t, locale } = useI18n();
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [preferences, setPreferences] = useState<ProjectPreference[]>([]);
  const [selectedCwd, setSelectedCwd] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [projectSearchOpen, setProjectSearchOpen] = useState(false);
  const [quickQuery, setQuickQuery] = useState("");
  const [quickActiveIndex, setQuickActiveIndex] = useState(0);
  const [directoryPickerOpen, setDirectoryPickerOpen] = useState(false);
  const [directoryError, setDirectoryError] = useState<string | null>(null);
  const [directoryBusy, setDirectoryBusy] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => readStringSet(COLLAPSED_STORAGE_KEY));
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set());
  const [unreadIds, setUnreadIds] = useState<Set<string>>(() => readStringSet(UNREAD_STORAGE_KEY));
  const [archivedIds, setArchivedIds] = useState<Set<string>>(() => readArchivedSessionIds());
  const [menuProject, setMenuProject] = useState<{ path: string; left: number; top: number } | null>(null);
  const [renamingProject, setRenamingProject] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [draggedProject, setDraggedProject] = useState<string | null>(null);
  const [worktrees, setWorktrees] = useState<WorktreeEntry[]>([]);
  const [worktreeProjectRoot, setWorktreeProjectRoot] = useState<string | null>(null);
  const [worktreeOpen, setWorktreeOpen] = useState(false);
  const [recentOpen, setRecentOpen] = useState(true);
  const [worktreeBusy, setWorktreeBusy] = useState(false);
  const [worktreeError, setWorktreeError] = useState<string | null>(null);
  const [pendingConfirmation, setPendingConfirmation] = useState<{ type: "worktree"; path: string } | null>(null);
  const [newBranch, setNewBranch] = useState("");
  const previousRunningRef = useRef<Set<string> | null>(null);
  const previousRawRunningRef = useRef<Set<string> | null>(null);
  const restoredRef = useRef(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const quickDialogRef = useRef<HTMLDialogElement>(null);
  const projectSearchInputRef = useRef<HTMLInputElement>(null);
  const quickInputRef = useRef<HTMLInputElement>(null);
  const quickPreviousFocusRef = useRef<HTMLElement | null>(null);
  const loadDataInFlightRef = useRef<Promise<void> | null>(null);
  const loadDataQueuedRef = useRef(false);
  const loadDataForceQueuedRef = useRef(false);

  const fetchData = useCallback(async (force: boolean) => {
    const [sessionsResponse, projectsResponse] = await Promise.all([
      fetch(force ? "/api/sessions?force=1" : "/api/sessions", { cache: "no-store" }),
      fetch("/api/projects", { cache: "no-store" }),
    ]);
    if (!sessionsResponse.ok || !projectsResponse.ok) {
      throw new Error(`HTTP ${sessionsResponse.status}/${projectsResponse.status}`);
    }
    const sessionData = await sessionsResponse.json() as { sessions: SessionInfo[]; runningSessionIds?: string[] };
    const projectData = await projectsResponse.json() as { projects: ProjectPreference[] };
    setSessions(sessionData.sessions);
    setPreferences(projectData.projects);
    setRunningIds((current) => current.size ? current : new Set(sessionData.runningSessionIds ?? []));
    setError(null);
  }, []);

  const loadData = useCallback((force = false): Promise<void> => {
    if (loadDataInFlightRef.current) {
      loadDataQueuedRef.current = true;
      loadDataForceQueuedRef.current ||= force;
      return loadDataInFlightRef.current;
    }

    const run = async () => {
      let requestForce = force;
      try {
        do {
          loadDataQueuedRef.current = false;
          requestForce ||= loadDataForceQueuedRef.current;
          loadDataForceQueuedRef.current = false;
          await fetchData(requestForce);
          requestForce = false;
        } while (loadDataQueuedRef.current);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setLoading(false);
      }
    };

    const pending = run();
    loadDataInFlightRef.current = pending;
    void pending.finally(() => {
      if (loadDataInFlightRef.current === pending) loadDataInFlightRef.current = null;
    });
    return pending;
  }, [fetchData]);

  useEffect(() => { void loadData(false); }, [loadData, refreshKey]);
  useEffect(() => { writeStringSet(COLLAPSED_STORAGE_KEY, collapsed); }, [collapsed]);
  useEffect(() => { writeStringSet(UNREAD_STORAGE_KEY, unreadIds); }, [unreadIds]);
  useEffect(() => { writeArchivedSessionIds(archivedIds); }, [archivedIds]);
  useEffect(() => { setArchivedIds(readArchivedSessionIds()); }, [refreshKey]);

  const subagentsByRoot = useMemo(() => {
    const grouped = new Map<string, SessionInfo[]>();
    for (const session of sessions) {
      if (session.sessionRole !== "subagent" || !session.rootSessionId) continue;
      const group = grouped.get(session.rootSessionId) ?? [];
      group.push(session);
      grouped.set(session.rootSessionId, group);
    }
    return grouped;
  }, [sessions]);

  const visibleSessions = useMemo(() => sessions
    .filter((session) => session.sessionRole !== "subagent" && !archivedIds.has(session.id))
    .map((session) => {
      const latestSubagent = subagentsByRoot.get(session.id)
        ?.reduce((latest, child) => child.modified > latest ? child.modified : latest, session.modified);
      return latestSubagent && latestSubagent !== session.modified
        ? { ...session, modified: latestSubagent }
        : session;
    }), [archivedIds, sessions, subagentsByRoot]);

  const { roots: activeRootIds, unresolved: hasUnresolvedRunningIds } = useMemo(
    () => activeSessionRoots(sessions, runningIds, previousRunningRef.current ?? []),
    [runningIds, sessions],
  );

  const discovered = useMemo(() => {
    const byPath = new Map<string, SessionInfo[]>();
    for (const session of visibleSessions) {
      const path = session.projectRoot ?? session.cwd;
      const group = byPath.get(path) ?? [];
      group.push(session);
      byPath.set(path, group);
    }
    return byPath;
  }, [visibleSessions]);

  const projects = useMemo<ProjectView[]>(() => {
    const saved = new Map(preferences.map((project) => [project.path, project]));
    const paths = new Set([...discovered.keys(), ...preferences.map((project) => project.path)]);
    return [...paths].map((path, index) => {
      const projectSessions = [...(discovered.get(path) ?? [])].sort((a, b) => b.modified.localeCompare(a.modified));
      const preference = saved.get(path);
      return {
        path,
        name: preference?.name,
        pinned: preference?.pinned ?? false,
        archived: preference?.archived ?? false,
        removed: preference?.removed ?? false,
        order: preference?.order ?? preferences.length + index,
        sessions: projectSessions,
        latestModified: projectSessions[0]?.modified ?? "",
      };
    }).sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.order - b.order || b.latestModified.localeCompare(a.latestModified));
  }, [discovered, preferences]);

  const filterQuery = filter.trim().toLowerCase();
  const visibleProjects = projects.filter((project) => filterProjectSessions(project, filterQuery) !== null);

  const activeProjects = useMemo(
    () => projects.filter((project) => !project.removed && !project.archived),
    [projects],
  );
  const recentSessions = useMemo(
    () => buildRecentSessions(visibleSessions, activeProjects, archivedIds),
    [activeProjects, archivedIds, visibleSessions],
  );
  const quickSearch = quickQuery.trim().toLowerCase();
  const quickProjectResults = useMemo(() => activeProjects
    .filter((project) => !quickSearch || matchesSidebarQuery([project.name ?? projectName(project.path), project.path], quickSearch))
    .slice(0, 8), [activeProjects, quickSearch]);
  const quickSessionResults = useMemo(() => visibleSessions.filter((session) => {
    const project = activeProjects.find((candidate) => candidate.path === (session.projectRoot ?? session.cwd));
    return project && (!quickSearch || matchesSidebarQuery([
      sessionTitle(session),
      session.firstMessage,
    ], quickSearch));
  }).sort((a, b) => b.modified.localeCompare(a.modified)).slice(0, 12), [activeProjects, quickSearch, visibleSessions]);
  const quickResults = useMemo<QuickResult[]>(() => [
    ...quickProjectResults.map((project): QuickResult => ({ type: "project", project })),
    ...quickSessionResults.flatMap((session): QuickResult[] => {
      const project = activeProjects.find((candidate) => candidate.path === (session.projectRoot ?? session.cwd));
      return project ? [{ type: "session", session, project }] : [];
    }),
  ], [activeProjects, quickProjectResults, quickSessionResults]);

  const selectedSessionProject = sessions.find((session) => session.cwd === selectedCwd)?.projectRoot;
  const selectedProject = projects.find((project) => project.path === (
    selectedSessionProject
    ?? (worktrees.some((worktree) => worktree.path === selectedCwd) ? worktreeProjectRoot : null)
    ?? selectedCwd
  )) ?? null;

  const saveProjects = useCallback(async (next: ProjectPreference[], mutation: object) => {
    setPreferences(next);
    try {
      const response = await fetch("/api/projects", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mutation),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      void loadData();
    }
  }, [loadData]);

  const updateProject = useCallback((path: string, update: Partial<ProjectPreference>) => {
    const base = projects.map(({ sessions: _sessions, latestModified: _latestModified, ...project }) => project);
    const next = base.map((project) => project.path === path ? { ...project, ...update } : project);
    const serializedUpdate = Object.hasOwn(update, "name") && update.name === undefined
      ? { ...update, name: null }
      : update;
    void saveProjects(next, { path, update: serializedUpdate });
  }, [projects, saveProjects]);

  const addProject = useCallback(async (path: string) => {
    setDirectoryBusy(true);
    setDirectoryError(null);
    try {
      const response = await fetch("/api/cwd/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: path }),
      });
      const data = await response.json() as { cwd?: string; error?: string };
      if (!response.ok || !data.cwd) throw new Error(data.error ?? `HTTP ${response.status}`);
      const existing = projects.find((project) => project.path === data.cwd);
      if (existing) updateProject(data.cwd, { archived: false, removed: false });
      else {
        const project = { path: data.cwd, pinned: false, archived: false, removed: false, order: projects.length };
        await saveProjects([...preferences, project], { project });
      }
      setSelectedCwd(data.cwd);
      setCollapsed((current) => { const next = new Set(current); next.delete(data.cwd!); return next; });
      setDirectoryPickerOpen(false);
    } catch (cause) {
      setDirectoryError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setDirectoryBusy(false);
    }
  }, [preferences, projects, saveProjects, updateProject]);

  const createSession = useCallback((cwd: string) => {
    setSelectedCwd(cwd);
    onNewSession?.(newDraftId(), cwd);
  }, [onNewSession]);

  const createNewTask = useCallback(() => {
    const cwd = selectedCwd ?? activeProjects[0]?.path;
    if (cwd) createSession(cwd);
    else setDirectoryPickerOpen(true);
  }, [activeProjects, createSession, selectedCwd]);

  const selectSession = useCallback((session: SessionInfo) => {
    setSelectedCwd(session.cwd);
    onSelectSession(session);
  }, [onSelectSession]);

  const closeQuickSwitcher = useCallback(() => {
    quickDialogRef.current?.close();
  }, []);

  const openQuickSwitcher = useCallback((trigger?: HTMLElement | null) => {
    const dialog = quickDialogRef.current;
    if (!dialog || dialog.open) return;
    quickPreviousFocusRef.current = trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setQuickQuery("");
    setQuickActiveIndex(0);
    dialog.showModal();
    requestAnimationFrame(() => quickInputRef.current?.focus());
  }, []);

  const chooseQuickResult = useCallback((result: QuickResult) => {
    if (result.type === "session") selectSession(result.session);
    else {
      setSelectedCwd(result.project.path);
      setCollapsed((current) => {
        const next = new Set(current);
        next.delete(result.project.path);
        return next;
      });
    }
    closeQuickSwitcher();
  }, [closeQuickSwitcher, selectSession]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "k" && (event.metaKey || event.ctrlKey) && !event.altKey) {
        const target = event.target;
        if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable)) return;
        event.preventDefault();
        openQuickSwitcher();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [openQuickSwitcher]);

  useEffect(() => {
    setQuickActiveIndex((current) => Math.min(current, Math.max(0, quickResults.length - 1)));
  }, [quickResults.length]);

  useEffect(() => {
    quickDialogRef.current?.querySelector<HTMLElement>("[data-active='true']")?.scrollIntoView({ block: "nearest" });
  }, [quickActiveIndex]);

  useEffect(() => {
    const dialog = quickDialogRef.current;
    if (!dialog) return;
    const restoreFocus = () => {
      quickPreviousFocusRef.current?.focus();
      quickPreviousFocusRef.current = null;
    };
    dialog.addEventListener("close", restoreFocus);
    return () => dialog.removeEventListener("close", restoreFocus);
  }, []);

  useEffect(() => {
    if (selectedCwdProp) setSelectedCwd(selectedCwdProp);
  }, [selectedCwdProp]);

  useEffect(() => {
    const projectRoot = sessions.find((session) => session.cwd === selectedCwd)?.projectRoot ?? selectedCwd;
    onCwdChange?.(selectedCwd, projectRoot);
  }, [onCwdChange, selectedCwd, sessions]);

  useEffect(() => {
    if (loading || skipInitialProjectSelection || selectedCwd || projects.length === 0) return;
    if (initialSessionId && !restoredRef.current) {
      restoredRef.current = true;
      const target = sessions.find((session) => session.id === initialSessionId);
      if (target) {
        setSelectedCwd(target.cwd);
        onSelectSession(target, true);
        return;
      }
      onInitialRestoreDone?.();
    }
    const first = projects.find((project) => !project.removed && !project.archived);
    if (first) setSelectedCwd(first.path);
  }, [initialSessionId, loading, onInitialRestoreDone, onSelectSession, projects, selectedCwd, sessions, skipInitialProjectSelection]);

  useEffect(() => {
    const events = new EventSource("/api/agent/running/events");
    events.onmessage = (event) => {
      const data = JSON.parse(event.data) as { runningSessionIds?: string[] };
      setRunningIds(new Set(data.runningSessionIds ?? []));
    };
    return () => events.close();
  }, []);

  useEffect(() => {
    const previous = previousRunningRef.current;
    if (previous === null) {
      previousRunningRef.current = activeRootIds;
      onRunningSessionIdsChange?.(activeRootIds);
      return;
    }
    const completed = [...previous].filter((id) => !activeRootIds.has(id));
    const completedInBackground = completed.filter((id) => id !== selectedSessionId);
    if (completedInBackground.length) {
      setUnreadIds((current) => new Set([...current, ...completedInBackground]));
    }
    if (completed.length) {
      onBackgroundTaskDone?.();
      if (!onBackgroundTaskDone) void loadData(false);
    }
    previousRunningRef.current = activeRootIds;
    onRunningSessionIdsChange?.(activeRootIds);
  }, [activeRootIds, loadData, onBackgroundTaskDone, onRunningSessionIdsChange, runningIds, selectedSessionId]);

  useEffect(() => {
    const previous = previousRawRunningRef.current;
    if (previous === null) {
      previousRawRunningRef.current = runningIds;
      return;
    }
    const newlyRunning = [...runningIds].some((id) => !previous.has(id));
    if (hasUnresolvedRunningIds && newlyRunning) void loadData(false);
    previousRawRunningRef.current = runningIds;
  }, [hasUnresolvedRunningIds, loadData, runningIds]);

  useEffect(() => {
    if (!selectedSessionId) return;
    setUnreadIds((current) => {
      if (!current.has(selectedSessionId)) return current;
      const next = new Set(current); next.delete(selectedSessionId); return next;
    });
  }, [selectedSessionId]);

  useEffect(() => {
    if (!selectedProject) { setWorktrees([]); setWorktreeProjectRoot(null); return; }
    fetch(`/api/worktrees?cwd=${encodeURIComponent(selectedCwd ?? selectedProject.path)}`)
      .then((response) => response.json())
      .then((data: { projectRoot?: string; worktrees?: WorktreeEntry[] }) => {
        setWorktrees(data.worktrees ?? []);
        setWorktreeProjectRoot(data.projectRoot ?? selectedProject.path);
      })
      .catch(() => { setWorktrees([]); setWorktreeProjectRoot(null); });
  }, [selectedCwd, selectedProject]);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuProject(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const reorderProject = useCallback((targetPath: string) => {
    if (!draggedProject || draggedProject === targetPath) return;
    const ordered = projects.map(({ sessions: _sessions, latestModified: _latestModified, ...project }) => project);
    const from = ordered.findIndex((project) => project.path === draggedProject);
    const to = ordered.findIndex((project) => project.path === targetPath);
    if (from < 0 || to < 0 || ordered[from].pinned !== ordered[to].pinned) return;
    const [moved] = ordered.splice(from, 1);
    ordered.splice(to, 0, moved);
    const next = ordered.map((project, order) => ({ ...project, order }));
    void saveProjects(next, { order: next.map((project) => project.path) });
  }, [draggedProject, projects, saveProjects]);

  const moveProject = useCallback((path: string, direction: -1 | 1) => {
    const ordered = projects.map(({ sessions: _sessions, latestModified: _latestModified, ...project }) => project);
    const from = ordered.findIndex((project) => project.path === path);
    if (from < 0) return;
    const candidates = ordered
      .map((project, index) => ({ project, index }))
      .filter(({ project }) => project.pinned === ordered[from].pinned);
    const groupIndex = candidates.findIndex(({ index }) => index === from);
    const target = candidates[groupIndex + direction]?.index;
    if (target === undefined) return;
    const [moved] = ordered.splice(from, 1);
    ordered.splice(target, 0, moved);
    const next = ordered.map((project, order) => ({ ...project, order }));
    void saveProjects(next, { order: next.map((project) => project.path) });
  }, [projects, saveProjects]);

  const removeWorktree = useCallback(async (path: string, force = false) => {
    if (!selectedProject || worktreeBusy) return false;
    setWorktreeBusy(true);
    setWorktreeError(null);
    try {
      const response = await fetch("/api/worktrees", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: selectedProject.path, path, force }),
      });
      const data = await response.json() as { error?: string; dirty?: boolean };
      if (data.dirty && !force) {
        setPendingConfirmation({ type: "worktree", path });
        return false;
      }
      if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
      setWorktrees((current) => current.filter((worktree) => worktree.path !== path));
      if (selectedCwd === path) setSelectedCwd(selectedProject.path);
      return true;
    } catch (cause) {
      setWorktreeError(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      setWorktreeBusy(false);
    }
  }, [selectedCwd, selectedProject, t, worktreeBusy]);

  const createWorktree = useCallback(async () => {
    if (!selectedProject || !newBranch.trim() || worktreeBusy) return;
    setWorktreeBusy(true);
    setWorktreeError(null);
    try {
      const response = await fetch("/api/worktrees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: selectedProject.path, branch: newBranch.trim() }),
      });
      const data = await response.json() as { path?: string; error?: string };
      if (!response.ok || !data.path) throw new Error(data.error ?? `HTTP ${response.status}`);
      setWorktrees((current) => [...current, { path: data.path!, branch: newBranch.trim(), isMain: false }]);
      setSelectedCwd(data.path);
      setNewBranch("");
    } catch (cause) {
      setWorktreeError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setWorktreeBusy(false);
    }
  }, [newBranch, selectedProject, worktreeBusy]);

  useEffect(() => {
    if (projectSearchOpen) projectSearchInputRef.current?.focus();
  }, [projectSearchOpen]);

  const toggleProjectSearch = useCallback(() => {
    setProjectSearchOpen((open) => {
      if (open) setFilter("");
      return !open;
    });
  }, []);

  return (
    <div className="codex-sidebar">
      {directoryPickerOpen && (
        <DirectoryPicker
          busy={directoryBusy}
          error={directoryError}
          onCancel={() => { setDirectoryPickerOpen(false); setDirectoryError(null); }}
          onSelect={(path) => void addProject(path)}
        />
      )}

      <header className="codex-sidebar-brand-header">
        <div className="codex-sidebar-brand">Pi Web</div>
        <IconButton label={t("sidebar.refresh")} onClick={() => void loadData(true)}>
          <RefreshCw size={14} aria-hidden="true" />
        </IconButton>
      </header>

      <button
        type="button"
        className="codex-sidebar-new-task"
        onClick={createNewTask}
        title={`${t("sidebar.newTask")} (Ctrl+Alt+N)`}
        aria-keyshortcuts="Control+Alt+N"
      >
        <Plus size={15} strokeWidth={1.8} aria-hidden="true" />
        <span>{t("sidebar.newTask")}</span>
      </button>

      <div className="codex-sidebar-workspace-toolbar">
        <div className="codex-sidebar-workspace-title">{t("sidebar.projects")}</div>
        <div className="codex-sidebar-workspace-actions">
          <IconButton label={t("sidebar.searchProjects")} onClick={toggleProjectSearch}>
            <Search className="codex-sidebar-search-trigger" size={15} aria-hidden="true" />
          </IconButton>
          <IconButton label={t("sidebar.addProject")} onClick={() => setDirectoryPickerOpen(true)}>
            <FolderPlus size={15} aria-hidden="true" />
          </IconButton>
          {onToggleSidebar ? (
            <IconButton label={t("sidebar.hide")} onClick={onToggleSidebar}>
              <PanelLeft size={15} aria-hidden="true" />
            </IconButton>
          ) : null}
        </div>
      </div>

      {projectSearchOpen && (
        <div className="codex-sidebar-search-wrap">
          <Search size={14} aria-hidden="true" />
          <input ref={projectSearchInputRef} value={filter} onChange={(event) => setFilter(event.target.value)} placeholder={t("sidebar.searchProjects")} aria-label={t("sidebar.searchProjects")} />
          <IconButton label={t("i18n.close")} onClick={toggleProjectSearch}>
            <X size={14} aria-hidden="true" />
          </IconButton>
        </div>
      )}

      <section className="codex-sidebar-section">
        <div className="codex-sidebar-project-list" role="list">
          {loading && <div className="codex-sidebar-empty">{t("sidebar.loading")}</div>}
          {error && <div className="codex-sidebar-error">{error}</div>}
          {!loading && !error && visibleProjects.length === 0 && (
            <div className="codex-sidebar-empty">{t("sidebar.noProjects")}</div>
          )}
          {visibleProjects.map((project) => {
            const matchingSessions = filterProjectSessions(project, filterQuery) ?? [];
            const open = filterQuery ? matchingSessions.length > 0 : !collapsed.has(project.path);
            const selected = selectedProject?.path === project.path;
            const runningCount = project.sessions.filter((session) => activeRootIds.has(session.id)).length;
            const unreadCount = project.sessions.filter((session) => unreadIds.has(session.id)).length;
            return (
              <div
                className="codex-project"
                key={project.path}
                role="listitem"
                draggable={!renamingProject}
                onDragStart={() => setDraggedProject(project.path)}
                onDragEnd={() => setDraggedProject(null)}
                onDragOver={(event: DragEvent) => event.preventDefault()}
                onDrop={() => reorderProject(project.path)}
                data-dragging={draggedProject === project.path}
                onContextMenu={(event) => {
                  if (renamingProject === project.path) return;
                  event.preventDefault();
                  event.stopPropagation();
                  setMenuProject((current) => current?.path === project.path
                    ? null
                    : {
                        path: project.path,
                        left: Math.max(8, Math.min(window.innerWidth - 180, event.clientX)),
                        top: Math.max(8, Math.min(window.innerHeight - 202, event.clientY)),
                      });
                }}
              >
                <div className="codex-project-row" data-selected={selected}>
                  <div
                    className="codex-project-main"
                    title={project.path}
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      setSelectedCwd(project.path);
                      setCollapsed((current) => { const next = new Set(current); next.has(project.path) ? next.delete(project.path) : next.add(project.path); return next; });
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      setSelectedCwd(project.path);
                      setCollapsed((current) => { const next = new Set(current); next.has(project.path) ? next.delete(project.path) : next.add(project.path); return next; });
                    }}
                  >
                    <Chevron open={open} />
                    <FolderIcon />
                    {renamingProject === project.path ? (
                      <input
                        className="codex-project-rename"
                        value={renameValue}
                        autoFocus
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => setRenameValue(event.target.value)}
                        onBlur={() => { updateProject(project.path, { name: renameValue.trim() || undefined }); setRenamingProject(null); }}
                        onKeyDown={(event) => {
                          event.stopPropagation();
                          if (event.key === "Enter") event.currentTarget.blur();
                          if (event.key === "Escape") setRenamingProject(null);
                        }}
                      />
                    ) : (
                      <span className="codex-project-name">{project.name ?? projectName(project.path)}</span>
                    )}
                    {project.pinned && (
                      <span className="codex-project-pin" title={t("sidebar.pinned")}>
                        <Pin size={12} aria-hidden="true" />
                      </span>
                    )}
                    {runningCount > 0 && (
                      <span className="codex-project-running" title={t("sidebar.agentRunning")} aria-label={t("sidebar.agentRunning")} role="status">
                        <LoaderCircle size={12} strokeWidth={1.8} style={{ animation: "spin 0.8s linear infinite" }} aria-hidden="true" />
                      </span>
                    )}
                    {unreadCount > 0 && <span className="codex-project-unread" title={t("sidebar.newActivity")}>{unreadCount}</span>}
                  </div>
                  <IconButton label={t("sidebar.newSessionTitle", { path: project.path })} onClick={(event) => { event.stopPropagation(); createSession(project.path); }}>
                    <Plus size={14} strokeWidth={2.2} aria-hidden="true" />
                  </IconButton>
                  <div className="codex-project-menu-wrap">
                    <IconButton label={t("sidebar.projectActions")} onClick={(event) => {
                      event.stopPropagation();
                      const rect = event.currentTarget.getBoundingClientRect();
                      setMenuProject((current) => current?.path === project.path
                        ? null
                        : {
                            path: project.path,
                            left: Math.max(8, Math.min(window.innerWidth - 180, rect.right - 172)),
                            top: Math.max(8, Math.min(window.innerHeight - 202, rect.bottom + 2)),
                          });
                    }}>
                      <Ellipsis size={15} aria-hidden="true" />
                    </IconButton>
                  </div>
                </div>

                {open && (
                  <div className="codex-project-sessions" role="group">
                    {matchingSessions.length === 0 && <div className="codex-project-no-sessions">{t("sidebar.noSessions")}</div>}
                    {matchingSessions.map((session) => (
                      <SessionRow
                        key={session.id}
                        session={session}
                        selected={session.id === selectedSessionId}
                        running={activeRootIds.has(session.id)}
                        runningSubagentCount={(subagentsByRoot.get(session.id) ?? []).filter((child) => runningIds.has(child.id)).length}
                        unread={unreadIds.has(session.id)}
                        onSelect={() => selectSession(session)}
                        onChanged={() => void loadData(false)}
                        onDeleted={() => { onSessionDeleted?.(session.id); void loadData(false); }}
                        onArchive={() => {
                          setArchivedIds((current) => new Set(current).add(session.id));
                          setUnreadIds((current) => {
                            if (!current.has(session.id)) return current;
                            const next = new Set(current);
                            next.delete(session.id);
                            return next;
                          });
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="codex-sidebar-section codex-sidebar-recent">
        <button type="button" className="codex-sidebar-tool-heading codex-sidebar-section-heading" onClick={() => setRecentOpen((open) => !open)} aria-expanded={recentOpen}>
          <Chevron open={recentOpen} />
          <span>{t("sidebar.recent")}</span>
        </button>
        {recentOpen && (
        <div role="list">
          {recentSessions.map(({ session, projectLabel }) => (
            <SessionRow
              key={session.id}
              session={session}
              selected={session.id === selectedSessionId}
              running={activeRootIds.has(session.id)}
              runningSubagentCount={(subagentsByRoot.get(session.id) ?? []).filter((child) => runningIds.has(child.id)).length}
              unread={unreadIds.has(session.id)}
              variant="recent"
              projectLabel={projectLabel}
              relativeTime={formatRelativeTime(session.modified, locale)}
              onSelect={() => selectSession(session)}
              onChanged={() => void loadData(false)}
              onDeleted={() => { onSessionDeleted?.(session.id); void loadData(false); }}
              onArchive={() => {
                setArchivedIds((current) => new Set(current).add(session.id));
                setUnreadIds((current) => {
                  if (!current.has(session.id)) return current;
                  const next = new Set(current);
                  next.delete(session.id);
                  return next;
                });
              }}
            />
          ))}
        </div>
        )}
      </section>

      {selectedProject && !selectedProject.archived && !selectedProject.removed && worktrees.length > 0 && (
        <div className="codex-sidebar-project-tools">
            <div className="codex-worktree-block">
              <button type="button" className="codex-sidebar-tool-heading" onClick={() => setWorktreeOpen((open) => !open)}>
                <Chevron open={worktreeOpen} />
                <span>{t("sidebar.worktrees")}</span>
                <span className="codex-sidebar-count">{worktrees.length}</span>
              </button>
              {worktreeOpen && (
                <div className="codex-worktree-list">
                  {worktrees.map((worktree) => (
                    <div className="codex-worktree-row" key={worktree.path} data-selected={selectedCwd === worktree.path}>
                      <button type="button" title={worktree.path} onClick={() => setSelectedCwd(worktree.path)}>{worktree.branch ?? projectName(worktree.path)}</button>
                      {!worktree.isMain && <IconButton disabled={worktreeBusy} label={t("sidebar.removeWorktreeTitle", { path: worktree.path })} onClick={() => void removeWorktree(worktree.path)}><X size={13} aria-hidden="true" /></IconButton>}
                    </div>
                  ))}
                  <div className="codex-worktree-create">
                    <input value={newBranch} onChange={(event) => setNewBranch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void createWorktree(); }} placeholder={t("sidebar.branchName")} />
                    <IconButton disabled={!newBranch.trim() || worktreeBusy} label={t("sidebar.create")} onClick={() => void createWorktree()}>
                      <Plus size={13} aria-hidden="true" />
                    </IconButton>
                  </div>
                  {worktreeError && <div className="codex-sidebar-error">{worktreeError}</div>}
                </div>
              )}
            </div>
        </div>
      )}
      {menuProject && createPortal((() => {
        const project = projects.find((candidate) => candidate.path === menuProject.path);
        if (!project) return null;
        return (
          <div
            ref={menuRef}
            className="codex-project-menu codex-project-menu-portal"
            role="menu"
            style={{ left: menuProject.left, top: menuProject.top }}
          >
            <button type="button" role="menuitem" onClick={() => { updateProject(project.path, { pinned: !project.pinned }); setMenuProject(null); }}>{project.pinned ? <PinOff size={14} aria-hidden="true" /> : <Pin size={14} aria-hidden="true" />}{project.pinned ? t("sidebar.unpin") : t("sidebar.pin")}</button>
            <button type="button" role="menuitem" onClick={() => { moveProject(project.path, -1); setMenuProject(null); }}><ArrowUp size={14} aria-hidden="true" />{t("sidebar.moveUp")}</button>
            <button type="button" role="menuitem" onClick={() => { moveProject(project.path, 1); setMenuProject(null); }}><ArrowDown size={14} aria-hidden="true" />{t("sidebar.moveDown")}</button>
            <button type="button" role="menuitem" onClick={() => { setRenameValue(project.name ?? projectName(project.path)); setRenamingProject(project.path); setMenuProject(null); }}><Pencil size={14} aria-hidden="true" />{t("sidebar.renameProject")}</button>
            <button type="button" role="menuitem" onClick={() => { updateProject(project.path, { archived: true }); setMenuProject(null); }}><Archive size={14} aria-hidden="true" />{t("sidebar.archiveProject")}</button>
            <button type="button" role="menuitem" className="danger" onClick={() => { updateProject(project.path, { removed: true }); setMenuProject(null); }}><Trash2 size={14} aria-hidden="true" />{t("sidebar.removeProject")}</button>
          </div>
        );
      })(), document.body)}
      {pendingConfirmation?.type === "worktree" && (
        <DialogShell
          size="confirm"
          title={t("sidebar.forceRemoveCheckout")}
          ariaLabel={t("sidebar.cancel")}
          onClose={() => setPendingConfirmation(null)}
          dismissible={!worktreeBusy}
          backdropDismissible={false}
          footer={(
            <>
              <button type="button" className="codex-dialog-button" onClick={() => setPendingConfirmation(null)} disabled={worktreeBusy}>{t("sidebar.cancel")}</button>
              <button type="button" className="codex-dialog-button" data-variant="danger" disabled={worktreeBusy} onClick={async () => {
                const path = pendingConfirmation.path;
                if (await removeWorktree(path, true)) setPendingConfirmation(null);
              }}>{t("sidebar.force")}</button>
            </>
          )}
        >
          <code className="codex-dialog-inset">{pendingConfirmation.path}</code>
          {worktreeError && <div role="alert" className="codex-dialog-error">{worktreeError}</div>}
        </DialogShell>
      )}
      <dialog
        ref={quickDialogRef}
        className="codex-dialog codex-quick-switcher"
        data-size="tool"
        aria-label={t("sidebar.quickSwitcher")}
        onClick={(event) => {
          if (event.target === event.currentTarget) closeQuickSwitcher();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") { event.preventDefault(); closeQuickSwitcher(); return; }
          if (!quickResults.length) return;
          if (event.key === "ArrowDown") { event.preventDefault(); setQuickActiveIndex((current) => (current + 1) % quickResults.length); }
          if (event.key === "ArrowUp") { event.preventDefault(); setQuickActiveIndex((current) => (current - 1 + quickResults.length) % quickResults.length); }
          if (event.key === "Enter") { event.preventDefault(); chooseQuickResult(quickResults[quickActiveIndex]); }
        }}
      >
        <div className="codex-quick-switcher-shell">
          <div className="codex-quick-switcher-search">
            <Search size={16} aria-hidden="true" />
            <input
              ref={quickInputRef}
              value={quickQuery}
              onChange={(event) => { setQuickQuery(event.target.value); setQuickActiveIndex(0); }}
              placeholder={t("sidebar.quickSwitcherHint")}
              aria-label={t("sidebar.quickSwitcherHint")}
            />
            <kbd>Esc</kbd>
          </div>
          <div className="codex-quick-switcher-results" role="listbox" aria-label={t("sidebar.quickSwitcher")}>
            {quickResults.length === 0 && <div className="codex-sidebar-empty">{t("sidebar.noMatches")}</div>}
            {quickResults.map((result, index) => {
              const title = result.type === "project" ? result.project.name ?? projectName(result.project.path) : sessionTitle(result.session);
              const subtitle = result.type === "project" ? result.project.path : result.project.name ?? projectName(result.project.path);
              return (
                <div key={`${result.type}:${result.type === "project" ? result.project.path : result.session.id}`}>
                  {(index === 0 || index === quickProjectResults.length) && (
                    <div className="codex-quick-switcher-group">
                      {result.type === "project" ? t("sidebar.projectsGroup") : t("sidebar.sessionsGroup")}
                    </div>
                  )}
                  <button
                    type="button"
                    role="option"
                    aria-selected={index === quickActiveIndex}
                    data-active={index === quickActiveIndex}
                    onMouseEnter={() => setQuickActiveIndex(index)}
                    onClick={() => chooseQuickResult(result)}
                  >
                    {result.type === "project" ? <Folder size={15} aria-hidden="true" /> : <MessageSquare size={15} aria-hidden="true" />}
                    <span><strong>{title}</strong><small>{subtitle}</small></span>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </dialog>
    </div>
  );
}

function SessionRow({ session, selected, running, runningSubagentCount, unread, variant = "nested", projectLabel, relativeTime, onSelect, onChanged, onDeleted, onArchive }: {
  session: SessionInfo;
  selected: boolean;
  running: boolean;
  runningSubagentCount: number;
  unread: boolean;
  variant?: "nested" | "recent";
  projectLabel?: string;
  relativeTime?: string;
  onSelect: () => void;
  onChanged: () => void;
  onDeleted: () => void;
  onArchive: () => void;
}) {
  const { t } = useI18n();
  const [menuPos, setMenuPos] = useState<{ left: number; top: number } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const title = sessionTitle(session);
  const isRecent = variant === "recent";
  const rowTitle = isRecent && projectLabel ? `${projectLabel} · ${title}` : title;

  useEffect(() => {
    if (!menuPos) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || menuButtonRef.current?.contains(target)) return;
      setMenuPos(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setMenuPos(null);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [menuPos]);

  const commitRename = async () => {
    setRenaming(false);
    const name = value.trim();
    if (!name || name === title) return;
    await fetch(`/api/sessions/${encodeURIComponent(session.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    onChanged();
  };

  const remove = async () => {
    if (deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(session.id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      onDeleted();
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setDeleting(false);
    }
  };

  const openContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    const handled = dispatchSessionRowContextMenu({
      id: session.id,
      path: session.path,
      cwd: session.cwd,
      name: session.name,
      clientX: event.clientX,
      clientY: event.clientY,
      refresh: onChanged,
    });
    event.preventDefault();
    event.stopPropagation();
    // Long-press (mobile) / right-click (desktop): when no extension claims the
    // context menu, fall back to the built-in row menu.
    if (!handled) {
      setMenuPos({
        left: Math.max(8, Math.min(window.innerWidth - 180, event.clientX)),
        top: Math.max(8, Math.min(window.innerHeight - 110, event.clientY)),
      });
    }
  };

  return (
    <>
    <div className={`codex-session-row${isRecent ? " codex-recent-session-row" : ""}`} data-selected={selected} onContextMenu={renaming ? undefined : openContextMenu}>
      <div
        className="codex-session-main"
        onClick={onSelect}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          onSelect();
        }}
        role="button"
        tabIndex={0}
        title={rowTitle}
      >
        {running ? (
          <LoaderCircle
            className="codex-session-running"
            size={11}
            strokeWidth={1.8}
            style={{ animation: "spin 0.8s linear infinite", flexShrink: 0 }}
            aria-label={t("sidebar.agentRunning")}
            role="status"
          />
        ) : (
          <span className="codex-session-state" data-unread={unread} />
        )}
        {renaming ? (
          <input
            value={value}
            autoFocus
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => setValue(event.target.value)}
            onBlur={() => void commitRename()}
            onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") setRenaming(false); }}
          />
        ) : <span className={`codex-session-title${isRecent ? " codex-recent-session-title" : ""}`}>{title}</span>}
        {runningSubagentCount > 0 && (
          <span className="codex-session-subagents" title={t("sidebar.runningSubagents", { count: runningSubagentCount })}>
            <LoaderCircle size={11} strokeWidth={1.8} style={{ animation: "spin 0.8s linear infinite" }} aria-hidden="true" />
            <span>{runningSubagentCount}</span>
          </span>
        )}
      </div>
      {isRecent && relativeTime ? <span className="codex-recent-session-time">{relativeTime}</span> : null}
      {!session.transient && (
        <div className="codex-session-menu-wrap">
          <IconButton ref={menuButtonRef} label={t("sidebar.sessionActions")} onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            setMenuPos((current) => current ? null : {
              left: Math.max(8, Math.min(window.innerWidth - 180, rect.right - 172)),
              top: Math.max(8, Math.min(window.innerHeight - 110, rect.bottom + 2)),
            });
          }}>
            <Ellipsis size={14} aria-hidden="true" />
          </IconButton>
          {menuPos && createPortal(
            <div ref={menuRef} className="codex-project-menu codex-project-menu-portal" role="menu" style={{ left: menuPos.left, top: menuPos.top }}>
              <button type="button" role="menuitem" onClick={() => { setValue(title); setRenaming(true); setMenuPos(null); }}><Pencil size={14} aria-hidden="true" />{t("sidebar.rename")}</button>
              <button type="button" role="menuitem" onClick={() => { setMenuPos(null); onArchive(); }}><Archive size={14} aria-hidden="true" />{t("sidebar.archiveSession")}</button>
              <button type="button" role="menuitem" className="danger" onClick={() => { setMenuPos(null); setDeleteError(null); void remove(); }}><Trash2 size={14} aria-hidden="true" />{t("sidebar.delete")}</button>
            </div>,
            document.body,
          )}
        </div>
      )}
    </div>
    {deleteError && <div role="alert" className="codex-row-error">{deleteError}</div>}
    </>
  );
}
