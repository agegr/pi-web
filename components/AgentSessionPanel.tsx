"use client";

import { useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { SessionInfo, SubagentSessionStatus } from "@/lib/types";
import type { PiSubagentSnapshotNode } from "@/lib/pi-subagents-snapshot";
import { buildRunProgress, formatRunProgress, type RunProgress } from "@/lib/pi-subagents-progress";

interface Props {
  rootSession: SessionInfo;
  subagents: SessionInfo[];
  selectedSessionId: string;
  runningSessionIds: ReadonlySet<string>;
  /** Live runs from the pi-subagents `subagent-async` widget, when present. */
  liveRuns?: PiSubagentSnapshotNode[];
  onSelectSession: (session: SessionInfo) => void;
}

function sessionTitle(session: SessionInfo): string {
  return session.name || session.firstMessage || session.id.slice(0, 12);
}

function formatRelativeTime(value: string, locale: string): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "";
  const elapsedSeconds = Math.round((timestamp - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (Math.abs(elapsedSeconds) < 60) return formatter.format(elapsedSeconds, "second");
  const elapsedMinutes = Math.round(elapsedSeconds / 60);
  if (Math.abs(elapsedMinutes) < 60) return formatter.format(elapsedMinutes, "minute");
  const elapsedHours = Math.round(elapsedMinutes / 60);
  if (Math.abs(elapsedHours) < 24) return formatter.format(elapsedHours, "hour");
  return formatter.format(Math.round(elapsedHours / 24), "day");
}

function statusColor(status: SubagentSessionStatus): string {
  if (status === "running" || status === "starting") return "var(--accent)";
  if (status === "completed") return "#16a34a";
  if (status === "failed") return "#dc2626";
  if (status === "aborted") return "#d97706";
  return "var(--text-dim)";
}

function StatusIcon({ status }: { status: SubagentSessionStatus }) {
  if (status === "running" || status === "starting") {
    return (
      <svg className="animate-spin" width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity="0.25" />
        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }
  if (status === "failed") {
    return (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" /><path d="m9 9 6 6M15 9l-6 6" />
      </svg>
    );
  }
  if (status === "aborted" || status === "interrupted") {
    return (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" /><path d="M9 9h6v6H9z" />
      </svg>
    );
  }
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" />
    </svg>
  );
}

/** The one place a subagent row's badge status is derived. The list filter
 *  reads this same helper with the same inputs, so a row can never be hidden
 *  while its badge says "running" (or shown while it says "completed"). */
function subagentStatus(
  session: SessionInfo,
  progress: RunProgress | undefined,
  running: boolean,
): SubagentSessionStatus {
  const relation = session.relation?.kind === "subagent" ? session.relation : null;
  return running || progress?.status === "running"
    ? "running"
    : progress?.status ?? relation?.status ?? "completed";
}

/** Statuses the default Agents view treats as active. Everything else is
 *  terminal and hidden until "Show completed" is checked. */
const ACTIVE_SUBAGENT_STATUSES: ReadonlySet<SubagentSessionStatus> = new Set(["running", "starting"]);

function isActiveSubagentStatus(status: SubagentSessionStatus): boolean {
  return ACTIVE_SUBAGENT_STATUSES.has(status);
}

/** Shared checkbox styling for the header and the filtered empty state. */
function CompletedToggle({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 5, color: "var(--text-dim)", fontSize: 11, cursor: "pointer", whiteSpace: "nowrap" }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        style={{ width: 13, height: 13, accentColor: "var(--accent)", cursor: "pointer" }}
      />
      {label}
    </label>
  );
}

function AgentRow({
  session,
  main,
  selected,
  running,
  status,
  progress,
  onSelect,
}: {
  session: SessionInfo;
  main?: boolean;
  selected: boolean;
  running: boolean;
  status: SubagentSessionStatus;
  progress?: RunProgress;
  onSelect: () => void;
}) {
  const { locale, t } = useI18n();
  const relation = session.relation?.kind === "subagent" ? session.relation : null;
  const primary = main ? t("agentSwitcher.main") : relation?.description || sessionTitle(session);
  const baseSecondary = main
    ? sessionTitle(session)
    : `${relation?.profile ?? t("agentSwitcher.subagent")} · ${formatRelativeTime(session.modified, locale)}`;
  const progressText = !main && progress ? formatRunProgress(progress, t) : "";
  const secondary = progressText ? `${progressText} · ${baseSecondary}` : baseSecondary;

  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      style={{
        width: "100%",
        minHeight: 56,
        display: "grid",
        gridTemplateColumns: "28px minmax(0, 1fr) auto",
        alignItems: "center",
        gap: 9,
        padding: "7px 12px",
        border: "none",
        borderBottom: "1px solid var(--border)",
        borderLeft: selected ? "2px solid var(--accent)" : "2px solid transparent",
        background: selected ? "var(--bg-selected)" : "transparent",
        color: "var(--text)",
        cursor: "pointer",
        textAlign: "left",
      }}
      onMouseEnter={(event) => {
        if (!selected) event.currentTarget.style.background = "var(--bg-hover)";
      }}
      onMouseLeave={(event) => {
        if (!selected) event.currentTarget.style.background = "transparent";
      }}
    >
      <span style={{ width: 28, height: 28, display: "grid", placeItems: "center", color: main ? "var(--text-muted)" : "var(--accent)" }}>
        {main ? (
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" />
          </svg>
        ) : (
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="5" y="7" width="14" height="11" rx="2" /><path d="M9 11h.01M15 11h.01M9 15h6M12 7V4M10 4h4" />
          </svg>
        )}
      </span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, fontWeight: selected ? 600 : 500 }} title={primary}>
          {primary}
        </span>
        <span style={{ display: "block", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-dim)", fontSize: 11 }} title={secondary}>
          {secondary}
        </span>
      </span>
      <span style={{ display: "flex", alignItems: "center", gap: 6, color: main && !running ? "var(--text-dim)" : statusColor(status), fontSize: 11, whiteSpace: "nowrap" }}>
        {main && !running ? (
          selected ? t("agentSwitcher.current") : null
        ) : (
          <>
            <StatusIcon status={status} />
            <span>{t(`agentSwitcher.status.${status}`)}</span>
          </>
        )}
      </span>
    </button>
  );
}

export function AgentSessionPanel({ rootSession, subagents, selectedSessionId, runningSessionIds, liveRuns = [], onSelectSession }: Props) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [showCompleted, setShowCompleted] = useState(false);
  const runProgress = useMemo(() => buildRunProgress(subagents, liveRuns), [subagents, liveRuns]);
  // A live pi-subagents run is not a pi-web RPC session, so runningSessionIds
  // never lists it; fold live run state in so sorting and the count agree.
  const liveRunningIds = useMemo(() => {
    const ids = new Set<string>();
    for (const [sessionId, progress] of runProgress) {
      if (progress.status === "running") ids.add(sessionId);
    }
    return ids;
  }, [runProgress]);
  const isSessionRunning = (sessionId: string) => runningSessionIds.has(sessionId) || liveRunningIds.has(sessionId);
  const sortedSubagents = useMemo(() => [...subagents].sort((a, b) => {
    const aRunning = runningSessionIds.has(a.id) || liveRunningIds.has(a.id);
    const bRunning = runningSessionIds.has(b.id) || liveRunningIds.has(b.id);
    if (aRunning !== bRunning) return aRunning ? -1 : 1;
    return b.modified.localeCompare(a.modified);
  }), [runningSessionIds, liveRunningIds, subagents]);
  // List-level statuses use the same derivation as each row badge (see
  // subagentStatus), so the filter and the badge can never disagree.
  const subagentStatuses = useMemo(() => {
    const statuses = new Map<string, SubagentSessionStatus>();
    for (const session of subagents) {
      const running = runningSessionIds.has(session.id) || liveRunningIds.has(session.id);
      statuses.set(session.id, subagentStatus(session, runProgress.get(session.id), running));
    }
    return statuses;
  }, [subagents, runningSessionIds, liveRunningIds, runProgress]);
  const statusOf = (session: SessionInfo): SubagentSessionStatus => subagentStatuses.get(session.id) ?? "completed";
  const normalizedQuery = query.trim().toLowerCase();
  const searchMatches = normalizedQuery
    ? sortedSubagents.filter((session) => {
        const relation = session.relation?.kind === "subagent" ? session.relation : null;
        return [relation?.description, relation?.profile, session.name, session.firstMessage]
          .some((value) => value?.toLowerCase().includes(normalizedQuery));
      })
    : sortedSubagents;
  // Search composes with the status filter: active-only by default, terminal
  // rows revealed by "Show completed".
  const visibleSubagents = showCompleted
    ? searchMatches
    : searchMatches.filter((session) => isActiveSubagentStatus(statusOf(session)));
  const hiddenTerminalCount = showCompleted
    ? 0
    : searchMatches.filter((session) => !isActiveSubagentStatus(statusOf(session))).length;
  const runningCount = subagents.filter((session) => isSessionRunning(session.id)).length;

  return (
    <div
      role="listbox"
      aria-label={t("agentSwitcher.title")}
      style={{
        background: "var(--bg-panel)",
        borderLeft: "1px solid var(--border)",
        borderRight: "1px solid var(--border)",
        borderBottom: "1px solid var(--border)",
        borderRadius: "0 0 6px 6px",
        boxShadow: "0 10px 28px rgba(0,0,0,0.10)",
        overflow: "hidden",
      }}
    >
      <div>
        <div style={{ minHeight: 44, display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", borderBottom: "1px solid var(--border)" }}>
          <strong style={{ fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}>{t("agentSwitcher.title")}</strong>
          {/* Family total, not the filtered row count: the header must not
              claim a smaller family just because terminal rows are hidden. */}
          <span style={{ color: "var(--text-dim)", fontSize: 11, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {t("agentSwitcher.count", { count: subagents.length })}
          </span>
          <span style={{ marginLeft: "auto", flexShrink: 0, display: "flex", alignItems: "center", gap: 10 }}>
            {runningCount > 0 && (
              <span style={{ color: "var(--accent)", fontSize: 11, whiteSpace: "nowrap" }}>
                {t("agentSwitcher.runningCount", { count: runningCount })}
              </span>
            )}
            <CompletedToggle
              checked={showCompleted}
              onChange={setShowCompleted}
              label={t("agentSwitcher.showCompleted")}
            />
          </span>
        </div>
        {subagents.length > 8 && (
          <div style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("agentSwitcher.search")}
              aria-label={t("agentSwitcher.search")}
              style={{
                width: "100%", height: 32, padding: "0 10px",
                border: "1px solid var(--border)", borderRadius: 6,
                background: "var(--bg)", color: "var(--text)", fontSize: 12, outline: "none",
              }}
            />
          </div>
        )}
        <div style={{ maxHeight: "min(58dvh, 480px)", overflowY: "auto" }}>
          <AgentRow
            session={rootSession}
            main
            selected={rootSession.id === selectedSessionId}
            running={runningSessionIds.has(rootSession.id)}
            status={subagentStatus(rootSession, undefined, runningSessionIds.has(rootSession.id))}
            onSelect={() => onSelectSession(rootSession)}
          />
          {visibleSubagents.map((session) => (
            <AgentRow
              key={session.id}
              session={session}
              selected={session.id === selectedSessionId}
              running={isSessionRunning(session.id)}
              status={statusOf(session)}
              progress={runProgress.get(session.id)}
              onSelect={() => onSelectSession(session)}
            />
          ))}
          {visibleSubagents.length === 0 && (
            <div style={{ padding: "22px 12px", color: "var(--text-dim)", fontSize: 12, textAlign: "center", display: "grid", justifyItems: "center", gap: 8 }}>
              <span>{searchMatches.length === 0 ? t("agentSwitcher.noMatches") : t("agentSwitcher.noRunning")}</span>
              {!showCompleted && hiddenTerminalCount > 0 && (
                <CompletedToggle
                  checked={showCompleted}
                  onChange={setShowCompleted}
                  label={t("agentSwitcher.showCompleted")}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
