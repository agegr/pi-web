"use client";

import { useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useTodoTasks } from "@/hooks/useTodoTasks";
import { getEntryIdForTask } from "@/lib/inspector-task-id";
import { InspectorTaskRow } from "./InspectorTaskRow";
import type { TodoTask } from "@/lib/todo-types";

/**
 * Todo panel — 唯一任务中心（方案C）。
 *
 * 数据走 useTodoTasks（与 TodoBadge 共享）。任务行复用 InspectorTaskRow
 * （含状态点、activeForm 脉冲、点击反馈）。点击任务 → onTaskClick(entryId)
 * → 经 WorkspacePanelContext.scrollToEntry → ChatWindow 滚动到对应消息。
 *
 * 进度环从 InspectorPanel 迁入（inspector 专注 Git 后不再需要）。
 */
export function TodoPanel({ onTaskClick }: { onTaskClick?: (entryId: string) => void }) {
  const { t } = useI18n();
  const { tasks, entryIds, loading, error, reload } = useTodoTasks();
  const handleTaskClick = onTaskClick ?? (() => {});

  if (loading)
    return (
      <div style={{ padding: 16, color: "var(--text-muted)", fontSize: 12 }}>
        {t("common.loading")}
      </div>
    );
  if (error) return <div style={{ padding: 16, color: "#f87171", fontSize: 12 }}>{error}</div>;

  const completed = tasks.filter((t) => t.status === "completed");
  const inProgress = tasks.filter((t) => t.status === "in_progress");
  const pending = tasks.filter((t) => t.status === "pending");
  const total = tasks.length;
  const progressPct = total ? completed.length / total : 0;
  const allDone = total > 0 && completed.length === total;
  const progressColor = allDone
    ? "var(--git-added)"
    : completed.length === 0
      ? "var(--text-dim)"
      : "var(--git-modified)";

  const rowFor = (task: TodoTask, variant: "active" | "pending" | "done") => (
    <InspectorTaskRow
      key={task.id}
      task={task}
      variant={variant}
      entryId={getEntryIdForTask(entryIds, task.id)}
      onTaskClick={handleTaskClick}
    />
  );

  return (
    <div style={{ padding: 12, fontSize: 12, height: "100%", overflowY: "auto" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 12,
        }}
      >
        <h3
          style={{
            margin: 0,
            fontSize: 13,
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            gap: 7,
          }}
        >
          {t("todo.title")}
          {total > 0 && (
            <ProgressRing pct={progressPct} color={progressColor} value={completed.length} />
          )}
        </h3>
        <button onClick={() => void reload()} style={btnStyle}>
          {t("common.refresh")}
        </button>
      </div>

      {total === 0 ? (
        <div style={{ color: "var(--text-dim)", padding: "8px 0" }}>{t("todo.empty")}</div>
      ) : (
        <>
          {inProgress.length > 0 && (
            <Section label={t("todo.inProgress")} tasks={inProgress.length} accent>
              {inProgress.map((t) => rowFor(t, "active"))}
            </Section>
          )}
          {pending.length > 0 && (
            <Section label={t("todo.pending")} tasks={pending.length}>
              {pending.map((t) => rowFor(t, "pending"))}
            </Section>
          )}
          {completed.length > 0 && (
            <Section label={t("todo.completed")} tasks={completed.length} collapsed>
              {completed.map((t) => rowFor(t, "done"))}
            </Section>
          )}
        </>
      )}
    </div>
  );
}

function Section({
  label,
  tasks,
  accent,
  collapsed,
  children,
}: {
  label: string;
  tasks: number;
  accent?: boolean;
  collapsed?: boolean;
  children: React.ReactNode;
}) {
  const [show, setShow] = useState(!collapsed);
  return (
    <div style={{ marginBottom: 12 }}>
      <button
        onClick={() => setShow((v) => !v)}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: "4px 0",
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: accent ? "var(--accent)" : "var(--text-dim)",
        }}
      >
        {show ? "▾" : "▸"} {label} ({tasks})
      </button>
      {show && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
          {children}
        </div>
      )}
    </div>
  );
}

/** 圆形进度环（从 InspectorPanel 迁入）。30px 直径，中心显示完成数。 */
function ProgressRing({ pct, color, value }: { pct: number; color: string; value: number }) {
  const size = 30;
  const stroke = 3;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - Math.min(1, Math.max(0, pct)));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--bg-subtle)"
        strokeWidth={stroke}
      />
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

const btnStyle: React.CSSProperties = {
  background: "var(--bg-hover)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  padding: "5px 12px",
  fontSize: 11,
  color: "var(--text)",
  cursor: "pointer",
};
