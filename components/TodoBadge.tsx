"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useTodoTasks } from "@/hooks/useTodoTasks";
import type { TodoTask } from "@/lib/todo-types";

/**
 * Compact always-visible todo indicator for the top bar right corner.
 *
 * Shows "☑ 2/5" (completed/total) with a progress icon. Clicking toggles
 * a dropdown listing all tasks grouped by status. Hidden when there are
 * no tasks at all.
 *
 * 数据获取统一走 useTodoTasks（与 TodoPanel 共享）。当前为孤儿组件（未挂载），
 * 待 P2 接回顶栏。
 */
export function TodoBadge() {
  const { t } = useI18n();
  const { tasks } = useTodoTasks();
  const [open, setOpen] = useState(false);

  // Close dropdown on outside click.
  useEffect(() => {
    if (!open) return;
    const handler = () => setOpen(false);
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  if (tasks.length === 0) return null;

  const completed = tasks.filter((t) => t.status === "completed").length;
  const total = tasks.length;
  const inProgress = tasks.filter((t) => t.status === "in_progress");
  const pending = tasks.filter((t) => t.status === "pending");

  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        flexShrink: 0,
        height: "100%",
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        title={t("todo.title")}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          height: "100%",
          padding: "0 10px",
          background: open ? "var(--bg-selected)" : "none",
          border: "none",
          borderTop: open ? "2px solid var(--accent)" : "2px solid transparent",
          cursor: "pointer",
          fontSize: 11,
          whiteSpace: "nowrap",
          color: completed === total ? "var(--accent)" : "var(--text-muted)",
          fontWeight: 600,
          transition: "color 0.1s, background 0.1s",
        }}
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {completed === total ? (
            <>
              <path d="M9 11l3 3L22 4" />
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
            </>
          ) : (
            <>
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <path d="M16 2v4M8 2v4M3 10h18" />
            </>
          )}
        </svg>
        <span style={{ fontVariantNumeric: "tabular-nums" }}>
          {completed}/{total}
        </span>
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            right: 0,
            zIndex: 300,
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            boxShadow: "0 6px 20px rgba(0,0,0,0.14)",
            minWidth: 260,
            maxWidth: 360,
            maxHeight: "min(500px, 70vh)",
            overflowY: "auto",
            padding: 4,
          }}
        >
          {inProgress.length > 0 && (
            <TodoGroup label={t("todo.inProgress")} tasks={inProgress} accent />
          )}
          {pending.length > 0 && <TodoGroup label={t("todo.pending")} tasks={pending} />}
          {completed > 0 && (
            <TodoGroup
              label={t("todo.completed")}
              tasks={tasks.filter((t) => t.status === "completed")}
              muted
            />
          )}
        </div>
      )}
    </div>
  );
}

function TodoGroup({
  label,
  tasks,
  accent,
  muted,
}: {
  label: string;
  tasks: TodoTask[];
  accent?: boolean;
  muted?: boolean;
}) {
  return (
    <div style={{ marginBottom: 4 }}>
      <div
        style={{
          padding: "4px 8px 2px",
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: accent ? "var(--accent)" : "var(--text-dim)",
        }}
      >
        {label} ({tasks.length})
      </div>
      {tasks.map((task) => (
        <div
          key={task.id}
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 6,
            padding: "4px 8px",
            borderRadius: 5,
          }}
        >
          <span
            style={{
              width: 12,
              height: 12,
              borderRadius: "50%",
              flexShrink: 0,
              marginTop: 1,
              border:
                task.status === "completed"
                  ? "none"
                  : accent
                    ? "2px solid var(--accent)"
                    : "2px solid var(--border)",
              background:
                task.status === "completed" ? "var(--accent)" : accent ? "var(--accent)" : "none",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {task.status === "completed" && (
              <svg
                width="8"
                height="8"
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
            {accent && task.status !== "completed" && (
              <span style={{ width: 4, height: 4, borderRadius: "50%", background: "var(--bg)" }} />
            )}
          </span>
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: 11,
                lineHeight: 1.3,
                color: muted ? "var(--text-dim)" : "var(--text)",
                textDecoration: task.status === "completed" ? "line-through" : "none",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {task.subject}
            </div>
            {task.activeForm && accent && (
              <div style={{ fontSize: 10, color: "var(--accent)", fontStyle: "italic" }}>
                ⟳ {task.activeForm}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
