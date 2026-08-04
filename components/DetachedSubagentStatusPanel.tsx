"use client";

import type { DetachedSubagentStatus } from "@/hooks/useAgentSession";

type Translate = (key: string, params?: Record<string, string | number>) => string;

export function DetachedSubagentStatusPanel({ statuses, t }: { statuses: DetachedSubagentStatus[]; t: Translate }) {
  const running = statuses.filter((status) => status.state === "running").length;
  return (
    <div
      role="status"
      aria-label={t("chat.subagentsTitle")}
      style={{
        width: "calc(100% - 32px)",
        maxWidth: 820,
        margin: "0 auto 8px",
        padding: "10px 12px",
        border: "1px solid var(--border)",
        borderRadius: 8,
        background: "var(--bg-panel)",
      }}
    >
      <div style={{ color: "var(--text-muted)", fontSize: 12, marginBottom: 8 }}>
        {t("chat.subagentsRunning", { count: running })}
      </div>
      <div style={{ display: "grid", gap: 6 }}>
        {statuses.map((status) => (
          <div
            key={status.id}
            style={{
              display: "grid",
              gridTemplateColumns: "10px minmax(0, 1fr) auto",
              gap: 8,
              alignItems: "start",
              fontSize: 12,
            }}
          >
            <span
              aria-hidden="true"
              style={{
                color: status.state === "running"
                  ? "var(--accent)"
                  : status.state === "failed"
                    ? "#d97706"
                    : "#16a34a",
              }}
            >
              ●
            </span>
            <div style={{ minWidth: 0 }}>
              <div style={{ color: "var(--text)" }}>{status.agent} · {status.mode}</div>
              <div
                title={status.task}
                style={{
                  color: "var(--text-muted)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {status.task || t("chat.subagentsNoTask")}
              </div>
              {status.error && (
                <div
                  title={status.error}
                  style={{
                    color: "#d97706",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {status.error}
                </div>
              )}
            </div>
            <span
              style={{
                color: status.state === "running"
                  ? "var(--text-muted)"
                  : status.state === "failed"
                    ? "#d97706"
                    : "#16a34a",
                whiteSpace: "nowrap",
              }}
            >
              {status.state === "running"
                ? t("chat.subagentsStateRunning")
                : status.state === "failed"
                  ? t("chat.subagentsStateFailed")
                  : status.mode === "auto-resume"
                    ? t("chat.subagentsStateAwaitingResume")
                    : t("chat.subagentsStateAwaitingNextTurn")}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
