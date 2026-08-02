"use client";

import type { Task, TaskStatus } from "@/lib/unified-engine/unified-engine-types";
import { useI18n } from "@/hooks/useI18n";

const STATUS_COLOR: Record<TaskStatus, string> = {
  pending: "var(--text-dim)",
  running: "var(--accent)",
  completed: "var(--git-added)",
  failed: "var(--color-error-soft)",
  skipped: "var(--color-warning)",
};

export function PlanTaskCard({ task }: { task: Task }) {
  const { t } = useI18n();
  const failReason =
    task.status === "failed"
      ? (task.result ?? task.backtrace?.[task.backtrace.length - 1])
      : undefined;
  return (
    <div
      style={{
        background: "color-mix(in srgb, var(--bg-panel) 80%, transparent)",
        backdropFilter: "blur(8px)",
        border: `1px solid ${task.status === "failed" ? "var(--color-error-soft)" : "var(--border)"}`,
        borderRadius: 12,
        padding: "10px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}
      >
        <span style={{ fontSize: 14, fontWeight: 500, color: "var(--text)" }}>{task.title}</span>
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: STATUS_COLOR[task.status],
            whiteSpace: "nowrap",
          }}
        >
          {t(`engine.task.${task.status}`)}
        </span>
      </div>
      {task.status === "running" && (
        <div
          style={{
            height: 3,
            borderRadius: 3,
            background: "color-mix(in srgb, var(--accent) 30%, transparent)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: "40%",
              background: "var(--accent)",
              borderRadius: 3,
              animation: "skeleton-shimmer 1.2s ease infinite",
            }}
          />
        </div>
      )}
      {task.result && task.status !== "failed" && (
        <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.5 }}>{task.result}</div>
      )}
      {failReason && (
        <div style={{ fontSize: 12, color: "#EF4444", lineHeight: 1.5 }}>
          {t("engine.taskFailedReason")}：{failReason}
        </div>
      )}
      {task.backtrace && task.backtrace.length > 0 && task.status !== "failed" && (
        <div style={{ fontSize: 11, color: "var(--text-dim)", opacity: 0.8 }}>
          ↺ {task.backtrace[task.backtrace.length - 1]}
        </div>
      )}
    </div>
  );
}
