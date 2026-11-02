"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { countRunningSubagents, sideChatTitle } from "@/lib/session-family";
import type { SessionUsageSummary } from "@/lib/session-stats";
import { formatActiveDuration, formatCompactCount, formatCostShort } from "@/lib/session-stats-format";
import type { SessionInfo, SubagentSessionStatus } from "@/lib/types";
import { TrashIcon } from "./SidebarIcons";

interface Props {
  rootSession: SessionInfo;
  subagents: SessionInfo[];
  selectedSessionId: string;
  runningSessionIds: ReadonlySet<string>;
  onSelectSession: (session: SessionInfo) => void;
  /** Subagents with a viewer tab in the open right panel. */
  openSubagentTabIds: ReadonlySet<string>;
  /** Opens a subagent's read-only viewer tab in the right panel (the `Agent` card's button), or closes it when open. */
  onToggleSubagentTab: (sessionId: string, label: string, side?: boolean) => void;
  /** Forks the main agent into a side chat and opens its tab; answers the refusal to show, or null. */
  onNewSideChat: () => Promise<string | null>;
  /** Deletes one side chat and its tab; answers the failure to show, or null. */
  onDeleteSideChat: (sessionId: string) => Promise<string | null>;
}

const STATS_POLL_MS = 3000;

const sideChatConfirmTextStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: "hidden",
  color: "var(--text)",
  fontSize: 12,
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
const sideChatConfirmDeleteStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 4,
  height: 24,
  padding: "0 10px",
  border: "1px solid #ef4444",
  borderRadius: 6,
  background: "#ef4444",
  color: "#fff",
  fontSize: 12,
  fontWeight: 600,
  whiteSpace: "nowrap",
};
const sideChatConfirmCancelStyle: CSSProperties = {
  height: 24,
  padding: "0 10px",
  border: "1px solid var(--border)",
  borderRadius: 6,
  background: "var(--bg)",
  color: "var(--text-muted)",
  fontSize: 12,
  fontWeight: 500,
  whiteSpace: "nowrap",
};

/**
 * Usage of every agent in the family, as the toolbar's stats popover counts
 * it. Read on open and whenever a run starts or ends; polled while one runs,
 * on a visible page, one request at a time.
 */
function useAgentUsage(ids: readonly string[], runningKey: string): Record<string, SessionUsageSummary> {
  const [usage, setUsage] = useState<Record<string, SessionUsageSummary>>({});
  const idsKey = ids.join(",");
  useEffect(() => {
    const requested = idsKey ? idsKey.split(",") : [];
    if (requested.length === 0) return;
    const controller = new AbortController();
    let inFlight = false;
    const load = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const res = await fetch("/api/sessions/stats", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: requested }),
          signal: controller.signal,
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = await res.json() as { stats?: Record<string, SessionUsageSummary> };
        if (!controller.signal.aborted && data.stats) setUsage(data.stats);
      } catch {
        /* best-effort: rows keep their last numbers */
      } finally {
        inFlight = false;
      }
    };
    void load();
    if (!runningKey) return () => controller.abort();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, STATS_POLL_MS);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [idsKey, runningKey]);
  return usage;
}

function usageTooltip(usage: SessionUsageSummary, t: (key: string) => string, locale: string): string {
  const { tokens } = usage;
  return [
    `${t("session.totalActive")}: ${formatActiveDuration(usage.totalActiveMs)}`,
    `${t("session.input")}: ${tokens.input.toLocaleString(locale)}`,
    `${t("session.output")}: ${tokens.output.toLocaleString(locale)}`,
    ...(tokens.cacheRead > 0 ? [`${t("session.cacheRead")}: ${tokens.cacheRead.toLocaleString(locale)}`] : []),
    ...(tokens.cacheWrite > 0 ? [`${t("session.cacheWrite")}: ${tokens.cacheWrite.toLocaleString(locale)}`] : []),
    `${t("session.total")}: ${tokens.total.toLocaleString(locale)}`,
    ...(usage.cost > 0 ? [`${t("session.cost")}: $${usage.cost.toFixed(4)}`] : []),
    `${t("session.toolCalls")}: ${usage.toolCalls.toLocaleString(locale)}`,
  ].join("\n");
}

function UsageLine({ usage, style }: { usage: SessionUsageSummary; style?: React.CSSProperties }) {
  const { locale, t } = useI18n();
  const cost = formatCostShort(usage.cost);
  return (
    <span
      title={usageTooltip(usage, t, locale)}
      style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, color: "var(--text-dim)", fontSize: 11, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", ...style }}
    >
      {usage.totalActiveMs > 0 && (
        <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
          </svg>
          {formatActiveDuration(usage.totalActiveMs)}
        </span>
      )}
      {usage.tokens.total > 0 && (
        <span>{t("agentSwitcher.tokens", { count: formatCompactCount(usage.tokens.total) })}</span>
      )}
      {cost && <span style={{ color: "var(--text-muted)" }}>{cost}</span>}
    </span>
  );
}

function hasUsage(usage: SessionUsageSummary | undefined): usage is SessionUsageSummary {
  return Boolean(usage && (usage.tokens.total > 0 || usage.totalActiveMs > 0));
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

export function statusColor(status: SubagentSessionStatus): string {
  if (status === "running" || status === "starting") return "var(--accent)";
  if (status === "completed") return "#16a34a";
  if (status === "failed") return "#dc2626";
  if (status === "aborted") return "#d97706";
  return "var(--text-dim)";
}

export function StatusIcon({ status }: { status: SubagentSessionStatus }) {
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

function AgentRow({
  session,
  main,
  selected,
  running,
  usage,
  onSelect,
  tabShown,
  onToggleTab,
  onNewSideChat,
  newSideChatPending,
  onDelete,
  confirming,
  onDeleteConfirm,
  onDeleteCancel,
  deleting,
}: {
  session: SessionInfo;
  main?: boolean;
  selected: boolean;
  running: boolean;
  usage?: SessionUsageSummary;
  onSelect: () => void;
  tabShown?: boolean;
  onToggleTab?: () => void;
  onNewSideChat?: () => void;
  newSideChatPending?: boolean;
  onDelete?: () => void;
  confirming?: boolean;
  onDeleteConfirm?: () => void;
  onDeleteCancel?: () => void;
  deleting?: boolean;
}) {
  const { locale, t } = useI18n();
  const relation = session.relation?.kind === "subagent" ? session.relation : null;
  const side = session.relation?.kind === "side";
  const status: SubagentSessionStatus = running ? "running" : relation?.status ?? "completed";
  const primary = main ? t("agentSwitcher.main") : side ? sideChatTitle(session, t("agentSwitcher.sideChat")) : relation?.description || sessionTitle(session);
  const profile = side ? t("agentSwitcher.sideChat") : relation?.profile ?? t("agentSwitcher.subagent");
  const modelId = usage?.model?.modelId;
  const thinkingLevel = usage?.thinkingLevel && usage.thinkingLevel !== "off" ? usage.thinkingLevel : undefined;
  // Every side chat has the same name: when it last ran tells two rows apart.
  const secondary = main ? sessionTitle(session) : side ? formatRelativeTime(session.modified, locale) : profile;
  const secondaryTitle = main ? secondary : [
    profile,
    usage?.model ? `${usage.model.provider}/${usage.model.modelId}` : undefined,
    thinkingLevel,
    formatRelativeTime(session.modified, locale),
  ].filter(Boolean).join(" · ");

  if (confirming && onDeleteConfirm && onDeleteCancel) {
    return (
      <SideChatDeleteConfirm
        selected={selected}
        name={primary}
        running={running}
        deleting={deleting}
        onConfirm={onDeleteConfirm}
        onCancel={onDeleteCancel}
      />
    );
  }

  return (
    <div
      style={{
        display: "flex",
        borderBottom: "1px solid var(--border)",
        borderLeft: selected ? "2px solid var(--accent)" : "2px solid transparent",
        background: selected ? "var(--bg-selected)" : "transparent",
      }}
    >
      <button
        type="button"
        role="option"
        aria-selected={selected}
        onClick={onSelect}
        className={selected ? "bg-transparent" : "bg-transparent hover:bg-bg-hover"}
        style={{
          flex: 1,
          minWidth: 0,
          minHeight: 56,
          display: "grid",
          gridTemplateColumns: "28px minmax(0, 1fr) auto",
          alignItems: "center",
          gap: 9,
          padding: "7px 12px",
          border: "none",
          color: "var(--text)",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span style={{ width: 28, height: 28, display: "grid", placeItems: "center", color: main ? "var(--text-muted)" : "var(--accent)" }}>
          {main ? (
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" />
            </svg>
          ) : side ? (
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 12a8 8 0 0 1-8 8H5.5a2 2 0 0 1-1.4-3.4A8 8 0 1 1 21 12z" />
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
          <span style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: 2, minWidth: 0, whiteSpace: "nowrap", color: "var(--text-dim)", fontSize: 11 }} title={secondaryTitle}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", flexShrink: modelId && !main ? 0 : 1, maxWidth: modelId && !main ? "40%" : undefined }}>{secondary}</span>
            {!main && modelId && <>
              <span aria-hidden="true">·</span>
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{modelId}</span>
            </>}
            {!main && thinkingLevel && <span style={{ flexShrink: 0 }}>· {thinkingLevel}</span>}
          </span>
          {hasUsage(usage) && <UsageLine usage={usage} style={{ marginTop: 3 }} />}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 6, color: (main || side) && !running ? "var(--text-dim)" : statusColor(status), fontSize: 11, whiteSpace: "nowrap" }}>
          {(main || side) && !running ? (
            selected ? t("agentSwitcher.current") : null
          ) : (
            <>
              <StatusIcon status={status} />
              <span>{t(`agentSwitcher.status.${status}`)}</span>
            </>
          )}
        </span>
      </button>
      {onNewSideChat && (
        <RowSideButton title={t("sideChat.new")} disabled={newSideChatPending} onClick={onNewSideChat}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 12a8 8 0 0 1-8 8H5.5a2 2 0 0 1-1.4-3.4A8 8 0 1 1 21 12z" /><path d="M13 8.5v7M9.5 12h7" />
          </svg>
        </RowSideButton>
      )}
      {onToggleTab && (
        // Greyed, not gone: the row open in the main chat has no tab (one session, one chat),
        // and the rows keep their layout.
        <RowSideButton
          title={selected ? t("agentSwitcher.openInMainChat") : t(tabShown ? (side ? "sideChat.closeTab" : "subagent.closeTab") : side ? "sideChat.openTab" : "subagent.openTab")}
          pressed={tabShown}
          disabled={selected}
          onClick={onToggleTab}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="4" width="18" height="16" rx="2" /><path d="M15 4v16" />
            {tabShown && <path d="M15 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4z" fill="currentColor" />}
          </svg>
        </RowSideButton>
      )}
      {onDelete && (
        <RowSideButton title={t("sideChat.delete")} danger disabled={deleting} onClick={onDelete}>
          <TrashIcon size={14} />
        </RowSideButton>
      )}
    </div>
  );
}

function SideChatDeleteConfirm({ selected, name, running, deleting, onConfirm, onCancel }: {
  selected: boolean;
  name: string;
  running: boolean;
  deleting?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const active = document.activeElement;
    if (!active || active === document.body) cancelRef.current?.focus();
  }, []);
  const cancelHover = (event: ReactMouseEvent<HTMLButtonElement>, hovered: boolean) => {
    event.currentTarget.style.background = hovered ? "var(--bg-hover)" : "var(--bg)";
  };
  const deleteStyle: CSSProperties = deleting ? { ...sideChatConfirmDeleteStyle, cursor: "default", opacity: 0.6 } : sideChatConfirmDeleteStyle;
  const cancelStyle: CSSProperties = deleting ? { ...sideChatConfirmCancelStyle, cursor: "default" } : sideChatConfirmCancelStyle;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        minHeight: 56,
        padding: "7px 12px",
        borderBottom: "1px solid var(--border)",
        borderLeft: selected ? "2px solid var(--accent)" : "2px solid transparent",
        background: selected ? "var(--bg-selected)" : "transparent",
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || deleting) return;
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      }}
    >
      <span style={sideChatConfirmTextStyle}>
        {t(running ? "sideChat.deleteRunningConfirm" : "sideChat.deleteConfirm", { name })}
      </span>
      <button type="button" disabled={deleting} onClick={onConfirm} style={deleteStyle}>
        <TrashIcon size={12} />
        {t("sidebar.delete")}
      </button>
      <button
        ref={cancelRef}
        type="button"
        disabled={deleting}
        onClick={onCancel}
        onMouseEnter={(event) => cancelHover(event, true)}
        onMouseLeave={(event) => cancelHover(event, false)}
        style={cancelStyle}
      >
        {t("sidebar.cancel")}
      </button>
    </div>
  );
}

function RowSideButton({ title, pressed, danger, disabled, onClick, children }: {
  title: string;
  pressed?: boolean;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  const state = disabled
    ? "cursor-not-allowed text-text-dim opacity-40"
    : danger
      ? "cursor-pointer"
      : pressed
        ? "cursor-pointer text-accent hover:bg-bg-hover"
        : "cursor-pointer text-text-muted hover:bg-bg-hover hover:text-text";
  const dangerHover = danger && !disabled;
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={pressed}
      disabled={disabled}
      className={`bg-transparent ${state}`}
      style={{
        width: 36,
        display: "grid",
        placeItems: "center",
        border: "none",
        borderLeft: "1px solid var(--border)",
        flexShrink: 0,
        ...(dangerHover ? { color: "#ef4444" } : {}),
      }}
      onMouseEnter={dangerHover ? (event) => { event.currentTarget.style.background = "rgba(239,68,68,0.08)"; } : undefined}
      onMouseLeave={dangerHover ? (event) => { event.currentTarget.style.background = "transparent"; } : undefined}
      onFocus={dangerHover ? (event) => { event.currentTarget.style.background = "rgba(239,68,68,0.08)"; } : undefined}
      onBlur={dangerHover ? (event) => { event.currentTarget.style.background = "transparent"; } : undefined}
    >
      {children}
    </button>
  );
}

export function AgentSessionPanel({ rootSession, subagents, selectedSessionId, runningSessionIds, onSelectSession, openSubagentTabIds, onToggleSubagentTab, onNewSideChat, onDeleteSideChat }: Props) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [newSideChatPending, setNewSideChatPending] = useState(false);
  const [newSideChatError, setNewSideChatError] = useState<string | null>(null);
  const [confirmDeleteSideChatId, setConfirmDeleteSideChatId] = useState<string | null>(null);
  const [deletingSideChatId, setDeletingSideChatId] = useState<string | null>(null);
  const [deleteSideChatError, setDeleteSideChatError] = useState<string | null>(null);
  const handleNewSideChat = async () => {
    setNewSideChatPending(true);
    setNewSideChatError(null);
    try {
      setNewSideChatError(await onNewSideChat());
    } catch (error) {
      setNewSideChatError(error instanceof Error ? error.message : String(error));
    } finally {
      setNewSideChatPending(false);
    }
  };
  const handleDeleteSideChat = async (session: SessionInfo) => {
    setDeletingSideChatId(session.id);
    setDeleteSideChatError(null);
    try {
      const error = await onDeleteSideChat(session.id);
      if (error) setDeleteSideChatError(t("sideChat.deleteFailed", { error }));
    } catch (error) {
      setDeleteSideChatError(t("sideChat.deleteFailed", { error: error instanceof Error ? error.message : String(error) }));
    } finally {
      setDeletingSideChatId(null);
      setConfirmDeleteSideChatId((current) => (current === session.id ? null : current));
    }
  };
  const sortedSubagents = useMemo(() => [...subagents].sort((a, b) => {
    const aRunning = runningSessionIds.has(a.id);
    const bRunning = runningSessionIds.has(b.id);
    if (aRunning !== bRunning) return aRunning ? -1 : 1;
    return b.modified.localeCompare(a.modified);
  }), [runningSessionIds, subagents]);
  const normalizedQuery = query.trim().toLowerCase();
  const visibleSubagents = normalizedQuery
    ? sortedSubagents.filter((session) => {
        const relation = session.relation?.kind === "subagent" ? session.relation : null;
        const sideLabel = session.relation?.kind === "side" ? t("agentSwitcher.sideChat") : null;
        return [relation?.description, relation?.profile, sideLabel, session.name, session.firstMessage]
          .some((value) => value?.toLowerCase().includes(normalizedQuery));
      })
    : sortedSubagents;
  const runningCount = countRunningSubagents(subagents, runningSessionIds);
  const familyIds = useMemo(() => [rootSession.id, ...subagents.map((session) => session.id)], [rootSession.id, subagents]);
  const runningKey = familyIds.filter((id) => runningSessionIds.has(id)).join(",");
  const usage = useAgentUsage(familyIds, runningKey);
  const familyUsage = useMemo(() => {
    const listed = familyIds.map((id) => usage[id]).filter(hasUsage);
    if (listed.length === 0) return null;
    const total: SessionUsageSummary = {
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      cost: 0,
      toolCalls: 0,
      totalActiveMs: 0,
    };
    for (const item of listed) {
      total.tokens.input += item.tokens.input;
      total.tokens.output += item.tokens.output;
      total.tokens.cacheRead += item.tokens.cacheRead;
      total.tokens.cacheWrite += item.tokens.cacheWrite;
      total.tokens.total += item.tokens.total;
      total.cost += item.cost;
      total.toolCalls += item.toolCalls;
      total.totalActiveMs += item.totalActiveMs;
    }
    return total;
  }, [familyIds, usage]);

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
          <strong style={{ fontSize: 12, fontWeight: 600 }}>{t("agentSwitcher.title")}</strong>
          {subagents.length > 0 && (
            <span style={{ color: "var(--text-dim)", fontSize: 11 }}>
              {subagents.length === 1
                ? t("agentSwitcher.countOne", { count: subagents.length })
                : t("agentSwitcher.count", { count: subagents.length })}
            </span>
          )}
          <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            {familyUsage && (
              <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, overflow: "hidden" }}>
                <span style={{ color: "var(--text-dim)", fontSize: 11, whiteSpace: "nowrap" }} title={t("agentSwitcher.totalUsageHint")}>{t("agentSwitcher.totalUsage")}</span>
                <UsageLine usage={familyUsage} />
              </span>
            )}
            {runningCount > 0 && (
              <span style={{ color: "var(--accent)", fontSize: 11, whiteSpace: "nowrap" }}>
                {t("agentSwitcher.runningCount", { count: runningCount })}
              </span>
            )}
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
            usage={usage[rootSession.id]}
            onSelect={() => onSelectSession(rootSession)}
            onNewSideChat={handleNewSideChat}
            newSideChatPending={newSideChatPending}
          />
          {(newSideChatError || deleteSideChatError) && (
            <div role="alert" style={{ padding: "6px 12px", borderBottom: "1px solid var(--border)", color: "#dc2626", fontSize: 12, overflowWrap: "anywhere" }}>
              {newSideChatError ?? deleteSideChatError}
            </div>
          )}
          {visibleSubagents.map((session) => (
            <AgentRow
              key={session.id}
              session={session}
              selected={session.id === selectedSessionId}
              running={runningSessionIds.has(session.id)}
              usage={usage[session.id]}
              onSelect={() => onSelectSession(session)}
              tabShown={openSubagentTabIds.has(session.id)}
              onToggleTab={() => {
                const relation = session.relation?.kind === "subagent" ? session.relation : null;
                if (session.relation?.kind === "side") {
                  onToggleSubagentTab(session.id, t("sideChat.title"), true);
                  return;
                }
                onToggleSubagentTab(session.id, relation?.description || relation?.profile || sessionTitle(session));
              }}
              onDelete={session.relation?.kind === "side" ? () => setConfirmDeleteSideChatId(session.id) : undefined}
              confirming={confirmDeleteSideChatId === session.id}
              onDeleteConfirm={() => { void handleDeleteSideChat(session); }}
              onDeleteCancel={() => setConfirmDeleteSideChatId(null)}
              deleting={deletingSideChatId === session.id}
            />
          ))}
          {subagents.length > 0 && visibleSubagents.length === 0 && (
            <div style={{ padding: "22px 12px", color: "var(--text-dim)", fontSize: 12, textAlign: "center" }}>
              {t("agentSwitcher.noMatches")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
