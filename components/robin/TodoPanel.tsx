"use client";

import { useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { dueBucket, type DueBucket } from "@/extension/robin/dates";
import type { Todo } from "@/extension/robin/store";
import { mutate, usePolledResource } from "./usePolledResource";

interface TodosResponse {
  todos: Todo[];
  /** Local calendar date resolved on the server, where `due` was written. */
  today: string;
}

const SECTIONS: { bucket: DueBucket; key: string }[] = [
  { bucket: "overdue", key: "robin.todos.overdue" },
  { bucket: "today", key: "robin.todos.today" },
  { bucket: "tomorrow", key: "robin.todos.tomorrow" },
  { bucket: "upcoming", key: "robin.todos.later" },
  { bucket: "none", key: "robin.todos.someday" },
];

/** Due labels are built here rather than in the shared date module, which the
 *  English-only agent tools also use. */
function dueLabel(due: string, today: string, t: (key: string, params?: Record<string, string>) => string): string {
  const bucket = dueBucket(due, today);
  if (bucket === "today") return t("robin.todos.dueToday");
  if (bucket === "tomorrow") return t("robin.todos.dueTomorrow");
  if (bucket === "overdue") return t("robin.todos.dueOverdue", { date: due });
  return due;
}

const BUCKET_COLOR: Partial<Record<DueBucket, string>> = {
  overdue: "var(--danger)",
  today: "var(--accent-amber)",
};

export function TodoPanel() {
  const { t } = useI18n();
  const { data, error, loading, refresh } = usePolledResource<TodosResponse>("/api/robin/todos");
  const [showDone, setShowDone] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const today = data?.today ?? "";
  const todos = useMemo(() => data?.todos ?? [], [data]);
  const open = useMemo(() => todos.filter((todo) => !todo.done), [todos]);
  const done = useMemo(() => todos.filter((todo) => todo.done), [todos]);

  const sections = useMemo(
    () =>
      SECTIONS.map((section) => ({
        ...section,
        items: open
          .filter((todo) => dueBucket(todo.due, today) === section.bucket)
          .sort((a, b) => (a.due ?? "").localeCompare(b.due ?? "")),
      })).filter((section) => section.items.length > 0),
    [open, today],
  );

  async function run(action: () => Promise<void>) {
    try {
      setActionError(null);
      await action();
      await refresh();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  return (
    <section
      className="pi-card flex flex-col gap-3 p-4"
    >
      <header className="flex items-baseline justify-between">
        <h2 className="pi-label">{t("robin.todos.title")}</h2>
        <span className="text-xs" style={{ color: "var(--text-dim)" }}>
          {loading ? t("robin.common.loading") : t("robin.todos.open", { count: String(open.length) })}
        </span>
      </header>

      {(error || actionError) && (
        <p className="text-xs" style={{ color: "var(--accent)" }}>{actionError ?? error}</p>
      )}

      {!loading && open.length === 0 && (
        <p className="py-2 text-sm" style={{ color: "var(--text-dim)" }}>
          {t("robin.todos.empty")}
        </p>
      )}

      {sections.map((section) => (
        <div key={section.bucket} className="flex flex-col gap-1">
          <h3
            className="pi-eyebrow"
            style={{ color: BUCKET_COLOR[section.bucket] ?? "var(--text-dim)" }}
          >
            {t(section.key)}
          </h3>
          {section.items.map((todo) => (
            <TodoRow
              key={todo.id}
              todo={todo}
              today={today}
              onToggle={() => void run(() => mutate("/api/robin/todos", "PATCH", { id: todo.id, done: !todo.done }))}
              onDelete={() => void run(() => mutate("/api/robin/todos", "DELETE", { id: todo.id }))}
              t={t}
            />
          ))}
        </div>
      ))}

      {done.length > 0 && (
        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={() => setShowDone((value) => !value)}
            className="ui-action pi-eyebrow self-start"
          >
            {showDone ? "▾" : "▸"} {t("robin.todos.completed", { count: String(done.length) })}
          </button>
          {showDone && done.map((todo) => (
            <TodoRow
              key={todo.id}
              todo={todo}
              today={today}
              onToggle={() => void run(() => mutate("/api/robin/todos", "PATCH", { id: todo.id, done: false }))}
              onDelete={() => void run(() => mutate("/api/robin/todos", "DELETE", { id: todo.id }))}
              t={t}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function TodoRow({
  todo,
  today,
  onToggle,
  onDelete,
  t,
}: {
  todo: Todo;
  today: string;
  onToggle: () => void;
  onDelete: () => void;
  t: (key: string, params?: Record<string, string>) => string;
}) {
  const overdue = !todo.done && dueBucket(todo.due, today) === "overdue";
  return (
    <div
      className="group flex items-center gap-2 rounded px-2 py-1"
      style={overdue
        ? { background: "var(--danger-soft)", borderLeft: "2px solid var(--danger)" }
        : { background: "var(--bg-subtle)", borderLeft: "2px solid transparent" }}
    >
      <input
        type="checkbox"
        checked={todo.done}
        onChange={onToggle}
        aria-label={todo.done
          ? t("robin.todos.reopen", { title: todo.title })
          : t("robin.todos.complete", { title: todo.title })}
        className="shrink-0 cursor-pointer"
      />
      <span
        className="min-w-0 flex-1 truncate text-sm"
        style={{
          color: todo.done ? "var(--text-dim)" : "var(--text)",
          textDecoration: todo.done ? "line-through" : "none",
        }}
      >
        {todo.title}
      </span>
      {todo.due && !todo.done && (
        <span className="shrink-0 text-xs" style={{ color: overdue ? "var(--danger)" : "var(--text-dim)" }}>
          {dueLabel(todo.due, today, t)}
        </span>
      )}
      <button
        type="button"
        onClick={onDelete}
        aria-label={t("robin.todos.delete", { title: todo.title })}
        className="shrink-0 px-1 text-xs opacity-0 transition-opacity group-hover:opacity-100"
        style={{ color: "var(--text-dim)" }}
      >
        ✕
      </button>
    </div>
  );
}
