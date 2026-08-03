"use client";

import { useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useTodoTasks } from "@/hooks/useTodoTasks";
import type { TodoTask } from "@/lib/todo-types";

/**
 * Todo panel — reads the latest todo snapshot from the current session branch.
 *
 * 数据来源：上游插件 @juicesharp/rpiv-todo 的 tool-result details（只读展示）。
 * mutations happen through the agent conversation. 数据获取/刷新统一走 useTodoTasks。
 */
export function TodoPanel() {
  const { t } = useI18n();
  const { tasks, loading, error, reload } = useTodoTasks();

  if (loading)
    return (
      <div style={{ padding: 16, color: "var(--text-muted)", fontSize: 12 }}>
        {t("common.loading")}
      </div>
    );
  if (error) return <div style={{ padding: 16, color: "#f87171", fontSize: 12 }}>{error}</div>;

  const inProgress = tasks.filter((t) => t.status === "in_progress");
  const pending = tasks.filter((t) => t.status === "pending");
  const completed = tasks.filter((t) => t.status === "completed");

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
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>
          {t("todo.title")}
          {tasks.length > 0 && (
            <span style={{ color: "var(--text-dim)", fontWeight: 400, marginLeft: 6 }}>
              ({completed.length}/{tasks.length})
            </span>
          )}
        </h3>
        <button onClick={() => void reload()} style={btnStyle}>
          {t("common.refresh")}
        </button>
      </div>

      {tasks.length === 0 ? (
        <div style={{ color: "var(--text-dim)", padding: "8px 0" }}>{t("todo.empty")}</div>
      ) : (
        <>
          {/* In progress */}
          {inProgress.length > 0 && (
            <TodoSection label={t("todo.inProgress")} tasks={inProgress} accent />
          )}
          {/* Pending */}
          {pending.length > 0 && <TodoSection label={t("todo.pending")} tasks={pending} />}
          {/* Completed */}
          {completed.length > 0 && (
            <TodoSection label={t("todo.completed")} tasks={completed} collapsed />
          )}
        </>
      )}
    </div>
  );
}

function TodoSection({
  label,
  tasks,
  accent,
  collapsed,
}: {
  label: string;
  tasks: TodoTask[];
  accent?: boolean;
  collapsed?: boolean;
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
        {show ? "▾" : "▸"} {label} ({tasks.length})
      </button>
      {show && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
          {tasks.map((task) => (
            <TodoRow key={task.id} task={task} />
          ))}
        </div>
      )}
    </div>
  );
}

function TodoRow({ task }: { task: TodoTask }) {
  const done = task.status === "completed";
  const active = task.status === "in_progress";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        padding: "6px 8px",
        background: active ? "var(--bg-selected)" : "var(--bg-panel)",
        border: "1px solid var(--border)",
        borderRadius: 6,
      }}
    >
      <span
        style={{
          width: 14,
          height: 14,
          borderRadius: "50%",
          flexShrink: 0,
          marginTop: 1,
          border: done ? "none" : active ? "2px solid var(--accent)" : "2px solid var(--border)",
          background: done ? "var(--accent)" : active ? "var(--accent)" : "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {done && (
          <svg
            width="9"
            height="9"
            viewBox="0 0 10 10"
            fill="none"
            stroke="var(--bg)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="1.5 5 4 7.5 8.5 2.5" />
          </svg>
        )}
        {active && (
          <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--bg)" }} />
        )}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 12,
            fontWeight: active ? 600 : 400,
            color: done ? "var(--text-dim)" : "var(--text)",
            textDecoration: done ? "line-through" : "none",
          }}
        >
          {task.subject}
        </div>
        {task.description && (
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
            {task.description}
          </div>
        )}
        {task.activeForm && active && (
          <div style={{ fontSize: 10, color: "var(--accent)", marginTop: 2, fontStyle: "italic" }}>
            ⟳ {task.activeForm}
          </div>
        )}
        {task.blockedBy && task.blockedBy.length > 0 && (
          <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 2 }}>
            ⛔ blocked by: {task.blockedBy.join(", ")}
          </div>
        )}
      </div>
    </div>
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
