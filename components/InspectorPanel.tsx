"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useTaskKeyboardNav } from "@/hooks/useTaskKeyboardNav";
import { useI18n } from "@/hooks/useI18n";
import { useTodoLiveRefresh } from "@/hooks/useTodoLiveRefresh";
import { useAgentRuntime } from "@/lib/agent-runtime-store";
import { getEntryIdForTask } from "@/lib/inspector-task-id";
import { InspectorTaskRow } from "./InspectorTaskRow";

// ---- Types ----

interface GitDiffData {
  isGit: boolean;
  branch: string | null;
  added: number;
  deleted: number;
  modified: number;
  staged: number;
  untracked: number;
}

interface TodoTask {
  id: number;
  subject: string;
  description?: string;
  activeForm?: string;
  status: "pending" | "in_progress" | "completed" | "deleted";
  blockedBy?: number[];
}

// ---- Component ----

/**
 * Inspector panel — git change stats, branch, and the current session's
 * task list. Mounted as a right-side workspace panel via the builtin
 * extension (lib/extensions/builtin.tsx).
 */
export const InspectorPanel = memo(function InspectorPanel({
  sessionId,
  cwd,
  open,
  onToggle,
  onTaskClick,
}: {
  sessionId: string | null;
  cwd: string | null;
  open: boolean;
  onToggle: () => void;
  /**
   * Called when the user clicks a task row. Receives the latest entryId
   * that mentioned the task. Parent (AppShell) is responsible for
   * scrolling the chat to that entry.
   */
  onTaskClick?: (entryId: string) => void;
}) {
  const { t } = useI18n();
  const runtime = useAgentRuntime();
  const [gitData, setGitData] = useState<GitDiffData | null>(null);
  // Timestamp of the last successful git fetch — drives the "Xs ago"
  // indicator shown next to the change stats.
  const [lastGitFetchAt, setLastGitFetchAt] = useState<number | null>(null);
  // Tick counter, incremented every 5s, used to re-render the relative-time
  // label so "3s ago" advances without needing a real git refresh.
  const [nowTick, setNowTick] = useState(0);
  const [tasks, setTasks] = useState<TodoTask[]>([]);
  // Maps taskId → latest session entryId that mentions it. Lets the
  // InspectorTaskRow click handler jump to the right message.
  const [entryIds, setEntryIds] = useState<Record<number, string>>({});
  // True while the initial fetch is in flight. Flips to false after the
  // first response (success or failure). Used to drive the skeleton
  // placeholders so the panel doesn't feel empty during the first paint.
  const [gitLoading, setGitLoading] = useState(true);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [pinned, setPinned] = useState(false);
  const [tasksCollapsed, setTasksCollapsed] = useState(false);
  // Hide completed tasks by default — they accumulate fast and clutter the list.
  const [showCompleted, setShowCompleted] = useState(false);
  // Ref to the task list container so useTaskKeyboardNav can scope j/k
  // navigation to its buttons. The container also gets tabIndex={-1} so
  // it can receive focus programmatically (e.g. when a user clicks the
  // panel header), letting the keydown handler fire from anywhere.
  const taskListRef = useRef<HTMLDivElement | null>(null);
  const handleTaskKeyDown = useTaskKeyboardNav(taskListRef, !tasksCollapsed);
  const [menuOpen, setMenuOpen] = useState(false);

  const menuRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // ---- Pin state from localStorage ----
  useEffect(() => {
    try {
      const p = localStorage.getItem("pi-inspector-pinned");
      if (p === "true") {
        setPinned(true);
        onToggle();
      }
      const c = localStorage.getItem("pi-inspector-tasks-collapsed");
      if (c === "true") setTasksCollapsed(true);
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const togglePin = useCallback(() => {
    setPinned((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("pi-inspector-pinned", String(next));
      } catch {
        /* ignore */
      }
      return next;
    });
    setMenuOpen(false);
  }, []);

  const toggleTasksCollapsed = useCallback(() => {
    setTasksCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("pi-inspector-tasks-collapsed", String(next));
      } catch {
        /* ignore */
      }
      return next;
    });
    setMenuOpen(false);
  }, []);

  const toggleShowCompleted = useCallback(() => {
    setShowCompleted((prev) => !prev);
  }, []);

  // ---- Git data fetching ----
  const reloadGit = useCallback(async () => {
    if (!cwd) {
      setGitLoading(false);
      return;
    }
    try {
      const res = await fetch(`/api/git-diff?cwd=${encodeURIComponent(cwd)}`);
      if (!res.ok) {
        setGitLoading(false);
        return;
      }
      setGitData(await res.json());
      setLastGitFetchAt(Date.now());
    } catch {
      /* best-effort */
    }
    setGitLoading(false);
  }, [cwd]);

  // ---- Todo data fetching ----
  const reloadTodos = useCallback(async () => {
    if (!sessionId) {
      setTasks([]);
      setEntryIds({});
      setTasksLoading(false);
      return;
    }
    try {
      const res = await fetch(`/api/task-list?sessionId=${encodeURIComponent(sessionId)}`);
      if (!res.ok) {
        setTasksLoading(false);
        return;
      }
      const d = (await res.json()) as { tasks: TodoTask[]; entryIds?: Record<number, string> };
      setTasks(d.tasks ?? []);
      setEntryIds(d.entryIds ?? {});
    } catch {
      /* best-effort */
    }
    setTasksLoading(false);
  }, [sessionId]);

  // Initial load + git polling (10s)
  useEffect(() => {
    void reloadGit();
    const interval = setInterval(() => void reloadGit(), 10_000);
    return () => clearInterval(interval);
  }, [reloadGit]);

  // Tick every 5s so the "Xs ago" label advances visually between real
  // git refreshes. Cheap — no network, just one setState every 5s.
  useEffect(() => {
    const id = setInterval(() => setNowTick((t) => t + 1), 5_000);
    return () => clearInterval(id);
  }, []);

  // Todo load + refresh on agent end
  useEffect(() => {
    void reloadTodos();
  }, [reloadTodos]);
  // Live refresh — re-fetch the moment the agent's `todo` tool completes,
  // so progress updates mid-run show up without waiting for agent_end.
  useTodoLiveRefresh(sessionId, reloadTodos);
  useEffect(() => {
    if (!runtime.agentRunning) {
      void reloadGit();
      void reloadTodos();
    }
  }, [runtime.agentRunning, reloadGit, reloadTodos]);

  // ---- Close the 3-dot menu on outside click ----
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  // ---- Escape closes the panel ----
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onToggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onToggle]);

  const hasTasks = tasks.length > 0;
  const completedTasks = tasks.filter((t) => t.status === "completed");
  const inProgressTasks = tasks.filter((t) => t.status === "in_progress");
  const pendingTasks = tasks.filter((t) => t.status === "pending");
  const allDone = hasTasks && completedTasks.length === tasks.length;
  const progressPct = hasTasks ? completedTasks.length / tasks.length : 0;
  // Progress color: dim (none) → amber (in progress) → green (all done)
  const progressColor = allDone
    ? "var(--git-added)"
    : completedTasks.length === 0
      ? "var(--text-dim)"
      : "var(--git-modified)";

  const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
  // Type-narrowed alias: if git is non-null, gitData is a valid GitDiffData.
  const git = gitData?.isGit === true ? gitData : null;

  return (
    <div
      ref={containerRef}
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        minHeight: 0,
      }}
    >
      {/* ======================================================
          EXPANDED — floating panel (only shown when open)
         ====================================================== */}
      {open && (
        <div
          ref={panelRef}
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            flex: 1,
            minHeight: 0,
            overflow: "hidden",
          }}
        >
          {/* ---- Header ---- */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: cwd ? 2 : 0,
              padding: "10px 14px 8px",
              borderBottom: "1px solid var(--border)",
              flexShrink: 0,
              minHeight: 38,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0, flex: 1 }}>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ color: "var(--accent)", flexShrink: 0 }}
                >
                  <circle cx="6" cy="6" r="3" />
                  <circle cx="6" cy="18" r="3" />
                  <path d="M6 9v6" />
                  <path d="M18 9a3 3 0 1 0-3-3" />
                  <path d="M15 21h6" />
                  <path d="M18 18v3" />
                </svg>
                {pinned && (
                  <span
                    title={t("inspector.pinned")}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 3,
                      padding: "1px 6px",
                      fontSize: 9,
                      fontWeight: 600,
                      color: "var(--accent)",
                      background: "color-mix(in srgb, var(--accent) 12%, transparent)",
                      borderRadius: 999,
                    }}
                  >
                    <svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z" />
                    </svg>
                    {t("inspector.pinned")}
                  </span>
                )}
              </div>

              {/* Three-dot menu (right side of title row) */}
              <div
                ref={menuRef}
                style={{
                  position: "relative",
                  display: "flex",
                  alignItems: "center",
                  gap: 2,
                  flexShrink: 0,
                }}
              >
                <button
                  onClick={() => setMenuOpen((v) => !v)}
                  title={t("inspector.more")}
                  aria-label={t("inspector.more")}
                  style={{
                    ...iconBtn,
                    color: menuOpen ? "var(--text)" : "var(--text-muted)",
                    background: menuOpen ? "var(--bg-hover)" : "transparent",
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="5" cy="12" r="1.6" />
                    <circle cx="12" cy="12" r="1.6" />
                    <circle cx="19" cy="12" r="1.6" />
                  </svg>
                </button>

                {menuOpen && (
                  <div
                    role="menu"
                    style={{
                      position: "absolute",
                      top: "calc(100% + 6px)",
                      right: 0,
                      minWidth: 200,
                      padding: 4,
                      background: "color-mix(in srgb, var(--bg-panel) 96%, transparent)",
                      backdropFilter: "blur(14px) saturate(160%)",
                      WebkitBackdropFilter: "blur(14px) saturate(160%)",
                      border: "1px solid var(--border)",
                      borderRadius: 10,
                      boxShadow: "0 8px 28px rgba(0,0,0,0.22), 0 2px 6px rgba(0,0,0,0.10)",
                      zIndex: 3,
                      animation: "inspector-fade-down 0.14s ease-out",
                    }}
                  >
                    <MenuItem
                      onClick={togglePin}
                      checked={pinned}
                      icon={
                        <svg
                          width="13"
                          height="13"
                          viewBox="0 0 24 24"
                          fill={pinned ? "currentColor" : "none"}
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z" />
                        </svg>
                      }
                      label={t("inspector.pin")}
                    />
                    <MenuItem
                      onClick={() => {
                        toggleTasksCollapsed();
                      }}
                      checked={tasksCollapsed}
                      icon={
                        <svg
                          width="13"
                          height="13"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                      }
                      label={t("inspector.collapseTasks")}
                    />
                    <div style={{ height: 1, background: "var(--border)", margin: "4px 6px" }} />
                    <MenuItem
                      onClick={() => {
                        void reloadGit();
                        void reloadTodos();
                        setMenuOpen(false);
                      }}
                      checked={false}
                      icon={
                        <svg
                          width="13"
                          height="13"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16" />
                        </svg>
                      }
                      label={t("common.refresh")}
                    />
                  </div>
                )}
              </div>
            </div>

            {/* cwd subtitle (shows which dir is being inspected) */}
            {cwd && (
              <div
                title={cwd}
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 10,
                  color: "var(--text-dim)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  direction: "rtl", // keep the meaningful path tail visible when truncating
                  textAlign: "left",
                }}
              >
                {cwd}
              </div>
            )}
          </div>

          {/* ---- Block: Git changes ---- */}
          {/* Git skeleton while loading initial data */}
          {git === null && gitLoading && cwd && (
            <div>
              <div
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px 6px" }}
              >
                <Skeleton width={22} height={22} rounded={6} />
                <Skeleton width={60} />
                <span style={{ flex: 1 }} />
                <Skeleton width={36} />
                <Skeleton width={36} />
              </div>
              <div style={{ display: "flex", gap: 14, padding: "0 14px 10px 44px" }}>
                <Skeleton width={80} height={9} />
                <Skeleton width={70} height={9} />
              </div>
            </div>
          )}

          {git && (
            <div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "10px 14px 6px",
                }}
              >
                <span
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 6,
                    flexShrink: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "var(--bg-subtle)",
                    border: "1px solid var(--border)",
                  }}
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ color: "var(--text-muted)" }}
                  >
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                </span>
                <span style={{ fontSize: 13, color: "var(--text)", flex: 1, fontWeight: 500 }}>
                  {t("inspector.changes")}
                </span>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: "var(--git-added)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  +{fmt(git.added)}
                </span>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: "var(--git-deleted)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  −{fmt(git.deleted)}
                </span>
              </div>
              {/* Sub-detail: file counts (semantic colors) */}
              <div
                style={{
                  display: "flex",
                  gap: 10,
                  padding: "0 14px 8px 44px",
                  fontSize: 10,
                  color: "var(--text-dim)",
                }}
              >
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: git.modified > 0 ? "var(--git-modified)" : "var(--border)",
                    }}
                  />
                  <span
                    style={{
                      color: git.modified > 0 ? "var(--git-modified)" : "var(--text-dim)",
                      fontWeight: git.modified > 0 ? 500 : 400,
                    }}
                  >
                    {t("inspector.modified")}: {git.modified}
                  </span>
                </span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: git.staged > 0 ? "var(--accent)" : "var(--border)",
                    }}
                  />
                  <span
                    style={{
                      color: git.staged > 0 ? "var(--accent)" : "var(--text-dim)",
                      fontWeight: git.staged > 0 ? 500 : 400,
                    }}
                  >
                    {t("inspector.staged")}: {git.staged}
                  </span>
                </span>
                {git.untracked > 0 && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: "var(--git-untracked)",
                      }}
                    />
                    <span style={{ color: "var(--git-untracked)", fontWeight: 500 }}>
                      {t("inspector.untracked")}: {git.untracked}
                    </span>
                  </span>
                )}
              </div>
              {/* "Xs ago" indicator — uses nowTick to refresh visually between git refreshes */}
              {lastGitFetchAt && (
                <div
                  data-now-tick={nowTick}
                  style={{
                    display: "flex",
                    justifyContent: "flex-end",
                    padding: "0 14px 6px 44px",
                    fontSize: 9,
                    color: "var(--text-dim)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <span
                      style={{
                        width: 5,
                        height: 5,
                        borderRadius: "50%",
                        background: "var(--git-added)",
                        opacity: 0.7,
                      }}
                    />
                    {t("inspector.updatedAgo", {
                      time: formatRelative(Date.now() - lastGitFetchAt),
                    })}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* ---- Block: Branch selector + commit/push action ---- */}
          {git && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 14px",
                borderTop: "1px solid var(--border)",
              }}
            >
              <button
                title={t("inspector.branch")}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  minWidth: 0,
                  padding: "5px 8px",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  background: "var(--bg)",
                  cursor: "pointer",
                  color: "var(--text)",
                  flex: 1,
                  transition: "border-color 0.15s, background 0.15s",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--text-muted)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--border)";
                }}
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ color: "var(--accent)", flexShrink: 0 }}
                >
                  <circle cx="6" cy="6" r="3" />
                  <circle cx="6" cy="18" r="3" />
                  <path d="M6 9v6" />
                  <path d="M18 6a3 3 0 1 0 0 6 3 3 0 0 0 0-6z M18 12v3a3 3 0 0 1-3 3H9" />
                </svg>
                <span
                  style={{
                    fontSize: 12,
                    fontFamily: "var(--font-mono)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    maxWidth: 140,
                  }}
                >
                  {git.branch ?? t("inspector.detached")}
                </span>
                <svg
                  width="9"
                  height="9"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ color: "var(--text-muted)", flexShrink: 0 }}
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
              <button
                title={t("inspector.commitPush")}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "5px 10px",
                  border: "1px solid color-mix(in srgb, var(--accent) 40%, var(--border))",
                  borderRadius: 6,
                  background: "color-mix(in srgb, var(--accent) 8%, var(--bg))",
                  cursor: "pointer",
                  color: "var(--accent)",
                  flexShrink: 0,
                  fontWeight: 600,
                  transition: "background 0.15s, border-color 0.15s",
                }}
                onMouseEnter={(e) => {
                  const el = e.currentTarget as HTMLButtonElement;
                  el.style.background = "color-mix(in srgb, var(--accent) 16%, var(--bg))";
                  el.style.borderColor = "var(--accent)";
                }}
                onMouseLeave={(e) => {
                  const el = e.currentTarget as HTMLButtonElement;
                  el.style.background = "color-mix(in srgb, var(--accent) 8%, var(--bg))";
                  el.style.borderColor = "color-mix(in srgb, var(--accent) 40%, var(--border))";
                }}
              >
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
                </svg>
                <span style={{ fontSize: 12 }}>{t("inspector.commitPush")}</span>
              </button>
            </div>
          )}

          {/* ---- Block: Task progress ---- */}

          {/* Tasks skeleton while loading */}
          {!hasTasks && tasksLoading && sessionId && (
            <div style={{ borderTop: "1px solid var(--border)", padding: "10px 14px" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 10,
                }}
              >
                <Skeleton width={50} height={11} />
                <Skeleton width={70} height={14} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <Skeleton width="85%" />
                <Skeleton width="65%" />
                <Skeleton width="75%" />
              </div>
            </div>
          )}

          {hasTasks && (
            <div
              style={{
                borderTop: "1px solid var(--border)",
                flex: 1,
                overflowY: "auto",
                minHeight: 0,
              }}
            >
              <button
                onClick={toggleTasksCollapsed}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "8px 14px",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500 }}>
                  {t("inspector.process")}
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {/* Circular progress ring — 30px diameter, completed count inside */}
                  <ProgressRing
                    pct={progressPct}
                    color={progressColor}
                    value={completedTasks.length}
                  />
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: progressColor,
                      fontVariantNumeric: "tabular-nums",
                      transition: "color 0.2s",
                    }}
                  >
                    {completedTasks.length}/{tasks.length}
                  </span>
                  <svg
                    width="11"
                    height="11"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{
                      color: "var(--text-muted)",
                      transform: tasksCollapsed ? "rotate(-90deg)" : "none",
                      transition: "transform 0.15s",
                    }}
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </div>
              </button>

              {!tasksCollapsed && (
                <div
                  ref={taskListRef}
                  tabIndex={-1}
                  onKeyDown={handleTaskKeyDown}
                  style={{ padding: "0 0 8px", outline: "none" }}
                >
                  {inProgressTasks.map((task) => (
                    <InspectorTaskRow
                      key={task.id}
                      task={task}
                      variant="active"
                      entryId={getEntryIdForTask(entryIds, task.id)}
                      onTaskClick={onTaskClick ?? (() => {})}
                    />
                  ))}
                  {pendingTasks.map((task) => (
                    <InspectorTaskRow
                      key={task.id}
                      task={task}
                      variant="pending"
                      entryId={getEntryIdForTask(entryIds, task.id)}
                      onTaskClick={onTaskClick ?? (() => {})}
                    />
                  ))}
                  {completedTasks.length > 0 && (
                    <>
                      {showCompleted ? (
                        <>
                          <div
                            style={{
                              padding: "8px 14px 4px",
                              fontSize: 10,
                              color: "var(--text-dim)",
                              textTransform: "uppercase",
                              letterSpacing: 0.5,
                            }}
                          >
                            {t("inspector.completedN", { count: completedTasks.length })}
                          </div>
                          {completedTasks.map((task) => (
                            <InspectorTaskRow
                              key={task.id}
                              task={task}
                              variant="done"
                              entryId={getEntryIdForTask(entryIds, task.id)}
                              onTaskClick={onTaskClick ?? (() => {})}
                            />
                          ))}
                          <button
                            onClick={toggleShowCompleted}
                            style={{
                              width: "100%",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              gap: 5,
                              padding: "6px 14px",
                              marginTop: 4,
                              background: "none",
                              border: "none",
                              cursor: "pointer",
                              fontSize: 10,
                              color: "var(--text-muted)",
                            }}
                            onMouseEnter={(e) => {
                              (e.currentTarget as HTMLButtonElement).style.color = "var(--text)";
                            }}
                            onMouseLeave={(e) => {
                              (e.currentTarget as HTMLButtonElement).style.color =
                                "var(--text-muted)";
                            }}
                          >
                            <svg
                              width="9"
                              height="9"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <polyline points="18 15 12 9 6 15" />
                            </svg>
                            {t("inspector.hideCompleted")}
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={toggleShowCompleted}
                          style={{
                            width: "100%",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: 6,
                            padding: "7px 14px",
                            marginTop: 4,
                            background: "none",
                            border: "1px dashed var(--border)",
                            borderRadius: 6,
                            cursor: "pointer",
                            fontSize: 11,
                            color: "var(--text-muted)",
                          }}
                          onMouseEnter={(e) => {
                            (e.currentTarget as HTMLButtonElement).style.color = "var(--text)";
                            (e.currentTarget as HTMLButtonElement).style.borderColor =
                              "var(--text-dim)";
                          }}
                          onMouseLeave={(e) => {
                            (e.currentTarget as HTMLButtonElement).style.color =
                              "var(--text-muted)";
                            (e.currentTarget as HTMLButtonElement).style.borderColor =
                              "var(--border)";
                          }}
                        >
                          <svg
                            width="11"
                            height="11"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <polyline points="6 9 12 15 18 9" />
                          </svg>
                          {t("inspector.showCompleted", { count: completedTasks.length })}
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Empty state — branched by what data is missing */}
          {!hasTasks && !git && (
            <div
              style={{
                padding: "32px 16px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 8,
              }}
            >
              {!cwd ? (
                <>
                  <svg
                    width="28"
                    height="28"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ color: "var(--text-dim)" }}
                  >
                    <path d="M3 7l9-4 9 4-9 4-9-4z" />
                    <path d="M3 7v10l9 4 9-4V7" />
                    <path d="M12 11v10" />
                  </svg>
                  <span
                    style={{
                      fontSize: 12,
                      color: "var(--text-dim)",
                      textAlign: "center",
                      lineHeight: 1.5,
                    }}
                  >
                    {t("inspector.emptyNoCwd")}
                  </span>
                </>
              ) : gitData && !gitData.isGit ? (
                <>
                  <svg
                    width="28"
                    height="28"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ color: "var(--text-dim)" }}
                  >
                    <circle cx="12" cy="12" r="10" />
                    <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                  </svg>
                  <span
                    style={{
                      fontSize: 12,
                      color: "var(--text-dim)",
                      textAlign: "center",
                      lineHeight: 1.5,
                    }}
                  >
                    {t("inspector.emptyNoGit")}
                  </span>
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 10,
                      color: "var(--text-dim)",
                      direction: "rtl",
                      maxWidth: "100%",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {cwd}
                  </span>
                </>
              ) : (
                <>
                  <svg
                    width="28"
                    height="28"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ color: "var(--text-dim)" }}
                  >
                    <circle cx="12" cy="12" r="10" />
                    <path d="M8 12h8M12 8v8" />
                  </svg>
                  <span
                    style={{
                      fontSize: 12,
                      color: "var(--text-dim)",
                      textAlign: "center",
                      lineHeight: 1.5,
                    }}
                  >
                    {t("inspector.empty")}
                  </span>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* ======================================================
          COLLAPSED — floating taskbar pill (only shown when NOT open)
         ====================================================== */}
      {!open && (
        <button
          onClick={onToggle}
          title={t("inspector.title")}
          aria-label={t("inspector.title")}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            padding: "6px 12px",
            height: 30,
            background: "color-mix(in srgb, var(--bg-panel) 90%, transparent)",
            backdropFilter: "blur(12px) saturate(150%)",
            WebkitBackdropFilter: "blur(12px) saturate(150%)",
            border: "1px solid color-mix(in srgb, var(--border) 80%, transparent)",
            borderRadius: 999,
            cursor: "pointer",
            color: "var(--text)",
            fontSize: 12,
            fontWeight: 500,
            fontVariantNumeric: "tabular-nums",
            boxShadow: "0 4px 14px rgba(0,0,0,0.18), 0 1px 2px rgba(0,0,0,0.08)",
            width: "fit-content",
            transition: "transform 0.12s ease, box-shadow 0.12s ease",
            animation: "inspector-fade-down 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = "translateY(-1px)";
            e.currentTarget.style.boxShadow =
              "0 8px 22px rgba(0,0,0,0.25), 0 1px 3px rgba(0,0,0,0.10)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = "translateY(0)";
            e.currentTarget.style.boxShadow =
              "0 4px 14px rgba(0,0,0,0.18), 0 1px 2px rgba(0,0,0,0.08)";
          }}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ color: "var(--text-muted)", flexShrink: 0 }}
          >
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M9 9h6v6H9z" />
          </svg>
          <span>{t("inspector.changes")}</span>
          {git && (
            <>
              <span style={{ fontWeight: 600, color: "var(--git-added)" }}>+{fmt(git.added)}</span>
              <span style={{ fontWeight: 600, color: "var(--git-deleted)" }}>
                −{fmt(git.deleted)}
              </span>
            </>
          )}
          {hasTasks && (
            <>
              <span
                style={{ width: 1, height: 12, background: "var(--border)", margin: "0 2px" }}
              />
              <span
                style={{
                  color: allDone ? "var(--git-added)" : "var(--text-muted)",
                  fontWeight: 600,
                }}
              >
                {completedTasks.length}/{tasks.length}
              </span>
            </>
          )}
        </button>
      )}
    </div>
  );
});

// ---- Menu item helper ----

function MenuItem({
  onClick,
  label,
  icon,
  checked,
}: {
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
  checked: boolean;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      role="menuitem"
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 9,
        padding: "7px 10px",
        border: "none",
        borderRadius: 7,
        background: hover ? "var(--bg-hover)" : "transparent",
        color: "var(--text)",
        cursor: "pointer",
        fontSize: 12,
        textAlign: "left",
        transition: "background 0.1s",
      }}
    >
      <span
        style={{
          display: "inline-flex",
          width: 14,
          alignItems: "center",
          justifyContent: "center",
          color: "var(--text-muted)",
        }}
      >
        {icon}
      </span>
      <span style={{ flex: 1 }}>{label}</span>
      {checked && (
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ color: "var(--accent)" }}
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )}
    </button>
  );
}

// ---- Task row ----

function ProgressRing({ pct, color, value }: { pct: number; color: string; value: number }) {
  const size = 30;
  const stroke = 3;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - Math.min(1, Math.max(0, pct)));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
      {/* Background ring */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--bg-subtle)"
        strokeWidth={stroke}
      />
      {/* Progress arc — rotated -90deg so it starts from 12 o'clock */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeDasharray={c}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: "stroke-dashoffset 0.3s cubic-bezier(.4,0,.2,1), stroke 0.2s" }}
      />
      {/* Center number */}
      <text
        x={size / 2}
        y={size / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize="10"
        fontWeight="700"
        fill={color}
        style={{
          fontVariantNumeric: "tabular-nums",
          fontFamily: "var(--font-mono)",
          transition: "fill 0.2s",
        }}
      >
        {value}
      </text>
    </svg>
  );
}

// ---- Skeleton placeholder ----

function Skeleton({
  width,
  height = 12,
  rounded = 4,
}: {
  width: number | string;
  height?: number;
  rounded?: number;
}) {
  return (
    <div
      style={{
        width,
        height,
        borderRadius: rounded,
        background:
          "linear-gradient(90deg, var(--bg-subtle) 0%, color-mix(in srgb, var(--bg-hover) 70%, transparent) 50%, var(--bg-subtle) 100%)",
        backgroundSize: "200% 100%",
        animation: "inspector-shimmer 1.6s ease-in-out infinite",
      }}
    />
  );
}

// ---- Relative time formatter ----
// "just now" / "12s ago" / "3m ago". Inputs are non-negative ms.
function formatRelative(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

const iconBtn: React.CSSProperties = {
  background: "transparent",
  border: "none",
  cursor: "pointer",
  color: "var(--text-muted)",
  padding: 5,
  borderRadius: 6,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  transition: "background 0.1s",
};
