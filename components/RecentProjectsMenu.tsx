"use client";

import type { CSSProperties, ReactNode } from "react";

/**
 * Workspace-dropdown body (wi pi#47): the recent-project rows, the default
 * directory shortcut and the custom-path entry, extracted from
 * SessionSidebar as a props-only component (translation arrives via `t`,
 * exactly like ProjectRow's other consumers) so the dropdown's structure —
 * in particular the REMOVED directory filter box — is assertable by
 * rendering, not by source patterns.
 */

type Translate = (key: string) => string;

/** Substitute the home dir prefix with ~ (mirrors SessionSidebar's helper). */
function displayCwd(cwd: string, homeDir?: string): string {
  return (homeDir && cwd.startsWith(homeDir)) ? "~" + cwd.slice(homeDir.length) : cwd;
}

/**
 * Path label that ellipsizes on the LEFT, keeping the (most relevant) trailing
 * segments visible. The rtl container moves the ellipsis to the left edge;
 * the inner plaintext bidi isolation keeps the path itself rendered strictly
 * left-to-right. (Local copy so this component stays decoupled from
 * SessionSidebar's module graph.)
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

/** Pushpin glyph for the pin affordance; filled when pinned. */
function PinIcon({ pinned }: { pinned: boolean }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill={pinned ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block" }}>
      <path d="M3.6 1h2.8l-.4 2.6 1.5 1.4v.8H2.5v-.8L4 3.6z" />
      <line x1="5" y1="5.8" x2="5" y2="9" />
    </svg>
  );
}

function showProjectActivity(
  activity: { running: number; unread: number } | undefined,
  t: Translate,
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
  t: Translate;
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

export interface RecentProjectsMenuProps {
  t: Translate;
  /** Recent (unlisted) projects, rendered unfiltered — the filter box is gone. */
  projects: ReadonlyArray<{ key: string; root: string }>;
  selectedKey?: string | null;
  activityByKey?: ReadonlyMap<string, { running: number; unread: number } | undefined>;
  homeDir: string;
  showDefaultCwdShortcut: boolean;
  customPathOpen: boolean;
  onSelectProject: (project: { key: string; root: string }) => void;
  onTogglePin: (root: string) => void;
  onUseDefaultCwd: () => void;
  onCustomPathClick: () => void;
}

export function RecentProjectsMenu({
  t,
  projects,
  selectedKey,
  activityByKey,
  homeDir,
  showDefaultCwdShortcut,
  customPathOpen,
  onSelectProject,
  onTogglePin,
  onUseDefaultCwd,
  onCustomPathClick,
}: RecentProjectsMenuProps) {
  return (
    <div className="recent-projects-menu">
      <div style={{ maxHeight: "min(50vh, 380px)", overflowY: "auto" }}>
        {/* Pinned projects render as expandable groups in the session list
            above; the dropdown keeps only recent (unpinned) rows, each with
            its pin toggle — every row renders, with no filter in between. */}
        {projects.map((project) => (
          <ProjectRow
            key={project.key}
            project={project}
            selected={project.key === selectedKey}
            pinned={false}
            activity={activityByKey?.get(project.key)}
            homeDir={homeDir}
            t={t}
            onSelect={() => onSelectProject(project)}
            onTogglePin={() => onTogglePin(project.root)}
          />
        ))}
      </div>

      {/* Default cwd shortcut — hidden while listed directories exist
          and none of them is the default directory (pi#18) */}
      {!customPathOpen && showDefaultCwdShortcut && (
        <button
          onClick={(e) => { e.stopPropagation(); onUseDefaultCwd(); }}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            width: "100%",
            padding: "8px 10px",
            background: "none",
            border: "none",
            borderTop: projects.length > 0 ? "1px solid var(--border)" : "none",
            color: "var(--text-muted)",
            cursor: "pointer",
            textAlign: "left",
            fontSize: 11,
          }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" style={{ flexShrink: 0 }}>
            <path d="M1 3A1 1 0 0 1 2 2H4L5 3.5H8.5a.5.5 0 0 1 .5.5v4a.5.5 0 0 1-.5.5h-7A.5.5 0 0 1 1 8V3Z" />
          </svg>
          <span>{t("sidebar.useDefaultDirectory")}</span>
        </button>
      )}

      {/* Custom path directory picker */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onCustomPathClick();
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
    </div>
  );
}
