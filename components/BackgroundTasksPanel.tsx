"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BgTaskLogsResult } from "@/lib/types";
import type { BackgroundTasksFetchState } from "@/hooks/useBackgroundTasks";
import { AnsiText } from "./AnsiText";
import { useI18n } from "@/hooks/useI18n";

const STATUS_COLORS: Record<string, string> = {
  running: "var(--accent)",
  completed: "#16a34a",
  failed: "#dc2626",
  killed: "#d97706",
};

function formatStartTime(startTime: number, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(startTime));
  } catch {
    return new Date(startTime).toISOString();
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(startTime: number, endTime: number | undefined): string {
  const end = endTime ?? Date.now();
  const seconds = Math.max(0, Math.round((end - startTime) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function BackgroundTasksPanel({
  sessionId,
  state,
  logs,
  onRefresh,
  onFetchLogs,
  onKill,
  onClose,
  selectedTaskId,
  onSelectTask,
}: {
  sessionId: string | null;
  state: BackgroundTasksFetchState;
  logs: Record<string, BgTaskLogsResult>;
  onRefresh: () => void;
  onFetchLogs: (taskId: string, maxBytes?: number) => Promise<void> | void;
  onKill: (taskId: string) => Promise<void>;
  onClose: () => void;
  selectedTaskId: string | null;
  onSelectTask: (taskId: string | null) => void;
}) {
  const { t, locale } = useI18n();
  const [killPendingId, setKillPendingId] = useState<string | null>(null);
  const [killError, setKillError] = useState<string | null>(null);
  const tailRef = useRef<HTMLDivElement>(null);

  const tasks = state.kind === "ready" ? state.tasks : [];

  // Fetch and keep the selected task's tail fresh while the panel is open.
  useEffect(() => {
    if (!selectedTaskId) return;
    void onFetchLogs(selectedTaskId);
  }, [selectedTaskId, onFetchLogs]);

  const handleKill = useCallback(async (taskId: string) => {
    setKillError(null);
    try {
      await onKill(taskId);
      setKillPendingId(null);
    } catch (error) {
      setKillError(error instanceof Error ? error.message : String(error));
    }
  }, [onKill]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, background: "var(--bg-panel)" }} role="complementary" aria-label={t("bgTasks.title")}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", flex: 1 }}>{t("bgTasks.title")}</span>
        <button
          type="button"
          onClick={onRefresh}
          disabled={state.kind !== "ready"}
          title={t("bgTasks.refresh")}
          aria-label={t("bgTasks.refresh")}
          style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 26, height: 26, background: "none", border: "none", color: "var(--text-muted)", cursor: state.kind === "ready" ? "pointer" : "not-allowed", fontSize: 14 }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" />
          </svg>
        </button>
        <button
          type="button"
          onClick={onClose}
          title={t("bgTasks.close")}
          aria-label={t("bgTasks.close")}
          style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 26, height: 26, background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 14 }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M18 6 6 18" /><path d="m6 6 12 12" />
          </svg>
        </button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {state.kind === "loading" && (
          <div style={{ padding: 16, color: "var(--text-dim)", fontSize: 12 }}>{t("bgTasks.loading")}</div>
        )}
        {state.kind === "unavailable" && (
          <div style={{ padding: 16, color: "var(--text-dim)", fontSize: 12 }}>{t("bgTasks.unavailable")}</div>
        )}
        {state.kind === "ready" && tasks.length === 0 && (
          <div style={{ padding: 16, color: "var(--text-dim)", fontSize: 12 }}>{t("bgTasks.empty")}</div>
        )}
        {state.kind === "ready" && tasks.length > 0 && (
          <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            {/* Task list */}
            <div style={{ maxHeight: "45%", overflowY: "auto", borderBottom: "1px solid var(--border)" }}>
              {tasks.map((task) => (
                <div
                  key={task.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectTask(selectedTaskId === task.id ? null : task.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelectTask(selectedTaskId === task.id ? null : task.id);
                    }
                  }}
                  style={{
                    display: "flex", alignItems: "center", gap: 8, padding: "6px 12px",
                    cursor: "pointer", fontSize: 12,
                    background: selectedTaskId === task.id ? "var(--bg-selected)" : "none",
                    borderBottom: "1px solid var(--border)",
                  }}
                >
                  <span
                    aria-label={t(`bgTasks.status.${task.status}`)}
                    style={{ width: 8, height: 8, borderRadius: 4, flexShrink: 0, background: STATUS_COLORS[task.status] ?? "var(--text-dim)" }}
                  />
                  <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text)" }}>
                      {task.name || task.id}{task.isAgent ? <em style={{ color: "var(--text-dim)", fontSize: 10, marginLeft: 4, fontStyle: "normal" }}> · {t("bgTasks.agentTask")}</em> : null}
                    </span>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-dim)", fontSize: 11 }}>
                      {formatStartTime(task.startTime, locale)} · {formatDuration(task.startTime, task.endTime)} · {formatBytes(task.bytesWritten)}
                      {typeof task.exitCode === "number" ? ` · ${t("bgTasks.exitCode")} ${task.exitCode}` : ""}
                    </span>
                  </span>
                  {task.status === "running" && (
                    killPendingId === task.id ? (
                      <span style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                        <button
                          type="button"
                          onClick={(event) => { event.stopPropagation(); void handleKill(task.id); }}
                          style={{ padding: "2px 8px", fontSize: 11, background: "#dc2626", border: "none", borderRadius: 6, color: "#fff", cursor: "pointer" }}
                        >
                          {t("bgTasks.killConfirm")}
                        </button>
                        <button
                          type="button"
                          onClick={(event) => { event.stopPropagation(); setKillPendingId(null); setKillError(null); }}
                          style={{ padding: "2px 8px", fontSize: 11, background: "none", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-muted)", cursor: "pointer" }}
                        >
                          {t("common.cancel")}
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={(event) => { event.stopPropagation(); setKillPendingId(task.id); setKillError(null); }}
                        title={t("bgTasks.kill")}
                        aria-label={t("bgTasks.kill")}
                        style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer", flexShrink: 0 }}
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <rect x="6" y="6" width="12" height="12" rx="1" />
                        </svg>
                      </button>
                    )
                  )}
                </div>
              ))}
            </div>
            {/* Output tail */}
            <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
              {selectedTaskId ? (
                <>
                  <div style={{ padding: "4px 12px", fontSize: 11, color: "var(--text-dim)", borderBottom: "1px solid var(--border)", flexShrink: 0, display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t("bgTasks.output")}</span>
                    {logs[selectedTaskId]?.truncated ? <span style={{ flexShrink: 0 }}>{t("bgTasks.outputTruncated")}</span> : null}
                  </div>
                  <div ref={tailRef} style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "6px 12px", fontSize: 11, lineHeight: 1.45, fontFamily: "var(--font-mono, monospace)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                    {logs[selectedTaskId] ? <AnsiText text={logs[selectedTaskId].text} /> : <span style={{ color: "var(--text-dim)" }}>{t("bgTasks.loading")}</span>}
                  </div>
                </>
              ) : (
                <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim)", fontSize: 12 }}>{t("bgTasks.selectTask")}</div>
              )}
            </div>
          </div>
        )}
        {killError && (
          <div style={{ padding: "6px 12px", color: "#dc2626", fontSize: 11, borderTop: "1px solid var(--border)", flexShrink: 0 }}>{killError}</div>
        )}
      </div>
      {/* Keep the session id in the DOM for tests/debugging; no user value. */}
      <span data-bg-tasks-session={sessionId ?? ""} hidden />
    </div>
  );
}
