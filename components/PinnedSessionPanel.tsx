"use client";

import { useMemo } from "react";
import type { SessionInfo } from "@/lib/types";
import { formatRelativeTime } from "@/lib/i18n/format";
import { useI18n } from "@/hooks/useI18n";

interface Props {
  sessions: SessionInfo[];
  runningSessionIds: ReadonlySet<string>;
  selectedSessionId: string | null;
  onSelectSession: (session: SessionInfo) => void;
  onTogglePinned: (sessionId: string) => void;
}

function sessionTitle(session: SessionInfo): string {
  return session.name || session.firstMessage?.trim() || session.id.slice(0, 12);
}

function RunningIcon({ size = 15 }: { size?: number }) {
  return (
    <svg className="animate-spin" width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity="0.25" />
      <path d="M21 12a9 9 0 0 1-9 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function PinIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 3h10v4l2 3v2h-5v8l-2 2-2-2v-8H5v-2l2-3V3Z" />
    </svg>
  );
}

function PinnedSessionRow({
  session,
  running,
  selected,
  onSelect,
  onTogglePinned,
}: {
  session: SessionInfo;
  running: boolean;
  selected: boolean;
  onSelect: () => void;
  onTogglePinned: () => void;
}) {
  const { locale, t } = useI18n();
  const title = sessionTitle(session);
  const location = session.projectRoot ?? session.cwd;

  return (
    <div
      role="option"
      aria-selected={selected}
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) 32px",
        alignItems: "stretch",
        borderBottom: "1px solid var(--border)",
        borderLeft: selected ? "2px solid var(--accent)" : "2px solid transparent",
        background: selected ? "var(--bg-selected)" : "transparent",
      }}
    >
      <button
        type="button"
        onClick={onSelect}
        style={{
          minHeight: 58,
          minWidth: 0,
          display: "grid",
          gridTemplateColumns: "28px minmax(0, 1fr) auto",
          alignItems: "center",
          gap: 9,
          padding: "8px 6px 8px 10px",
          border: "none",
          background: "transparent",
          color: "var(--text)",
          cursor: "pointer",
          textAlign: "left",
        }}
        onMouseEnter={(event) => {
          if (!selected) event.currentTarget.parentElement!.style.background = "var(--bg-hover)";
        }}
        onMouseLeave={(event) => {
          if (!selected) event.currentTarget.parentElement!.style.background = "transparent";
        }}
      >
        <span style={{ width: 28, height: 28, display: "grid", placeItems: "center", color: running ? "var(--accent)" : "var(--text-muted)" }}>
          {running ? <RunningIcon /> : <PinIcon />}
        </span>
        <span style={{ minWidth: 0 }}>
          <span
            style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, fontWeight: selected ? 600 : 500 }}
            title={title}
          >
            {title}
          </span>
          <span
            style={{ display: "block", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-dim)", fontSize: 11 }}
            title={location}
          >
            {location}
            {session.branch ? ` · ${session.branch}` : ""}
          </span>
        </span>
        <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3, color: selected ? "var(--text)" : running ? "var(--accent)" : "var(--text-muted)", fontSize: 10, whiteSpace: "nowrap" }}>
          <span>{selected ? t("pinnedSessions.current") : running ? t("pinnedSessions.running") : t("pinnedSessions.pinned")}</span>
          <span style={{ color: "var(--text-dim)" }}>{formatRelativeTime(session.modified, locale)}</span>
        </span>
      </button>
      <button
        type="button"
        onClick={(event) => { event.stopPropagation(); onTogglePinned(); }}
        title={t("sidebar.unpin")}
        aria-label={t("sidebar.unpin")}
        aria-pressed="true"
        style={{
          display: "grid", placeItems: "center",
          width: 32, padding: 0,
          border: "none", borderLeft: "1px solid var(--border)",
          background: "transparent",
          color: "var(--accent)",
          cursor: "pointer",
        }}
        onMouseEnter={(event) => {
          event.currentTarget.style.background = "var(--bg-hover)";
        }}
        onMouseLeave={(event) => {
          event.currentTarget.style.background = "transparent";
        }}
      >
        <PinIcon />
      </button>
    </div>
  );
}

export function PinnedSessionPanel({ sessions, runningSessionIds, selectedSessionId, onSelectSession, onTogglePinned }: Props) {
  const { t } = useI18n();
  const sortedSessions = useMemo(
    () => [...sessions].sort((a, b) => {
      if (a.id === selectedSessionId) return -1;
      if (b.id === selectedSessionId) return 1;
      const aRunning = runningSessionIds.has(a.id);
      const bRunning = runningSessionIds.has(b.id);
      if (aRunning !== bRunning) return aRunning ? -1 : 1;
      return b.modified.localeCompare(a.modified);
    }),
    [runningSessionIds, selectedSessionId, sessions],
  );

  return (
    <div
      role="listbox"
      aria-label={t("pinnedSessions.title")}
      style={{
        background: "var(--bg-panel)",
        border: "1px solid var(--border)",
        borderRadius: "0 0 6px 6px",
        boxShadow: "0 10px 28px rgba(0,0,0,0.10)",
        overflow: "hidden",
      }}
    >
      <div style={{ minHeight: 44, display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", borderBottom: "1px solid var(--border)" }}>
        <PinIcon size={12} />
        <strong style={{ fontSize: 12, fontWeight: 600 }}>{t("pinnedSessions.title")}</strong>
        <span style={{ marginLeft: "auto", color: "var(--text-muted)", fontSize: 11 }}>
          {t("pinnedSessions.count", { count: sortedSessions.length })}
        </span>
      </div>
      {sortedSessions.length > 0 ? (
        <div style={{ maxHeight: "min(58dvh, 480px)", overflowY: "auto" }}>
          {sortedSessions.map((session) => (
            <PinnedSessionRow
              key={session.id}
              session={session}
              running={runningSessionIds.has(session.id)}
              selected={session.id === selectedSessionId}
              onSelect={() => onSelectSession(session)}
              onTogglePinned={() => onTogglePinned(session.id)}
            />
          ))}
        </div>
      ) : (
        <div style={{ padding: "22px 14px", color: "var(--text-muted)", fontSize: 12, textAlign: "center" }}>
          {t("pinnedSessions.empty")}
        </div>
      )}
    </div>
  );
}
