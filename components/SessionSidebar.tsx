"use client";

import { useEffect, useLayoutEffect, useState, useCallback, useMemo, useRef, type CSSProperties, type ReactNode } from "react";
import type { SessionInfo } from "@/lib/types";
import { listSessionFamilies, getSessionFamily, type SessionFamily } from "@/lib/session-family";
import { loadExplorerOpen, saveExplorerOpen } from "@/lib/file-explorer-state";
import { dispatchSessionRowContextMenu } from "@/lib/session-row-context-menu";
import { skillExpansionToCommand } from "@/lib/slash-display";
import { getProjectActivity, getRecentProjects, isPathInsideDirectory, sessionsForDirectory, sessionsForProject } from "@/lib/project-groups";
import {
  addCustomDirectory,
  customDirectoryIdentity,
  isCustomDirectoryListed,
  listCustomDirectories,
  removeCustomDirectory,
  renameCustomDirectory,
} from "@/lib/custom-directories";
import { buildExplorerRoots } from "@/lib/explorer-roots";
import { shouldShowDefaultCwdShortcut, syntheticProjectFor } from "@/lib/default-cwd-shortcut";
import {
  buildSidebarRows,
  getWindowedRows,
  scrollTargetForSession,
  sidebarRowsHeight,
  SESSION_LIST_ITEM_HEIGHT,
  type GroupEmptyRow,
  type SessionRow,
  type SidebarRow,
  type SidebarProject,
} from "@/lib/sidebar-rows";
import { workspaceKeyOf } from "@/lib/workspace-memory";
import { formatRelativeTime } from "@/lib/i18n/format";
import { useI18n } from "@/hooks/useI18n";
import { useResizablePanel } from "@/hooks/useResizablePanel";
import { DirectoryPicker } from "./DirectoryPicker";
import { MultiRootFileExplorer, type MultiRootFileExplorerHandle } from "./MultiRootFileExplorer";
import { SessionSearch } from "./SessionSearch";

/** Client-side temporary session id — pi spawns lazily on first message. */
function newTempSessionId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

declare global {
  interface Window {
    piDesktop?: {
      selectDirectory: () => Promise<string | null>;
    };
  }
}

function ToolbarIconButton({
  onClick,
  title,
  disabled,
  skipHover,
  color,
  background = "none",
  marginRight,
  ariaPressed,
  children,
}: {
  onClick: () => void;
  title: string;
  disabled?: boolean;
  skipHover?: boolean;
  color: string;
  background?: string;
  marginRight?: number;
  ariaPressed?: boolean;
  children: ReactNode;
}) {
  const enter = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (disabled || skipHover) return;
    e.currentTarget.style.color = "var(--text-muted)";
    e.currentTarget.style.background = "var(--bg-hover)";
  };
  const leave = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (disabled || skipHover) return;
    e.currentTarget.style.color = color;
    e.currentTarget.style.background = background;
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      aria-pressed={ariaPressed}
      style={{
        position: "relative",
        display: "flex", alignItems: "center", justifyContent: "center",
        width: 26, height: 26, padding: 0, marginRight,
        background,
        border: "none",
        color,
        cursor: disabled ? "default" : "pointer",
        borderRadius: 5,
        flexShrink: 0,
        opacity: disabled ? 0.6 : 1,
        transition: "color 0.3s, background 0.3s",
      }}
      onMouseEnter={enter}
      onMouseLeave={leave}
    >
      {children}
    </button>
  );
}

interface Props {
  selectedSessionId: string | null;
  /** Split-view follow: focus-derived session id the sidebar highlights.
   *  Falls back to selectedSessionId when the prop is absent, so classic
   *  call sites keep byte-for-byte the old behavior. Never the new-session
   *  sentinel — AppShell derives it via resolveSidebarSessionId. */
  highlightSessionId?: string | null;
  /** Gate for the highlight's scroll/expand follow effect. AppShell passes
   *  `splitPaneEnabled && !isMobile` so the classic and mobile layouts keep
   *  zero new scroll/expansion side effects. */
  followHighlightIntoView?: boolean;
  onSelectSession: (session: SessionInfo, isRestore?: boolean, entryId?: string, blockIndex?: number) => void;
  onNewSession?: (sessionId: string, cwd: string) => void;
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
  /** Fired when the selected session was written externally (another pi
   *  process) so the open chat view can reload it from disk. */
  onExternalSessionChange?: (sessionId: string) => void;
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

const UNREAD_SESSIONS_STORAGE_KEY = "pi-web:unread-session-ids";
const LAST_CUSTOM_CWD_STORAGE_KEY = "pi-web:last-custom-cwd";
const RUNNING_SESSIONS_POLL_MS = 2500;
const SESSION_PANE_DEFAULT_HEIGHT = 320;
const SESSION_PANE_MIN_HEIGHT = 80;
const EXPLORER_PANE_MIN_HEIGHT = 120;
const SESSION_PANE_MAX_HEIGHT = 1600;

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

/** Substitute the home dir prefix with ~ (no path truncation — see PathLabel) */
function displayCwd(cwd: string, homeDir?: string): string {
  return (homeDir && cwd.startsWith(homeDir)) ? "~" + cwd.slice(homeDir.length) : cwd;
}

// Hide-toggle for unmergeable worktree pseudo-project rows was retired with
// the worktree switcher (2026-09-23 user decision): rows render with no
// worktree-specific hiding. (readHidePseudoProjects and the
// pi-web:hide-pseudo-projects key are gone.)

// Pinned-group expansion state, persisted across reloads per the confirmed
// product decision (wi body: 展开状态记住到 localStorage). Stored as a JSON
// array of project keys; absent/corrupt values read as the empty set. Keys of
// projects that were later unpinned are harmless and left alone — a re-pin
// simply finds its old expansion state again.
const PINNED_EXPANDED_STORAGE_KEY = "pi-web:sidebar-pinned-expanded";

function readExpandedGroupKeys(): ReadonlySet<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(PINNED_EXPANDED_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((key): key is string => typeof key === "string"));
  } catch {
    return new Set();
  }
}

function writeExpandedGroupKeys(keys: ReadonlySet<string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PINNED_EXPANDED_STORAGE_KEY, JSON.stringify([...keys]));
  } catch {
    // ignore storage quota / privacy-mode errors
  }
}

/**
 * Path label that ellipsizes on the LEFT, keeping the (most relevant) trailing
 * segments visible: "…orkspace/pi-web". Shows as much of the path as fits
 * instead of a fixed number of segments. The rtl container moves the ellipsis
 * to the left edge; the inner plaintext bidi isolation keeps the path itself
 * rendered strictly left-to-right (no punctuation reordering).
 */
function PathLabel({ text, style }: { text: string; style?: CSSProperties }) {
  return (
    <span
      style={{
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        display: "block",
        minWidth: 0,
        lineHeight: 1.35,
        direction: "rtl",
        textAlign: "left",
        ...style,
      }}
    >
      <span style={{ unicodeBidi: "plaintext" }}>{text}</span>
    </span>
  );
}

const DROPDOWN_ANIMATION_MS = 140;

/** Pushpin glyph for the pin affordance; filled when pinned. */
function PinIcon({ pinned }: { pinned: boolean }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill={pinned ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block" }}>
      <path d="M3.6 1h2.8l-.4 2.6 1.5 1.4v.8H2.5v-.8L4 3.6z" />
      <line x1="5" y1="5.8" x2="5" y2="9" />
    </svg>
  );
}

/** One workspace-selector project row, with its pin/unpin affordance. */
function ProjectRow({
  project,
  selected,
  pinned,
  stale = false,
  activity,
  homeDir,
  t,
  onSelect,
  onTogglePin,
}: {
  project: { key: string; root: string };
  selected: boolean;
  pinned: boolean;
  /** Root no longer exists on disk: rendered greyed, not selectable. */
  stale?: boolean;
  activity?: { running: number; unread: number };
  homeDir: string;
  t: (key: string) => string;
  onSelect: () => void;
  onTogglePin: () => void;
}) {
  return (
    <button
      onClick={stale ? undefined : onSelect}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 7,
        width: "100%",
        padding: "8px 10px",
        background: "var(--bg)",
        border: "none",
        borderBottom: "1px solid var(--border)",
        color: stale ? "var(--text-dim)" : selected ? "var(--text)" : "var(--text-muted)",
        cursor: stale ? "default" : "pointer",
        textAlign: "left",
        fontSize: 11,
        fontFamily: "var(--font-mono)",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
      title={stale ? `${project.root} — ${t("sidebar.pinnedProjectMissing")}` : project.root}
    >
      {selected ? (
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
          <polyline points="1.5 5 4 7.5 8.5 2.5" />
        </svg>
      ) : (
        <span style={{ width: 10, flexShrink: 0 }} />
      )}
      <PathLabel text={displayCwd(project.root, homeDir)} style={{ flex: 1 }} />
      {showProjectActivity(activity, t)}
      <span
        role="button"
        tabIndex={0}
        title={pinned ? t("sidebar.unpinProject") : t("sidebar.pinProject")}
        aria-label={pinned ? t("sidebar.unpinProject") : t("sidebar.pinProject")}
        onClick={(e) => {
          e.stopPropagation();
          onTogglePin();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.stopPropagation();
            e.preventDefault();
            onTogglePin();
          }
        }}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 16,
          height: 16,
          flexShrink: 0,
          marginLeft: 4,
          borderRadius: 3,
          color: pinned ? "var(--accent)" : "var(--text-dim)",
          cursor: "pointer",
        }}
      >
        <PinIcon pinned={pinned} />
      </span>
    </button>
  );
}

/** Stable DOM id of a pinned group's expandable content container. */
function pinnedGroupContentId(key: string): string {
  return `pinned-group-${encodeURIComponent(key)}`;
}

/**
 * Header row of one listed-directory group in the session list: chevron +
 * label (the expand control, a real button with aria-expanded /
 * aria-controls), the per-project activity badge, the rename affordance
 * (edits the entry's displayName; an empty value clears it back to the
 * path-derived label), the remove-from-list toggle and the group's own
 * new-session [+] (relocated from the workspace dropdown). A stale root
 * renders the whole header greyed with the missing-directory hint and
 * disables [+].
 */
function PinnedGroupHeader({
  project,
  label,
  expanded,
  stale,
  activity,
  homeDir,
  t,
  onToggle,
  onUnpin,
  onRename,
  onNewSession,
}: {
  project: SidebarProject;
  /** User-set display name; absent falls back to the path label. */
  label?: string;
  expanded: boolean;
  /** Root no longer exists on disk: rendered greyed, [+] disabled. */
  stale: boolean;
  activity?: { running: number; unread: number };
  homeDir: string;
  t: (key: string, params?: Record<string, string | number>) => string;
  onToggle: () => void;
  onUnpin: () => void;
  /** Commits a rename; an empty value clears the display name. */
  onRename: (name: string) => void;
  onNewSession: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const newSessionLabel = t("sidebar.newSessionTitle", { path: project.root });
  const displayLabel = label ?? displayCwd(project.root, homeDir);

  const startRename = () => {
    setRenameValue(label ?? "");
    setRenaming(true);
  };
  const commitRename = () => {
    setRenaming(false);
    const name = renameValue.trim();
    if (name === (label ?? "")) return;
    onRename(name);
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        height: "100%",
        paddingRight: 6,
        borderBottom: "1px solid var(--border)",
        background: "var(--bg)",
      }}
    >
      {renaming ? (
        <>
          <input
            value={renameValue}
            autoFocus
            placeholder={t("sidebar.renameDirectory")}
            onChange={(event) => setRenameValue(event.target.value)}
            onBlur={commitRename}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitRename();
              if (event.key === "Escape") setRenaming(false);
            }}
            style={{
              flex: 1,
              minWidth: 0,
              height: 26,
              margin: "0 0 0 10px",
              padding: "0 8px",
              border: "1px solid var(--accent)",
              borderRadius: 5,
              outline: "none",
              background: "var(--bg)",
              color: "var(--text)",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
            }}
          />
          <button
            onClick={commitRename}
            title={t("sidebar.renameDirectory")}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: 22,
              padding: "0 9px",
              marginLeft: 4,
              flexShrink: 0,
              background: "var(--accent)",
              border: "none",
              borderRadius: 5,
              color: "var(--accent-contrast)",
              fontSize: 11,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {t("sidebar.renameDirectory")}
          </button>
        </>
      ) : (
        <>
      <button
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={pinnedGroupContentId(project.key)}
        title={stale
          ? `${project.root} — ${t("sidebar.pinnedProjectMissing")}`
          : t(expanded ? "sidebar.pinnedGroupCollapse" : "sidebar.pinnedGroupExpand", { path: project.root })}
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          alignItems: "center",
          gap: 6,
          height: "100%",
          padding: "0 4px 0 10px",
          background: "none",
          border: "none",
          color: stale ? "var(--text-dim)" : "var(--text)",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <svg
          width="9"
          height="9"
          viewBox="0 0 10 10"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ flexShrink: 0, transform: expanded ? "none" : "rotate(-90deg)", transition: "transform 0.15s" }}
        >
          <polyline points="3 2 7 5 3 8" />
        </svg>
        <PathLabel
          text={displayLabel}
          style={{ flex: 1, fontFamily: "var(--font-mono)", fontSize: 11, lineHeight: 1.35 }}
        />
      </button>
      {showProjectActivity(activity, t)}
      <span
        role="button"
        tabIndex={0}
        title={t("sidebar.renameDirectory")}
        aria-label={t("sidebar.renameDirectory")}
        onClick={(e) => {
          e.stopPropagation();
          startRename();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.stopPropagation();
            e.preventDefault();
            startRename();
          }
        }}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 16,
          height: 16,
          flexShrink: 0,
          marginLeft: 4,
          borderRadius: 3,
          color: "var(--text-dim)",
          cursor: "pointer",
        }}
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block" }}>
          <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
        </svg>
      </span>
      <span
        role="button"
        tabIndex={0}
        title={t("sidebar.unpinProject")}
        aria-label={t("sidebar.unpinProject")}
        onClick={(e) => {
          e.stopPropagation();
          onUnpin();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.stopPropagation();
            e.preventDefault();
            onUnpin();
          }
        }}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 16,
          height: 16,
          flexShrink: 0,
          marginLeft: 4,
          borderRadius: 3,
          color: "var(--accent)",
          cursor: "pointer",
        }}
      >
        <PinIcon pinned />
      </span>
      <button
        onClick={onNewSession}
        disabled={stale}
        title={newSessionLabel}
        aria-label={newSessionLabel}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 22,
          height: 22,
          padding: 0,
          marginLeft: 2,
          flexShrink: 0,
          background: "none",
          border: "1px solid var(--border)",
          borderRadius: 5,
          color: stale ? "var(--text-dim)" : "var(--text-muted)",
          cursor: stale ? "default" : "pointer",
          opacity: stale ? 0.6 : 1,
        }}
      >
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="6" y1="1" x2="6" y2="11" />
          <line x1="1" y1="6" x2="11" y2="6" />
        </svg>
      </button>
        </>
      )}
    </div>
  );
}

function AnimatedDropdown({ open, children, style }: { open: boolean; children: ReactNode; style: CSSProperties }) {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(open);

  useEffect(() => {
    let frame: number | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    if (open) {
      setMounted(true);
      setVisible(false);
      frame = window.requestAnimationFrame(() => {
        frame = window.requestAnimationFrame(() => setVisible(true));
      });
    } else {
      setVisible(false);
      timeout = setTimeout(() => setMounted(false), DROPDOWN_ANIMATION_MS);
    }

    return () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      if (timeout) clearTimeout(timeout);
    };
  }, [open]);

  if (!mounted) return null;

  return (
    <div
      style={{
        ...style,
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0) scale(1)" : "translateY(-8px) scale(0.96)",
        transformOrigin: "top center",
        transition: `opacity ${DROPDOWN_ANIMATION_MS}ms ease, transform ${DROPDOWN_ANIMATION_MS}ms ease`,
        pointerEvents: open ? "auto" : "none",
      }}
    >
      {children}
    </div>
  );
}



const SCRAMBLE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";

function useScramble(target: string, running: boolean): string {
  const [display, setDisplay] = useState(target);
  const frameRef = useRef<number | null>(null);
  const iterRef = useRef(0);

  useEffect(() => {
    if (!running) {
      setDisplay(target);
      return;
    }
    iterRef.current = 0;
    const totalFrames = target.length * 4;

    const step = () => {
      iterRef.current += 1;
      const progress = iterRef.current / totalFrames;
      const resolved = Math.floor(progress * target.length);

      setDisplay(
        target
          .split("")
          .map((char, i) => {
            if (char === " ") return " ";
            if (i < resolved) return char;
            return SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
          })
          .join("")
      );

      if (iterRef.current < totalFrames) {
        frameRef.current = requestAnimationFrame(step);
      } else {
        setDisplay(target);
      }
    };

    frameRef.current = requestAnimationFrame(step);
    return () => { if (frameRef.current) cancelAnimationFrame(frameRef.current); };
  }, [target, running]);

  return display;
}

function PiWebTitle() {
  const [showVersion, setShowVersion] = useState(false);
  const [scrambling, setScrambling] = useState(false);
  const revertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const target = showVersion ? `${process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0"}p${process.env.NEXT_PUBLIC_PI_VERSION ?? "0.0.0"}` : "Pi Web";
  const display = useScramble(target, scrambling);

  const triggerScramble = useCallback((toVersion: boolean) => {
    setShowVersion(toVersion);
    setScrambling(true);
    setTimeout(() => setScrambling(false), (toVersion ? 6 : 8) * 4 * (1000 / 60) + 100);
  }, []);

  const handleClick = useCallback(() => {
    if (revertTimerRef.current) clearTimeout(revertTimerRef.current);

    const next = !showVersion;
    triggerScramble(next);

    if (next) {
      revertTimerRef.current = setTimeout(() => triggerScramble(false), 3000);
    }
  }, [showVersion, triggerScramble]);

  useEffect(() => () => { if (revertTimerRef.current) clearTimeout(revertTimerRef.current); }, []);

  return (
    <button
      onClick={handleClick}
      style={{
        background: "none", border: "none", padding: 0, cursor: "default",
        fontWeight: 700, fontSize: 15, letterSpacing: "-0.01em",
        color: showVersion ? "var(--accent)" : "var(--text)",
        fontFamily: "var(--font-mono)",
        minWidth: "6ch",
      }}
    >
      {display}
    </button>
  );
}

export function SessionSidebar({ selectedSessionId, highlightSessionId, followHighlightIntoView, onSelectSession, onNewSession, initialSessionId, skipInitialProjectSelection, onInitialRestoreDone, refreshKey, onSessionDeleted, selectedCwd: selectedCwdProp, onCwdChange, onOpenFile, onOpenTerminal, explorerRefreshKey, onExplorerRefresh, onAtMention, onAtMentions, onBackgroundTaskDone, onRunningSessionIdsChange, onSessionsChange, onExternalSessionChange }: Props) {
  const { t } = useI18n();
  // Split-view follow: the row highlight reads the focus-derived id when the
  // shell passes one and falls back to the classic selection otherwise.
  // selectedSessionId itself (toast suppression, unread clearing, search)
  // keeps its exact classic semantics — only the row highlight follows focus.
  const effectiveHighlightSessionId = highlightSessionId === undefined
    ? selectedSessionId
    : highlightSessionId;
  const [allSessions, setAllSessions] = useState<SessionInfo[]>([]);
  const [sessionListVersion, setSessionListVersion] = useState<number | null>(null);
  const sessionListVersionRef = useRef<number | null>(null);
  const sessionLoadIdRef = useRef(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Pull-to-refresh tracking: fires the force scan when the list is pulled
  // down past PULL_TO_REFRESH_THRESHOLD_PX while already scrolled to the top.
  const pullStartYRef = useRef<number | null>(null);
  const pullFiredRef = useRef(false);
  const [selectedCwd, setSelectedCwd] = useState<string | null>(null);
  // pi#14: the file explorer's trailing section. Written ONLY on explicit
  // workspace-selector actions (dropdown row select, custom-path commit,
  // default-directory, and the one-shot initial auto-select/URL restore) —
  // never on session clicks, pane-focus prop sync, worktree switches or
  // pinned-group [+], so the explorer stays decoupled from the session-driven
  // selectedCwd.
  const [explorerSelection, setExplorerSelection] = useState<ProjectSelection | null>(null);
  const [homeDir, setHomeDir] = useState<string>("");
  // Today's default directory (GET /api/default-cwd, no side effects).
  // Drives the shortcut-visibility rule; the click itself still goes
  // through POST, which creates and allow-lists the directory.
  const [defaultCwd, setDefaultCwd] = useState<string | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [projectFilter, setProjectFilter] = useState("");
  // Pinned projects: the store re-reads localStorage on every call, so a
  // revision counter is all the React state we need — bump it after each
  // pin/unpin and rows move immediately without a reload.
  const [pinnedRevision, setPinnedRevision] = useState(0);
  // Pinned roots confirmed missing on disk (greyed rows). Checked at most
  // once per root per sidebar mount; entries are never auto-unpinned.
  const [stalePinnedRoots, setStalePinnedRoots] = useState<ReadonlySet<string>>(() => new Set());
  const checkedPinnedRootsRef = useRef<Set<string>>(new Set());
  // Which pinned groups are expanded. Starts empty so the server prerender
  // and the first client render agree (hydration), then restores the persisted
  // state after mount — the same pattern as the explorerOpen preference.
  const [expandedGroupKeys, setExpandedGroupKeys] = useState<ReadonlySet<string>>(() => new Set());
  // Pinned groups (and their expansion state) come from localStorage, which is
  // unavailable during server rendering: the sidebar starts in its pre-feature
  // layout and hydrates the groups after mount so users with pins do not hit a
  // React hydration mismatch on a hard reload.
  const [sidebarHydrated, setSidebarHydrated] = useState(false);
  useEffect(() => {
    setSidebarHydrated(true);
    setExpandedGroupKeys(readExpandedGroupKeys());
  }, []);
  // Accordion: expanding a pinned group makes it the ONLY expanded group —
  // every other pinned group collapses. The single-key set is persisted
  // as-is, so legacy multi-key storage written by the pre-accordion version
  // simply collapses on the first expand action (no migration path).
  const expandPinnedGroup = useCallback((key: string) => {
    const next = new Set([key]);
    setExpandedGroupKeys(next);
    writeExpandedGroupKeys(next);
  }, []);
  // Listed-directory entries (the user-managed custom list), most-recently-
  // added first. The store persists each entry's path (and optional display
  // name), so a listed directory renders (and stays selectable) even when no
  // currently-loaded session resolves to it — and the store's one-time
  // migration seeds it from the legacy pinned-projects payload.
  // pinnedRevision is a deliberate refresh trigger: every store mutation
  // bumps it so the localStorage re-read runs even though the callback body
  // does not read it. Until sidebarHydrated the list stays empty (SSR
  // agreement). Declared early because selection handlers below need the
  // listed key set.
  const pinnedEntries = useMemo(
    () => (sidebarHydrated ? listCustomDirectories() : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pinnedRevision, sidebarHydrated],
  );
  const pinnedProjects = useMemo(
    () => pinnedEntries.map((entry) => ({ key: customDirectoryIdentity(entry.path), root: entry.path, displayName: entry.displayName })),
    [pinnedEntries],
  );
  // Optional per-entry display names, keyed by the same normalized identity.
  const pinnedLabelsByKey = useMemo(
    () => new Map(pinnedEntries.map((entry) => [customDirectoryIdentity(entry.path), entry.displayName])),
    [pinnedEntries],
  );
  const [customPathOpen, setCustomPathOpen] = useState(false);
  const [customPathValue, setCustomPathValue] = useState(loadLastCustomCwd);
  const [customPathError, setCustomPathError] = useState<string | null>(null);
  const [customPathValidating, setCustomPathValidating] = useState(false);
  const [validatedProject, setValidatedProject] = useState<ValidatedProject | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  // The add-directory picker (manage mode): adds a directory to the custom
  // list, registers it as an allowed file root, and can rename/remove list
  // entries and create folders from the dialog.
  const [addDirectoryOpen, setAddDirectoryOpen] = useState(false);
  const [explorerOpen, setExplorerOpen] = useState(true);
  const [explorerKey, setExplorerKey] = useState(0);
  const [explorerUploadBusy, setExplorerUploadBusy] = useState(false);
  const [fileSearchOpen, setFileSearchOpen] = useState(false);
  const [sessionSearchOpen, setSessionSearchOpen] = useState(false);
  const [sessionSearchQuery, setSessionSearchQuery] = useState("");
  const sessionSearchActive = sessionSearchOpen && Boolean(sessionSearchQuery.trim());
  const [changesCount, setChangesCount] = useState(0);
  const [changesCollapsed, setChangesCollapsed] = useState(true);
  const [explorerRefreshDone, setExplorerRefreshDone] = useState(false);
  const [runningSessionIds, setRunningSessionIds] = useState<Set<string>>(() => new Set());
  const [unreadSessionIds, setUnreadSessionIds] = useState<Set<string>>(() => loadUnreadSessionIds());
  const previousRunningSessionIdsRef = useRef<Set<string>>(new Set());
  const currentSuppressedCompletionSessionIdsRef = useRef<Set<string>>(new Set());
  const previousSuppressedCompletionSessionIdsRef = useRef<Set<string>>(new Set());
  // Once polling has delivered a snapshot it is the source of truth for
  // running state; late /api/sessions responses must not overwrite it.
  const runningPollAuthoritativeRef = useRef(false);
  // Latest selected-session external-write generation seen from the poll; a
  // rising generation means another pi process appended to the open session.
  const selectedWriteGenerationRef = useRef<{ sessionId: string; generation: number } | null>(null);
  const selectedSessionIdRef = useRef(selectedSessionId);
  selectedSessionIdRef.current = selectedSessionId;
  const onExternalSessionChangeRef = useRef(onExternalSessionChange);
  onExternalSessionChangeRef.current = onExternalSessionChange;
  const explorerRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const multiRootExplorerRef = useRef<MultiRootFileExplorerHandle>(null);

  // Virtualized session list: only the visible window of rows is mounted.
  const listScrollRef = useRef<HTMLDivElement>(null);
  const sessionPaneRef = useRef<HTMLDivElement>(null);
  const explorerSectionRef = useRef<HTMLDivElement>(null);
  const sessionPaneHeightRef = useRef(SESSION_PANE_DEFAULT_HEIGHT);
  const getDefaultSessionPaneHeight = useCallback(() => {
    if (!explorerOpen) return SESSION_PANE_DEFAULT_HEIGHT;
    const paneHeight = sessionPaneRef.current?.getBoundingClientRect().height;
    const explorerHeight = explorerSectionRef.current?.getBoundingClientRect().height;
    return paneHeight && explorerHeight
      ? Math.round((paneHeight + explorerHeight) / 2)
      : SESSION_PANE_DEFAULT_HEIGHT;
  }, [explorerOpen]);
  const getMaxSessionPaneHeight = useCallback(() => {
    if (!explorerOpen || !(selectedCwdProp || selectedCwd)) return SESSION_PANE_MAX_HEIGHT;
    const paneHeight = sessionPaneRef.current?.getBoundingClientRect().height ?? SESSION_PANE_DEFAULT_HEIGHT;
    const explorerHeight = explorerSectionRef.current?.getBoundingClientRect().height ?? EXPLORER_PANE_MIN_HEIGHT;
    return Math.max(
      SESSION_PANE_MIN_HEIGHT,
      paneHeight + explorerHeight - EXPLORER_PANE_MIN_HEIGHT,
    );
  }, [explorerOpen, selectedCwd, selectedCwdProp]);
  const sessionPaneResizer = useResizablePanel({
    ariaLabel: t("layout.resizeSidebarSections"),
    axis: "vertical",
    cssVariable: "--sidebar-session-pane-height",
    defaultWidth: SESSION_PANE_DEFAULT_HEIGHT,
    getDefaultWidth: getDefaultSessionPaneHeight,
    getMaxWidth: getMaxSessionPaneHeight,
    growthDirection: "down",
    maxWidth: SESSION_PANE_MAX_HEIGHT,
    minWidth: SESSION_PANE_MIN_HEIGHT,
    storageKey: "pi-web:sidebar-session-pane-height",
    widthRef: sessionPaneHeightRef,
  });
  const [listViewportH, setListViewportH] = useState(0);
  const [listScrollTop, setListScrollTop] = useState(0);
  const [focusedSessionId, setFocusedSessionId] = useState<string | null>(null);
  const listScrollRafRef = useRef<number | null>(null);
  const handleListScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const top = e.currentTarget.scrollTop;
    if (listScrollRafRef.current != null) return;
    listScrollRafRef.current = requestAnimationFrame(() => {
      listScrollRafRef.current = null;
      setListScrollTop(top);
    });
  }, []);
  useLayoutEffect(() => {
    const el = listScrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) setListViewportH(entry.contentRect.height);
    });
    ro.observe(el);
    setListViewportH(el.clientHeight);
    setListScrollTop(el.scrollTop);
    return () => ro.disconnect();
  }, [sessionSearchActive]);

  const loadSessions = useCallback(async (showLoading = false, force = false) => {
    const loadId = ++sessionLoadIdRef.current;
    try {
      if (showLoading) setLoading(true);
      const res = await fetch(force ? "/api/sessions?force=1" : "/api/sessions", {
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
      setSessionListVersion(data.sessionListVersion);
      setAllSessions(data.sessions);
      // Treat the fetched running set as an initial fallback only. Once the
      // lightweight poll is live, a slow session-list fetch cannot overwrite it.
      if (!runningPollAuthoritativeRef.current) {
        currentSuppressedCompletionSessionIdsRef.current = new Set(
          data.completionNotificationSuppressedSessionIds ?? [],
        );
        setRunningSessionIds(new Set(data.runningSessionIds ?? []));
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
    loadSessions(isFirst, !isFirst);
  }, [loadSessions, refreshKey]);

  // Browser storage is unavailable during server rendering. Restore the panel
  // preference after hydration so a collapsed explorer stays collapsed on reload.
  useEffect(() => {
    setExplorerOpen(loadExplorerOpen());
  }, []);

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
          recentSessionWrites?: { sessionId?: string; path: string; generation: number }[];
        };
        if (stopped || controller !== current) return;
        runningPollAuthoritativeRef.current = true;
        currentSuppressedCompletionSessionIdsRef.current = new Set(
          data.completionNotificationSuppressedSessionIds ?? [],
        );
        setRunningSessionIds(new Set(data.runningSessionIds ?? []));
        // Detect that the currently selected session was written by another
        // pi process (TUI / another pi-web window). The first observation of a
        // session only baselines its generation; subsequent rises notify the
        // app so the open chat view reloads from disk.
        const selectedId = selectedSessionIdRef.current;
        const selectedWrite = (data.recentSessionWrites ?? []).find(
          (write) => write.sessionId !== undefined && write.sessionId === selectedId,
        );
        if (selectedId && selectedWrite) {
          const previous = selectedWriteGenerationRef.current;
          if (
            previous
            && previous.sessionId === selectedId
            && selectedWrite.generation > previous.generation
          ) {
            onExternalSessionChangeRef.current?.(selectedId);
          }
          selectedWriteGenerationRef.current = {
            sessionId: selectedId,
            generation: selectedWrite.generation,
          };
        }
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
  }, [loadSessions]);

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

  // Read-only: reports today's ~/pi-cwd-<date> without creating it.
  useEffect(() => {
    fetch("/api/default-cwd").then((r) => r.json()).then((d: { cwd?: string }) => {
      if (d.cwd) setDefaultCwd(d.cwd);
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
    const match = allSessions.find((session) => (
      session.cwd === cwd || (session.projectRoot ?? session.cwd) === cwd
    ));
    return match
      ? projectSelection(match.projectRoot ?? match.cwd, workspaceKeyOf(match))
      : projectSelection(cwd, cwd);
  }, [validatedProject, allSessions, projectSelection]);

  // Accordion selection switch: when a selection moves the effective cwd
  // into a listed directory, that directory's group becomes the expanded one
  // — the previously expanded group collapses. Selecting within the currently
  // expanded group re-applies the same single-key set (no visible change);
  // unlisted targets are left alone. A worktree cwd resolves through the
  // session's server-provided projectRoot, because linked worktrees live
  // OUTSIDE their repository directory.
  const listedEntryForPath = useCallback((path: string | null | undefined): SidebarProject | null => {
    if (!path) return null;
    let best: SidebarProject | null = null;
    for (const project of pinnedProjects) {
      if (isPathInsideDirectory(project.root, path)
        && (!best || project.root.length > best.root.length)) {
        best = project;
      }
    }
    return best;
  }, [pinnedProjects]);
  const expandPinnedGroupForCwd = useCallback((cwd: string | null, projectRoot?: string | null) => {
    const entry = listedEntryForPath(cwd) ?? listedEntryForPath(projectRoot ?? null);
    if (!entry) return;
    expandPinnedGroup(entry.key);
  }, [listedEntryForPath, expandPinnedGroup]);

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

  // Sync the effective cwd to the focused session's cwd (prop). Sessions of
  // all worktrees in a project share one list, so clicking a session from
  // another worktree moves the effective cwd there. Only fires when the prop
  // value changes.
  const lastSyncedCwdPropRef = useRef<string | null>(null);
  useEffect(() => {
    if (selectedCwdProp && selectedCwdProp !== lastSyncedCwdPropRef.current) {
      lastSyncedCwdPropRef.current = selectedCwdProp;
      setSelectedCwd(selectedCwdProp);
    }
  }, [selectedCwdProp]);

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
          // One-shot initial selection (URL restore): the restored session's
          // project becomes the explorer's trailing section — resolved to the
          // project root, never a worktree cwd.
          setExplorerSelection({ root: target.projectRoot ?? target.cwd, key: workspaceKeyOf(target) });
          onSelectSession(target, true);
          return;
        }
        // Session not found — notify parent so it can show the placeholder
        onInitialRestoreDone?.();
      }
      const projects = getRecentProjects(allSessions);
      if (projects.length > 0) {
        setSelectedCwd(projects[0].root);
        // One-shot initial auto-select: the most recent project becomes the
        // explorer's trailing section on load.
        setExplorerSelection(projects[0]);
      }
    }
  }, [allSessions, selectedCwd, initialSessionId, skipInitialProjectSelection, onSelectSession, onInitialRestoreDone]);

  const commitCustomPath = useCallback(async (candidate?: string) => {
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
      setValidatedProject({
        cwd: data.cwd,
        root: data.projectRoot,
        key: data.projectKey,
      });
      saveLastCustomCwd(data.cwd);
      setCustomPathValue(data.cwd);
      setSelectedCwd(data.cwd);
      // Custom-path commit is an explicit workspace-selector action: the
      // validated project identity becomes the explorer's trailing section.
      setExplorerSelection({ root: data.projectRoot, key: data.projectKey });
      setCustomPathOpen(false);
      setDropdownOpen(false);
    } catch (e) {
      setCustomPathError(e instanceof Error ? e.message : String(e));
    } finally {
      setCustomPathValidating(false);
    }
  }, [customPathValue, customPathValidating]);

  const handleCustomPathClick = useCallback(() => {
    setCustomPathOpen(true);
    setCustomPathError(null);
    setDropdownOpen(false);
  }, []);
  const handleDefaultCwd = useCallback(async () => {
    try {
      const res = await fetch("/api/default-cwd", { method: "POST" });
      const data = await res.json() as { cwd?: string; error?: string };
      if (data.cwd) {
        setSelectedCwd(data.cwd);
        // Default-directory shortcut is an explicit workspace-selector
        // action: resolve its project identity for the explorer tail. When
        // the directory has no sessions (and no identity resolved yet),
        // fall back to a synthetic entry so the explorer's trailing
        // section always follows the click (pi#18).
        setExplorerSelection(projectFor(data.cwd) ?? syntheticProjectFor(data.cwd));
        setCustomPathOpen(false);
        setCustomPathError(null);
        setDropdownOpen(false);
      }
    } catch {
      // ignore
    }
  }, [projectFor]);

  // Close the workspace dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
        setProjectFilter("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Clicking a session moves the effective cwd to that session's worktree.
  // Done on the click path (not via the selectedCwd prop sync) so it also
  // works when the prop value won't change — e.g. re-clicking the already
  // open session after manually switching worktrees.
  const handleSelectSessionFromList = useCallback((s: SessionInfo, entryId?: string, blockIndex?: number) => {
    setAllSessions((current) => current.some((session) => session.id === s.id) ? current : [s, ...current]);
    if (s.cwd) setSelectedCwd(s.cwd);
    // Accordion: selecting a session that resolves into a listed directory
    // other than the expanded one switches the expanded group to it.
    expandPinnedGroupForCwd(s.cwd, s.projectRoot ?? null);
    onSelectSession(s, false, entryId, blockIndex);
  }, [onSelectSession, expandPinnedGroupForCwd]);

  // Toggle one pinned group's expansion; selection and cwd stay untouched.
  // Accordion: expanding makes the group the only expanded one (every other
  // pinned group collapses); collapsing is independent — it removes just
  // the toggled key and never expands another group. The new state is
  // persisted so a reload restores it.
  const handleToggleGroup = useCallback((key: string) => {
    if (expandedGroupKeys.has(key)) {
      const next = new Set(expandedGroupKeys);
      next.delete(key);
      setExpandedGroupKeys(next);
      writeExpandedGroupKeys(next);
      return;
    }
    expandPinnedGroup(key);
  }, [expandedGroupKeys, expandPinnedGroup]);

  // Group [+] starts a session rooted at the group's display root and moves
  // the effective cwd there (mirroring a dropdown row select) so subsequent
  // sidebar actions target that root. The group also expands so the new
  // session's row is visible (spec R2) — accordion-style: expanding it
  // collapses every other pinned group, and when it is already the expanded
  // group this is a no-op. Disabled for stale roots.
  const handleNewSessionInProject = useCallback((project: SidebarProject) => {
    if (stalePinnedRoots.has(project.root)) return;
    setSelectedCwd(project.root);
    expandPinnedGroup(project.key);
    onNewSession?.(newTempSessionId(), project.root);
  }, [stalePinnedRoots, onNewSession, expandPinnedGroup]);

  const recentProjects = getRecentProjects(allSessions);
  // pi#18: with listed directories set and the default directory outside that
  // set, the shortcut would point somewhere the explorer already steers away
  // from — hide it. Store mutations bump pinnedRevision, so the rule
  // re-evaluates immediately, and the default directory is compared loosely
  // (case and separators) against the listed roots.
  const showDefaultCwdShortcut = useMemo(
    () => shouldShowDefaultCwdShortcut(pinnedProjects, defaultCwd),
    [pinnedProjects, defaultCwd],
  );
  // pi#14 explorer section roots: every listed directory (list order) plus
  // the workspace selector's current selection as the trailing section. A
  // selection that resolves into a listed directory reuses that entry's
  // normalized key so identity dedupe keeps one section per directory (the
  // old key-identity dedupe now happens at this call site, because the
  // selection's stable workspace key and the entry's normalized path key
  // are different identities). Store mutations bump pinnedRevision, so a
  // removed entry's section disappears immediately with the other sections'
  // expansion state intact.
  const explorerRoots = useMemo(
    () => {
      const owning = explorerSelection ? listedEntryForPath(explorerSelection.root) : null;
      return buildExplorerRoots(pinnedProjects, owning ?? explorerSelection);
    },
    [pinnedProjects, explorerSelection, listedEntryForPath],
  );
  const showProjectFilter = recentProjects.length > 8;
  // Recent list: rows whose root resolves into a listed directory are
  // excluded — they render once, inside their directory group. Filter text
  // applies to the remainder exactly as before — the listed groups stay
  // exempt so they are always visible. Pseudo-project suppression is gone
  // with the worktree switcher: rows render with no worktree-specific
  // hiding.
  const recentUnpinnedProjects = recentProjects.filter(
    (project) => !listedEntryForPath(project.root),
  );
  const visibleProjects = projectFilter.trim()
    ? recentUnpinnedProjects.filter((project) => project.root.toLowerCase().includes(projectFilter.trim().toLowerCase()))
    : recentUnpinnedProjects;
  // Pin/unpin now operate on the custom directory store, leaving exactly
  // one user-managed list: pin adds the project root at the head, unpin
  // removes the entry (a list operation only — the disk is untouched).
  const togglePin = useCallback((root: string) => {
    if (isCustomDirectoryListed(root)) removeCustomDirectory(root);
    else addCustomDirectory(root);
    setPinnedRevision((revision) => revision + 1);
  }, []);

  // Adding a directory from the picker: append to the custom store and
  // register it as an allowed file root through the same /api/cwd/validate
  // integration the custom-path commit uses, so its files are browsable
  // immediately. Idempotent for an already-listed directory (the store moves
  // it to the head, no duplicate entry). Cancelling the dialog changes
  // nothing — only an explicit select lands here.
  const handleAddDirectory = useCallback(async (path: string) => {
    setAddDirectoryOpen(false);
    addCustomDirectory(path);
    setPinnedRevision((revision) => revision + 1);
    // A newly added directory expands immediately AND scrolls into view:
    // the list renders most-recently-added first (offset 0), so a scrolled
    // viewport would window the new group's header out — scroll to top so
    // the "New session in …" affordance is reachable without a second
    // interaction.
    expandPinnedGroup(customDirectoryIdentity(path));
    listScrollRef.current?.scrollTo({ top: 0 });
    try {
      await fetch("/api/cwd/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: path }),
      });
    } catch {
      // Best-effort: an offline failure defers root registration to the
      // next validate/commit that touches this directory.
    }
  }, []);

  // Stale pinned roots: on sidebar mount (and whenever the pinned set
  // changes), ask the server whether each pinned display root still exists
  // on disk. Roots that are gone render greyed (and are never
  // auto-unpinned); a failed check (offline, server hiccup) leaves the group
  // alone rather than greying it on a guess. The roots-key dependency keeps
  // this from re-running per render.
  const pinnedRootsKey = pinnedProjects.map((project) => project.root).join("\n");
  useEffect(() => {
    if (!pinnedRootsKey) return;
    const pending = pinnedRootsKey
      .split("\n")
      .filter((root) => root && !checkedPinnedRootsRef.current.has(root));
    if (pending.length === 0) return;
    for (const root of pending) checkedPinnedRootsRef.current.add(root);
    let cancelled = false;
    void (async () => {
      const results = await Promise.all(pending.map(async (root) => {
        try {
          const response = await fetch("/api/cwd/validate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ cwd: root }),
          });
          return { root, exists: response.ok };
        } catch {
          return { root, exists: true };
        }
      }));
      if (cancelled) return;
      setStalePinnedRoots((previous) => {
        let changed = false;
        const next = new Set(previous);
        for (const { root, exists } of results) {
          if (!exists && !next.has(root)) { next.add(root); changed = true; }
          if (exists && next.has(root)) { next.delete(root); changed = true; }
        }
        return changed ? next : previous;
      });
      // Roots that are currently missing stay eligible for re-checking, so a
      // directory that comes back un-greys on the next check.
      for (const { root, exists } of results) {
        if (!exists) checkedPinnedRootsRef.current.delete(root);
      }
    })();
    return () => { cancelled = true; };
  }, [pinnedRootsKey]);

  // Sessions of every worktree in the selected project are shown together
  const selectedProject = projectFor(selectedCwd);

  // On load, the selected directory's group starts expanded; other groups
  // start collapsed unless its persisted state says otherwise. Fires once,
  // as soon as the selection resolves into a listed directory.
  const autoExpandedGroupRef = useRef(false);
  useEffect(() => {
    if (autoExpandedGroupRef.current) return;
    const entry = listedEntryForPath(selectedCwd)
      ?? listedEntryForPath(selectedProject?.root ?? null);
    if (!entry) return;
    autoExpandedGroupRef.current = true;
    // Accordion: the auto-expand replaces the persisted set, so a persisted
    // different group (or legacy multi-key storage) collapses to this one.
    expandPinnedGroup(entry.key);
    // expandedGroupKeys is deliberately excluded: the ref guard makes this a
    // one-shot effect and reading it here would restart on every toggle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCwd, selectedProject, listedEntryForPath]);

  // Per-project activity counts (running / unread) for the workspace selector.
  // Uses the same stable server key as the project list and filtering.
  const projectActivity = useMemo(
    () => getProjectActivity(allSessions, runningSessionIds, unreadSessionIds),
    [allSessions, runningSessionIds, unreadSessionIds],
  );

  // Any activity in a project other than the one currently selected — shown as
  // a dot on the (collapsed) selector button so it is visible without opening
  // the dropdown.
  const hasOtherWorkspaceActivity = useMemo(
    () => [...projectActivity.entries()].some(
      ([key, { running, unread }]) => key !== selectedProject?.key && (running > 0 || unread > 0),
    ),
    [projectActivity, selectedProject],
  );

  // The main list below the listed groups keeps its existing filtering
  // rules, minus the sessions grouped under a listed directory — those
  // render only inside their group, so a listed directory's sessions never
  // appear twice. Recomputed per render, exactly like the pre-group session
  // list was.
  const filteredSessions = selectedProject
    ? sessionsForProject(allSessions, selectedProject.key)
    : allSessions;
  // Session families per listed directory. sessionsForDirectory groups by
  // path containment (plus the server-resolved project root), so sessions
  // in any git worktree of a listed repository and sessions in non-git
  // directories both land under their listed entry — no workspace-key,
  // pseudo-project or worktree-specific filtering.
  const familiesByProject = new Map<string, SessionFamily[]>();
  const groupedSessionIds = new Set<string>();
  for (const project of pinnedProjects) {
    const families = listSessionFamilies(sessionsForDirectory(allSessions, project.root));
    familiesByProject.set(project.key, families);
    for (const family of families) {
      groupedSessionIds.add(family.root.id);
      for (const subagent of family.subagents) groupedSessionIds.add(subagent.id);
    }
  }
  const mainFamilies = listSessionFamilies(
    filteredSessions.filter((session) => !groupedSessionIds.has(session.id)),
  );
  // Per-group activity counts (running / unread), aggregated over the
  // directory's grouped sessions and keyed by the entry's normalized path
  // identity — the group keys, not the workspace keys the dropdown uses.
  const groupActivity = new Map<string, { running: number; unread: number }>();
  for (const project of pinnedProjects) {
    let running = 0;
    let unread = 0;
    for (const family of familiesByProject.get(project.key) ?? []) {
      for (const session of [family.root, ...family.subagents]) {
        if (runningSessionIds.has(session.id)) running += 1;
        if (unreadSessionIds.has(session.id)) unread += 1;
      }
    }
    groupActivity.set(project.key, { running, unread });
  }
  // One flat row array with cumulative offsets for the whole scroll area.
  const sidebarRows = buildSidebarRows({
    pinnedProjects,
    familiesByProject,
    expandedKeys: expandedGroupKeys,
    mainFamilies,
  });
  // Group rows by owning project, for the per-group content containers.
  // Headers never enter (their groupKey slot is null), so the value type
  // excludes GroupHeaderRow and the container render can narrow to
  // session vs empty hint alone.
  const groupRowsByKey = new Map<string, (SessionRow | GroupEmptyRow)[]>();
  for (const row of sidebarRows) {
    if (row.kind === "groupHeader") continue;
    const groupKey = row.groupKey;
    if (!groupKey) continue;
    const list = groupRowsByKey.get(groupKey);
    if (list) list.push(row);
    else groupRowsByKey.set(groupKey, [row]);
  }
  const visibleSidebarRows = getWindowedRows(sidebarRows, listScrollTop, listViewportH, focusedSessionId);

  // --- Split-view highlight follow (this wi) ---
  // When the focus-derived highlight changes while the follow gate is on,
  // reveal that session's row: expand its collapsed pinned group (accordion,
  // same single-key helper as click-driven expansion) and scroll the row
  // into view through the offset-based row model — no DOM node needed. The
  // effect fires ONLY on a highlight change: never on mount, never on
  // session-list refreshes that leave the highlight alone, so it never
  // fights the user's manual scrolling. With the gate off (classic layout,
  // mobile) there are zero new scroll/expansion side effects.
  const applyFollowScroll = useCallback((rows: readonly SidebarRow[], sessionId: string) => {
    const el = listScrollRef.current;
    if (!el) return;
    const target = scrollTargetForSession(rows, sessionId, el.clientHeight, el.scrollTop);
    if (target != null) el.scrollTop = target;
    // The programmatic write rides the existing onScroll → rAF →
    // setListScrollTop path, remounting the correct windowed slice.
  }, []);
  const lastSeenHighlightIdRef = useRef<string | null | undefined>(undefined);
  const pendingFollowScrollSessionIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (lastSeenHighlightIdRef.current === undefined) {
      // First observation (mount): baseline the highlight without scrolling.
      lastSeenHighlightIdRef.current = effectiveHighlightSessionId;
      return;
    }
    const changed = lastSeenHighlightIdRef.current !== effectiveHighlightSessionId;
    lastSeenHighlightIdRef.current = effectiveHighlightSessionId;
    if (!followHighlightIntoView || !changed || effectiveHighlightSessionId == null) return;
    // Pane ids are family roots in practice; a subagent id resolves to its
    // root's row so the scroll math addresses a real row.
    const family = getSessionFamily(allSessions, effectiveHighlightSessionId);
    if (!family) return;
    const rootId = family.root.id;
    // A stale queued scroll must never win over a newer highlight.
    pendingFollowScrollSessionIdRef.current = null;
    const owningProject = pinnedProjects.find((project) =>
      (familiesByProject.get(project.key) ?? []).some((f) => f.root.id === rootId));
    if (owningProject && !expandedGroupKeys.has(owningProject.key)) {
      // The row hides inside a collapsed pinned group. Expand it now, but
      // queue the scroll: the DOM height still describes the pre-expansion
      // rows, so a synchronous scrollTop write would clamp short. The
      // pending effect below applies it once the rebuilt row model lands.
      expandPinnedGroup(owningProject.key);
      pendingFollowScrollSessionIdRef.current = rootId;
      return;
    }
    applyFollowScroll(sidebarRows, rootId);
    // Rows, families and the sessions catalog are render products of the
    // dependency inputs; listing them would re-scroll on list churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveHighlightSessionId, followHighlightIntoView]);
  // Applies a queued expansion scroll once the row model reflects it.
  useEffect(() => {
    const pendingId = pendingFollowScrollSessionIdRef.current;
    if (!pendingId) return;
    if (!sidebarRows.some((row) => row.kind === "session" && row.family.root.id === pendingId)) {
      return; // the expand re-render has not rebuilt the rows yet
    }
    pendingFollowScrollSessionIdRef.current = null;
    applyFollowScroll(sidebarRows, pendingId);
  });
  // One session row, shared by the main list and pinned groups: identical
  // selection behavior — the effective cwd moves to the session's worktree.
  const renderSessionRow = (family: SessionFamily) => {
    const familySessions = [family.root, ...family.subagents];
    const displaySession = family.latestModified === family.root.modified
      ? family.root
      : { ...family.root, modified: family.latestModified };
    return (
      <SessionItem
        session={displaySession}
        isSelected={familySessions.some((session) => session.id === effectiveHighlightSessionId)}
        isRunning={familySessions.some((session) => runningSessionIds.has(session.id))}
        isUnread={familySessions.some((session) => unreadSessionIds.has(session.id))}
        onClick={() => handleSelectSessionFromList(family.root)}
        onRenamed={loadSessions}
        onDeleted={(id) => {
          onSessionDeleted?.(id);
          loadSessions();
        }}
      />
    );
  };

  return (
    <div
      ref={sessionPaneResizer.panelRef}
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
        "--sidebar-session-pane-height": `${sessionPaneResizer.width}px`,
      } as CSSProperties}
    >
      {customPathOpen && (
        <DirectoryPicker
          initialPath={customPathValue}
          busy={customPathValidating}
          error={customPathError}
          onCancel={() => {
            setCustomPathOpen(false);
            setCustomPathError(null);
          }}
          onSelect={(path) => void commitCustomPath(path)}
        />
      )}
      {/* Add-directory picker (manage mode): select adds the directory to
          the custom list and registers it as an allowed file root; the
          dialog's manage callbacks run the same store operations as the
          group-header affordances, so create/delete/modify work from both
          surfaces. */}
      {addDirectoryOpen && (
        <DirectoryPicker
          initialPath={customPathValue || homeDir || undefined}
          entries={pinnedEntries.map((entry) => ({ path: entry.path, displayName: entry.displayName }))}
          onRenameEntry={(path, displayName) => {
            renameCustomDirectory(path, displayName);
            setPinnedRevision((revision) => revision + 1);
          }}
          onRemoveEntry={(path) => {
            removeCustomDirectory(path);
            setPinnedRevision((revision) => revision + 1);
          }}
          onSelect={(path) => void handleAddDirectory(path)}
          onCancel={() => setAddDirectoryOpen(false)}
        />
      )}
      {/* Header */}
      <div
        style={{
          padding: "12px 10px 10px",
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <PiWebTitle />
          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              onClick={() => {
                void loadSessions(false, true);
              }}
              title={t("sidebar.refresh")}
              aria-label={t("sidebar.refresh")}
              className="flex h-[32px] w-[32px] shrink-0 cursor-pointer items-center justify-center rounded-[7px] border border-border bg-bg-hover text-text-muted hover:bg-bg-selected focus-visible:outline-2 focus-visible:outline-accent"
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-selected)"; e.currentTarget.style.color = "var(--text)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text-muted)"; }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 12a9 9 0 1 1-2.64-6.36L21 8" />
                <path d="M21 3v5h-5" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => {
                setSessionSearchOpen((open) => !open);
              }}
              title={t("sidebar.toggleSessionSearch")}
              aria-label={t("sidebar.toggleSessionSearch")}
              aria-expanded={sessionSearchOpen}
              aria-controls="session-search-input"
              className={`flex h-[32px] w-[32px] shrink-0 cursor-pointer items-center justify-center rounded-[7px] border border-border hover:bg-bg-selected focus-visible:outline-2 focus-visible:outline-accent ${sessionSearchOpen ? "bg-bg-selected text-accent" : "bg-bg-hover text-text-muted"}`}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" />
              </svg>
            </button>
          </div>
        </div>

        {/* CWD picker */}
        <div ref={dropdownRef} style={{ position: "relative" }}>
          <button
            onClick={() => setDropdownOpen((v) => !v)}
            data-cwd-picker="true"
            title={selectedProject?.root ?? selectedCwd ?? ""}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              padding: "6px 10px",
              background: selectedCwd ? "var(--bg-hover)" : "rgba(37,99,235,0.06)",
              border: selectedCwd ? "1px solid var(--border)" : "1px solid rgba(37,99,235,0.4)",
              borderRadius: 7,
              cursor: "pointer",
              fontSize: 12,
              color: "var(--text)",
              textAlign: "left",
              transition: "border-color 0.15s, background 0.15s",
            }}
          >
            {selectedCwd ? (
              <PathLabel
                text={displayCwd(selectedProject?.root ?? selectedCwd, homeDir)}
                style={{
                  flex: 1,
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  color: "var(--text)",
                }}
              />
            ) : (
              <span
                style={{
                  flex: 1,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  color: "var(--text-dim)",
                }}
              >
                 {initialSessionId && !restoredRef.current ? "" : t("sidebar.selectProject")}
              </span>
            )}
            {hasOtherWorkspaceActivity && (
              <span
                title={t("sidebar.newActivity")}
                aria-label={t("sidebar.newActivity")}
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  flexShrink: 0,
                  marginLeft: 6,
                  background: "var(--accent)",
                }}
              />
            )}
          </button>

          <AnimatedDropdown
            open={dropdownOpen}
            style={{
              position: "absolute",
              top: "calc(100% + 4px)",
              left: 0,
              right: 0,
              zIndex: 100,
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              boxShadow: "0 6px 20px rgba(0,0,0,0.10)",
              overflow: "hidden",
            }}
          >
              {showProjectFilter && (
                <div style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>
                  <input
                    value={projectFilter}
                    onChange={(e) => setProjectFilter(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        setProjectFilter("");
                        setDropdownOpen(false);
                      }
                    }}
                     placeholder={t("sidebar.filterProjects")}
                    autoFocus
                    style={{
                      width: "100%",
                      fontSize: 11,
                      fontFamily: "var(--font-mono)",
                      padding: "5px 8px",
                      border: "1px solid var(--border)",
                      borderRadius: 5,
                      outline: "none",
                      background: "var(--bg)",
                      color: "var(--text)",
                      boxSizing: "border-box",
                    }}
                  />
                </div>
              )}
              <div style={{ maxHeight: "min(50vh, 380px)", overflowY: "auto" }}>
                {/* Pinned projects render as expandable groups in the session
                    list above; the dropdown keeps only recent (unpinned)
                    rows, each with its pin toggle. */}
                {visibleProjects.map((project) => (
                  <ProjectRow
                    key={project.key}
                    project={project}
                    selected={project.key === selectedProject?.key}
                    pinned={false}
                    activity={projectActivity.get(project.key)}
                    homeDir={homeDir}
                    t={t}
                    onSelect={() => {
                      setSelectedCwd(project.root);
                      // Accordion: if this selection resolves to a pinned
                      // project, that group becomes the expanded one.
                      expandPinnedGroupForCwd(project.root);
                      // Dropdown row select is an explicit workspace-selector
                      // action: this project becomes the explorer's trailing
                      // section (deduped against pins by its stable key).
                      setExplorerSelection(project);
                      setProjectFilter("");
                      setCustomPathOpen(false);
                      setCustomPathError(null);
                      setDropdownOpen(false);
                    }}
                    onTogglePin={() => togglePin(project.root)}
                  />
                ))}
                {visibleProjects.length === 0 && projectFilter.trim() && (
                   <div style={{ padding: "8px 10px", fontSize: 11, color: "var(--text-dim)" }}>{t("sidebar.noMatchingProjects")}</div>
                )}
              </div>

              {/* Default cwd shortcut — hidden while listed directories exist
                  and none of them is the default directory (pi#18) */}
              {!customPathOpen && showDefaultCwdShortcut && (
                <button
                  onClick={(e) => { e.stopPropagation(); handleDefaultCwd(); }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                    width: "100%",
                    padding: "8px 10px",
                    background: "none",
                    border: "none",
                    borderTop: visibleProjects.length > 0 ? "1px solid var(--border)" : "none",
                    color: "var(--text-muted)",
                    cursor: "pointer",
                    textAlign: "left",
                    fontSize: 11,
                  }}
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                    <path d="M1 3A1 1 0 0 1 2 2H4L5 3.5H8.5a.5.5 0 0 1 .5.5v4a.5.5 0 0 1-.5.5h-7A.5.5 0 0 1 1 8V3Z" />
                  </svg>
                   <span>{t("sidebar.useDefaultDirectory")}</span>
                </button>
              )}

              {/* Custom path directory picker */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleCustomPathClick();
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  width: "100%",
                  padding: "8px 10px",
                  background: "none",
                  border: "none",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                  textAlign: "left",
                  fontSize: 11,
                }}
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" style={{ flexShrink: 0 }}>
                  <line x1="5" y1="1" x2="5" y2="9" />
                  <line x1="1" y1="5" x2="9" y2="5" />
                </svg>
                <span>{t("sidebar.customPath")}</span>
              </button>
          </AnimatedDropdown>
        </div>

        {sessionSearchOpen && (
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
              if (event.key === "Escape") {
                event.stopPropagation();
                setSessionSearchQuery("");
              }
            }}
            className="mt-[6px] block h-[29px] w-full min-w-0 rounded-[7px] border border-border bg-bg px-[10px] text-xs text-text focus:outline-2 focus:outline-accent"
          />
        )}

        {/* Add directory — opens the picker dialog in manage mode: selecting
            a directory adds it to the user-managed list (and registers it as
            an allowed file root), and the dialog can also create folders and
            rename/remove list entries. */}
        {!sessionSearchOpen && (
          <button
            type="button"
            onClick={() => setAddDirectoryOpen(true)}
            title={t("sidebar.addDirectory")}
            aria-label={t("sidebar.addDirectory")}
            style={{
              width: "100%",
              height: 29,
              boxSizing: "border-box",
              marginTop: 6,
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "0 10px",
              border: "1px dashed var(--border)",
              borderRadius: 7,
              background: "var(--bg-hover)",
              color: "var(--text-muted)",
              fontSize: 11,
              lineHeight: 1.35,
              whiteSpace: "nowrap",
              textAlign: "left",
              cursor: "pointer",
            }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
              <path d="M1.5 3h4l1.5 2h7.5v7.5h-13z" />
            </svg>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{t("sidebar.addDirectory")}</span>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" style={{ flexShrink: 0, marginLeft: "auto" }} aria-hidden="true">
              <line x1="5" y1="1" x2="5" y2="9" />
              <line x1="1" y1="5" x2="9" y2="5" />
            </svg>
          </button>
        )}
      </div>

      {/* Session list — upstream #825 resizable panes: the list pane adopts the
          computed height whenever the explorer pane is open; pi#14 keeps the
          explorer mounted with or without a selected cwd, so no cwd condition. */}
      <div
        ref={sessionPaneRef}
        style={{
          display: "flex",
          flexDirection: "column",
          flex: explorerOpen
            ? "0 1 var(--sidebar-session-pane-height, 320px)"
            : "1 1 auto",
          minHeight: SESSION_PANE_MIN_HEIGHT,
          overflow: "hidden",
        }}
      >
        <SessionSearch open={sessionSearchOpen} query={sessionSearchQuery} refreshKey={sessionListVersion} selectedSessionId={selectedSessionId} onSelectSession={handleSelectSessionFromList}>
        <div
          ref={listScrollRef}
          onScroll={handleListScroll}
          onTouchStart={(event) => {
            const el = listScrollRef.current;
            if (!el || el.scrollTop > 0) return;
            pullStartYRef.current = event.touches[0]?.clientY ?? null;
            pullFiredRef.current = false;
          }}
          onTouchMove={(event) => {
            const startY = pullStartYRef.current;
            if (startY == null || pullFiredRef.current) return;
            const deltaY = (event.touches[0]?.clientY ?? startY) - startY;
            if (deltaY > 64) {
              pullFiredRef.current = true;
              void loadSessions(false, true);
            }
          }}
          onTouchEnd={() => {
            pullStartYRef.current = null;
            pullFiredRef.current = false;
          }}
          style={{
            flex: "1 1 auto",
            minHeight: 0,
            overflowY: "auto",
            padding: "0",
          }}
        >
        {loading && (
          <div style={{ padding: "16px 14px", color: "var(--text-muted)", fontSize: 12 }}>
            {t("sidebar.loading")}
          </div>
        )}
        {error && (
          <div style={{ padding: "12px 14px", color: "#f87171", fontSize: 12 }}>
            {error}
          </div>
        )}
        {!loading && !error && sidebarRows.length === 0 && (
          <div style={{ padding: "16px 14px", color: "var(--text-muted)", fontSize: 12 }}>
            {t("sidebar.noSessions")}
          </div>
        )}
        {sidebarRows.length > 0 && (
          <div
            style={{
              position: "relative",
              height: sidebarRowsHeight(sidebarRows),
            }}
          >
            {/* Pinned-group content containers — one per expanded group, so
                each header's aria-controls points at its own region. Only
                the windowed rows inside are mounted. */}
            {pinnedProjects.map((project) => {
              if (!expandedGroupKeys.has(project.key)) return null;
              const groupRows = groupRowsByKey.get(project.key) ?? [];
              if (groupRows.length === 0) return null;
              const contentTop = groupRows[0].offset;
              const last = groupRows[groupRows.length - 1];
              const contentHeight = last.offset + last.height - contentTop;
              return (
                <div
                  key={`group-content:${project.key}`}
                  id={pinnedGroupContentId(project.key)}
                  style={{ position: "absolute", top: contentTop, left: 0, right: 0, height: contentHeight }}
                >
                  {groupRows
                    .filter((row) => visibleSidebarRows.includes(row))
                    .map((row) => (
                      row.kind === "groupEmpty" ? (
                        <div
                          key={row.key}
                          style={{
                            position: "absolute",
                            top: row.offset - contentTop,
                            left: 0,
                            right: 0,
                            height: row.height,
                            display: "flex",
                            alignItems: "center",
                            paddingLeft: 28,
                            fontSize: 11,
                            color: "var(--text-dim)",
                          }}
                        >
                          {t("sidebar.pinnedGroupNoSessions")}
                        </div>
                      ) : (
                        <div
                          key={row.key}
                          onFocus={() => setFocusedSessionId(row.family.root.id)}
                          onBlur={() => setFocusedSessionId(null)}
                          style={{ position: "absolute", top: row.offset - contentTop, left: 0, right: 0 }}
                        >
                          {renderSessionRow(row.family)}
                        </div>
                      )
                    ))}
                </div>
              );
            })}
            {visibleSidebarRows.map((row) => {
              if (row.kind === "groupHeader") {
                return (
                  <div
                    key={row.key}
                    style={{ position: "absolute", top: row.offset, left: 0, right: 0, height: row.height }}
                  >
                    <PinnedGroupHeader
                      project={row.project}
                      label={pinnedLabelsByKey.get(row.project.key)}
                      expanded={expandedGroupKeys.has(row.project.key)}
                      stale={stalePinnedRoots.has(row.project.root)}
                      activity={groupActivity.get(row.project.key)}
                      homeDir={homeDir}
                      t={t}
                      onToggle={() => handleToggleGroup(row.project.key)}
                      onUnpin={() => togglePin(row.project.root)}
                      onRename={(name) => {
                        // Rename edits the list entry's displayName; an empty
                        // value clears it, falling back to the path-derived
                        // label. List operation only — the disk is untouched.
                        renameCustomDirectory(row.project.root, name);
                        setPinnedRevision((revision) => revision + 1);
                      }}
                      onNewSession={() => handleNewSessionInProject(row.project)}
                    />
                  </div>
                );
              }
              // Group session rows render inside their group container above.
              if (row.kind !== "session" || row.groupKey !== null) return null;
              const family = row.family;
              // Bubble blur after the input's save handler before unpinning the row.
              return (
                <div
                  key={family.root.id}
                  onFocus={() => setFocusedSessionId(family.root.id)}
                  onBlur={() => setFocusedSessionId(null)}
                  style={{ position: "absolute", top: row.offset, left: 0, right: 0 }}
                >
                  {renderSessionRow(family)}
                </div>
              );
            })}
          </div>
        )}
        </div>
        </SessionSearch>
      </div>

      {explorerOpen && (
        <div
          className={`sidebar-section-resize-handle${sessionPaneResizer.isResizing ? " is-resizing" : ""}`}
          data-resize-handle="sidebar-sections"
          title={`${t("layout.resizeSidebarSections")}: ${t("layout.resizeHeightHint")}`}
          style={{
            position: "relative",
            zIndex: 20,
            width: "100%",
            height: 12,
            margin: "-6px 0",
            flex: "0 0 12px",
            cursor: "row-resize",
            touchAction: "none",
          }}
          {...sessionPaneResizer.separatorProps}
        />
      )}

      {/* File Explorer section — pi#14: always mounted (upstream gates on a
          selected cwd; the multi-root explorer takes roots from pinned projects
          too). The section ref feeds the #825 pane-height computation. */}
      <div
        ref={explorerSectionRef}
          style={{
            borderTop: "1px solid var(--border)",
            display: "flex",
            flexDirection: "column",
            flex: explorerOpen ? "1 1 0" : "0 0 auto",
            minHeight: explorerOpen ? EXPLORER_PANE_MIN_HEIGHT : 0,
            overflow: "hidden",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
            <button
              onClick={() => setExplorerOpen((open) => {
                const next = !open;
                saveExplorerOpen(next);
                return next;
              })}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                flex: 1,
                padding: "6px 10px",
                background: "none",
                border: "none",
                color: "var(--text-muted)",
                cursor: "pointer",
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                textAlign: "left",
              }}
            >
              <svg
                width="9" height="9" viewBox="0 0 10 10" fill="none"
                stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
                style={{ transform: explorerOpen ? "rotate(90deg)" : "none", transition: "transform 0.15s", flexShrink: 0 }}
              >
                <polyline points="3 2 7 5 3 8" />
              </svg>
              {t("files.explorer")}
            </button>
            {onOpenTerminal && (
              <ToolbarIconButton
                onClick={() => onOpenTerminal(selectedCwd ?? selectedCwdProp!)}
                title={t("terminal.open")}
                color="var(--text-dim)"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
                </svg>
              </ToolbarIconButton>
            )}
            {explorerOpen && changesCount > 0 && (
              <ToolbarIconButton
                onClick={() => setChangesCollapsed((v) => !v)}
                title={t("sidebar.changedFiles", { count: changesCount })}
                ariaPressed={!changesCollapsed}
                color={changesCollapsed ? "var(--text-dim)" : "var(--accent)"}
                background={changesCollapsed ? "none" : "var(--bg-selected)"}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M3 12h6" />
                  <path d="M15 12h6" />
                </svg>
              </ToolbarIconButton>
            )}
            {explorerOpen && (
              <ToolbarIconButton
                onClick={() => {
                  if (fileSearchOpen) {
                    setFileSearchOpen(false);
                    return;
                  }
                  // Opening routes through the container handle: it expands
                  // the deterministic target section first, so the search
                  // input appears even from the all-collapsed default state
                  // (review-FAIL blocker 2 — the handle was dead code before).
                  multiRootExplorerRef.current?.openFileSearch();
                }}
                disabled={explorerRoots.length === 0}
                title={t("sidebar.searchFiles")}
                ariaPressed={fileSearchOpen}
                color={fileSearchOpen ? "var(--accent)" : "var(--text-dim)"}
                background={fileSearchOpen ? "var(--bg-selected)" : "none"}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" />
                </svg>
              </ToolbarIconButton>
            )}
            {explorerOpen && (
              <ToolbarIconButton
                onClick={() => multiRootExplorerRef.current?.openUploadPicker()}
                disabled={explorerUploadBusy || explorerRoots.length === 0}
                title={t("sidebar.uploadFilesTitle")}
                color="var(--text-dim)"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <path d="m17 8-5-5-5 5" />
                  <path d="M12 3v12" />
                </svg>
              </ToolbarIconButton>
            )}
            <ToolbarIconButton
              onClick={() => {
                if (onExplorerRefresh) onExplorerRefresh();
                else setExplorerKey((k) => k + 1);
                setExplorerRefreshDone(true);
                if (explorerRefreshTimerRef.current) clearTimeout(explorerRefreshTimerRef.current);
                explorerRefreshTimerRef.current = setTimeout(() => setExplorerRefreshDone(false), 2000);
              }}
              title={t("sidebar.refreshExplorer")}
              skipHover={explorerRefreshDone}
              color={explorerRefreshDone ? "#4ade80" : "var(--text-dim)"}
              background={explorerRefreshDone ? "rgba(74,222,128,0.18)" : "none"}
              marginRight={6}
            >
              {explorerRefreshDone ? (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                  <path d="M3 3v5h5" />
                </svg>
              )}
            </ToolbarIconButton>
          </div>
          {explorerOpen && (
            <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>
              <MultiRootFileExplorer
                ref={multiRootExplorerRef}
                roots={explorerRoots}
                staleRoots={stalePinnedRoots}
                homeDir={homeDir}
                refreshKey={explorerKey}
                onOpenFile={onOpenFile ?? (() => {})}
                onAtMention={onAtMention}
                onAtMentions={onAtMentions}
                onUploadBusyChange={setExplorerUploadBusy}
                changesCollapsed={changesCollapsed}
                onChangesCountChange={setChangesCount}
                fileSearchOpen={fileSearchOpen}
                onFileSearchOpenChange={setFileSearchOpen}
              />
            </div>
          )}
        </div>
    </div>
  );
}

function RunningSessionIndicator() {
  const { t } = useI18n();
  return (
    <span
      title={t("sidebar.agentRunning")}
      aria-label={t("sidebar.agentRunning")}
      style={{
        width: 14,
        height: 14,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        color: "var(--accent)",
      }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ display: "block" }}>
        <g>
          <path
            d="M21 12a9 9 0 1 1-3.8-7.4"
            stroke="currentColor"
            strokeWidth="2.8"
            strokeLinecap="round"
          />
          <animateTransform
            attributeName="transform"
            type="rotate"
            from="0 12 12"
            to="360 12 12"
            dur="0.9s"
            repeatCount="indefinite"
          />
        </g>
      </svg>
    </span>
  );
}

function UnreadSessionIndicator() {
  const { t } = useI18n();
  return (
    <span
      title={t("sidebar.newActivity")}
      aria-label={t("sidebar.newSessionActivity")}
      style={{
        width: 14,
        height: 14,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        color: "#0891b2",
      }}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" style={{ display: "block" }}>
        <circle cx="7" cy="7" r="2.5" fill="currentColor" />
        <circle cx="7" cy="7" r="3" stroke="currentColor" strokeWidth="1.4" opacity="0.32">
          <animate attributeName="r" values="3;6;3" dur="1.6s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.32;0;0.32" dur="1.6s" repeatCount="indefinite" />
        </circle>
      </svg>
    </span>
  );
}

/**
 * Compact per-project activity badges for the workspace selector dropdown items:
 * a spinning running icon + count and an unread dot + count. Renders nothing
 * when the project has no activity. Counts share the accent / unread colors of
 * the per-session indicators so the two stay visually consistent.
 */
function showProjectActivity(
  activity: { running: number; unread: number } | undefined,
  t: (key: string) => string,
): ReactNode {
  if (!activity || (activity.running === 0 && activity.unread === 0)) return null;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, flexShrink: 0, marginLeft: 6 }}>
      {activity.running > 0 && (
        <span
          title={t("sidebar.agentRunning")}
          aria-label={`${t("sidebar.agentRunning")} (${activity.running})`}
          style={{ display: "inline-flex", alignItems: "center", gap: 3, color: "var(--accent)", fontSize: 10, fontFamily: "var(--font-mono)" }}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ display: "block" }}>
            <g>
              <path d="M21 12a9 9 0 1 1-3.8-7.4" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" />
              <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.9s" repeatCount="indefinite" />
            </g>
          </svg>
          {activity.running}
        </span>
      )}
      {activity.unread > 0 && (
        <span
          title={t("sidebar.newSessionActivity")}
          aria-label={`${t("sidebar.newSessionActivity")} (${activity.unread})`}
          style={{ display: "inline-flex", alignItems: "center", gap: 3, color: "#0891b2", fontSize: 10, fontFamily: "var(--font-mono)" }}
        >
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor", display: "inline-block" }} />
          {activity.unread}
        </span>
      )}
    </span>
  );
}

function SessionItem({
  session,
  isSelected,
  isRunning,
  isUnread,
  onClick,
  onRenamed,
  onDeleted,
  depth = 0,
  hasChildren = false,
  collapsed = false,
  onToggleCollapse,
}: {
  session: SessionInfo;
  isSelected: boolean;
  isRunning?: boolean;
  isUnread?: boolean;
  onClick: () => void;
  onRenamed?: () => void;
  onDeleted?: (id: string) => void;
  depth?: number;
  hasChildren?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const { locale, t } = useI18n();
  const [hovered, setHovered] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Select the whole name once the rename input is mounted (startRename's
  // immediate setTimeout can fire before the input exists).
  useEffect(() => {
    if (renaming) {
      const id = requestAnimationFrame(() => inputRef.current?.select());
      return () => cancelAnimationFrame(id);
    }
  }, [renaming]);

  // A stored first message may be an SDK-expanded <skill> block; collapse it
  // back to the compact /skill:name args command the user typed before using
  // it as the auto-name fallback, mirroring MessageView's rendering.
  const displayFirstMessage = skillExpansionToCommand(session.firstMessage) ?? session.firstMessage;
  const title = session.name || displayFirstMessage.slice(0, 50) || session.id.slice(0, 12);

  const startRename = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (session.transient) return;
    setRenameValue(session.name || displayFirstMessage.slice(0, 50) || session.id.slice(0, 12));
    setRenaming(true);
  }, [session.name, session.transient, displayFirstMessage, session.id]);

  const commitRename = useCallback(async () => {
    const name = renameValue.trim();
    setRenaming(false);
    // No-op when unchanged: the fallback title (first message / id) isn't a
    // real stored name, so don't persist it as one. (The rename input seeds
    // from the same collapsed displayFirstMessage, so an untouched rename of
    // a skill-invoked session stays a no-op instead of persisting raw XML.)
    if (renameValue === title || name === (session.name ?? "")) return;
    try {
      await fetch(`/api/sessions/${encodeURIComponent(session.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      onRenamed?.();
    } catch {
      // ignore
    }
  }, [renameValue, session.id, session.name, onRenamed, title]);

  const performDelete = useCallback(async () => {
    if (session.transient) return;
    setConfirmDelete(false);
    setDeleting(true);
    try {
      await fetch(`/api/sessions/${encodeURIComponent(session.id)}`, { method: "DELETE" });
      onDeleted?.(session.id);
    } catch {
      setDeleting(false);
    }
  }, [session.id, session.transient, onDeleted]);

  const handleDeleteClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (e.shiftKey) {
      void performDelete();
    } else {
      setConfirmDelete(true);
    }
  }, [performDelete]);

  const handleDeleteConfirm = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    void performDelete();
  }, [performDelete]);

  const handleDeleteCancel = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDelete(false);
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const handled = dispatchSessionRowContextMenu({
      id: session.id,
      path: session.path,
      cwd: session.cwd,
      name: session.name,
      clientX: e.clientX,
      clientY: e.clientY,
      refresh: () => { onRenamed?.(); },
    });
    if (!handled) return;
    e.preventDefault();
    e.stopPropagation();
  }, [onRenamed, session.cwd, session.id, session.name, session.path]);

  // Fixed-height outer wrapper — content swaps in place so the list never reflows
  return (
    <div
      onClick={confirmDelete || renaming ? undefined : onClick}
      onContextMenu={confirmDelete || renaming ? undefined : handleContextMenu}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); }}
      style={{
        height: SESSION_LIST_ITEM_HEIGHT,
        display: "flex",
        alignItems: "center",
        paddingLeft: depth > 0 ? depth * 12 + 14 : 14,
        paddingRight: 8,
        cursor: confirmDelete || renaming ? "default" : "pointer",
        background: confirmDelete
          ? "rgba(239,68,68,0.06)"
          : isSelected ? "var(--bg-selected)" : hovered ? "var(--bg-hover)" : "transparent",
        borderLeft: confirmDelete
          ? "2px solid #ef4444"
          : isSelected ? "2px solid var(--accent)" : "2px solid transparent",
        transition: "background 0.1s",
        opacity: deleting ? 0.5 : 1,
        gap: 6,
        overflow: "hidden",
      }}
    >
      {confirmDelete ? (
        /* ── Delete confirmation: same height, two flat buttons ── */
        <>
          <div style={{ flex: 1, minWidth: 0, fontSize: 12, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {t("sidebar.deleteSession", { title: title.slice(0, 22) + (title.length > 22 ? "…" : "") })}
          </div>
          <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
            <button
              onClick={handleDeleteConfirm}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
                height: 30, padding: "0 11px",
                background: "#ef4444", border: "none",
                borderRadius: 6, color: "#fff",
                cursor: "pointer", fontSize: 12, fontWeight: 600,
                whiteSpace: "nowrap",
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6M14 11v6" />
                <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
              </svg>
              {t("sidebar.delete")}
            </button>
            <button
              onClick={handleDeleteCancel}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                height: 30, padding: "0 11px",
                background: "var(--bg)", border: "1px solid var(--border)",
                borderRadius: 6, color: "var(--text-muted)",
                cursor: "pointer", fontSize: 12, fontWeight: 500,
                whiteSpace: "nowrap",
              }}
            >
              {t("sidebar.cancel")}
            </button>
          </div>
        </>
      ) : renaming ? (
        /* ── Rename: input fills the same row ── */
        <input
          ref={inputRef}
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename();
            if (e.key === "Escape") setRenaming(false);
          }}
          autoFocus
          style={{
            flex: 1,
            fontSize: 12,
            padding: "5px 8px",
            border: "1px solid var(--accent)",
            borderRadius: 5,
            outline: "none",
            background: "var(--bg)",
            color: "var(--text)",
            height: 30,
          }}
        />
      ) : (
        /* ── Normal view ── */
        <>
          {/* Subagent indicator for child sessions */}
          {depth > 0 && (
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <rect x="5" y="7" width="14" height="11" rx="2" />
              <path d="M9 11h.01M15 11h.01M9 15h6M12 7V4M10 4h4" />
            </svg>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                minWidth: 0,
                fontSize: 12,
                fontWeight: isSelected ? 500 : 400,
                lineHeight: 1.4,
                color: "var(--text)",
              }}
              title={title}
            >
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
                {title}
              </span>
            </div>
            <div style={{ marginTop: 2, display: "flex", alignItems: "center", gap: 8, color: "var(--text-dim)", fontSize: 11, minWidth: 0 }}>
              {isRunning ? (
                <RunningSessionIndicator />
              ) : isUnread ? (
                <UnreadSessionIndicator />
              ) : (
                <span title={session.modified}>{formatRelativeTime(session.modified, locale)}</span>
              )}
              <span>{t("sidebar.messagesCount", { count: session.messageCount })}</span>
              {session.isWorktree && session.branch && (
                <span
                  title={`Worktree: ${session.cwd}`}
                  style={{ display: "flex", alignItems: "center", gap: 3, color: "var(--accent)", minWidth: 0, overflow: "hidden" }}
                >
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                    <line x1="6" y1="3" x2="6" y2="15" />
                    <circle cx="18" cy="6" r="3" />
                    <circle cx="6" cy="18" r="3" />
                    <path d="M18 9a9 9 0 0 1-9 9" />
                  </svg>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{session.branch}</span>
                </span>
              )}
            </div>
          </div>

          {/* Collapse toggle — always visible when has children */}
          {hasChildren && (
            <button
              onClick={(e) => { e.stopPropagation(); onToggleCollapse?.(); }}
              title={t(collapsed ? "sidebar.expandSubagents" : "sidebar.collapseSubagents")}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 20, height: 20, padding: 0, flexShrink: 0,
                background: "none", border: "none",
                color: "var(--text-dim)", cursor: "pointer",
                transform: collapsed ? "rotate(-90deg)" : "none",
                transition: "transform 0.15s",
              }}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="2 3.5 5 6.5 8 3.5" />
              </svg>
            </button>
          )}

          {/* Action buttons — shown on hover */}
          {hovered && !session.transient && (
            <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
              <button
                onClick={startRename}
                title={t("sidebar.rename")}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: 32, height: 32, padding: 0,
                  background: "var(--bg-hover)", border: "1px solid var(--border)",
                  borderRadius: 7, color: "var(--text-muted)",
                  cursor: "pointer", flexShrink: 0,
                  transition: "background 0.12s, color 0.12s, border-color 0.12s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--bg-selected)";
                  e.currentTarget.style.color = "var(--accent)";
                  e.currentTarget.style.borderColor = "rgba(37,99,235,0.35)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "var(--bg-hover)";
                  e.currentTarget.style.color = "var(--text-muted)";
                  e.currentTarget.style.borderColor = "var(--border)";
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                </svg>
              </button>
              <button
                onClick={handleDeleteClick}
                title={t("sidebar.deleteWithShiftClick")}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: 32, height: 32, padding: 0,
                  background: "var(--bg-hover)", border: "1px solid var(--border)",
                  borderRadius: 7, color: "var(--text-muted)",
                  cursor: "pointer", flexShrink: 0,
                  transition: "background 0.12s, color 0.12s, border-color 0.12s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(239,68,68,0.08)";
                  e.currentTarget.style.color = "#ef4444";
                  e.currentTarget.style.borderColor = "rgba(239,68,68,0.35)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "var(--bg-hover)";
                  e.currentTarget.style.color = "var(--text-muted)";
                  e.currentTarget.style.borderColor = "var(--border)";
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  <path d="M10 11v6M14 11v6" />
                  <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                </svg>
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
