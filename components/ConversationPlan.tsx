"use client";

import { Check, ChevronRight, Circle, CircleDot, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { stripAnsi } from "@/lib/ansi";
import { useI18n } from "@/hooks/useI18n";
import type { ExtensionWidgetItem } from "@/lib/types";

type TodoStatus = "pending" | "in_progress" | "completed" | "deleted";

interface TodoWidgetModel {
  hasOpenItems: boolean;
  completed: number;
  total: number;
  items: Array<{ status: TodoStatus; text: string; detail?: string }>;
  summary?: string;
}

const TODO_STATUS: Record<string, TodoStatus> = {
  "○": "pending",
  "◐": "in_progress",
  "✓": "completed",
  "✗": "deleted",
};

const TODO_STATUS_LABEL_KEYS: Record<TodoStatus, "chat.planPending" | "chat.planInProgress" | "chat.planCompleted" | "chat.planDeleted"> = {
  pending: "chat.planPending",
  in_progress: "chat.planInProgress",
  completed: "chat.planCompleted",
  deleted: "chat.planDeleted",
};

export function parseTodoWidget(lines: string[], title?: string): TodoWidgetModel | null {
  const cleanLines = lines.map((line) => stripAnsi(line).trimEnd()).filter(Boolean);
  const heading = cleanLines[0] ?? (title ? stripAnsi(title) : "");
  const headingMatch = heading.match(/^([●○])\s+.+?\s+\((\d+)\/(\d+)\)$/);
  if (!headingMatch) return null;

  const items: TodoWidgetModel["items"] = [];
  let summary: string | undefined;
  for (const line of cleanLines.slice(1)) {
    const row = line.match(/^[├└]─\s+([○◐✓✗])(?:\s+#\d+)?\s+(.+)$/);
    if (!row) {
      const summaryMatch = line.match(/^[├└]─\s+(\+\d+\s+.+\(\d+\s+.+\))$/);
      if (!summaryMatch) return null;
      summary = summaryMatch[1];
      continue;
    }
    const status = TODO_STATUS[row[1]];
    let text = row[2];
    let detail: string | undefined;
    if (status === "in_progress") {
      const detailMatch = text.match(/^(.*?)\s+\(([^()]*)\)$/);
      if (detailMatch) [, text, detail] = detailMatch;
    }
    items.push({ status, text, ...(detail ? { detail } : {}) });
  }

  return {
    hasOpenItems: headingMatch[1] === "●",
    completed: Number(headingMatch[2]),
    total: Number(headingMatch[3]),
    items,
    ...(summary ? { summary } : {}),
  };
}

export function getConversationPlanWidget(widgets: ExtensionWidgetItem[]) {
  return widgets.find((widget) => (
    widget.key === "rpiv-todos" && parseTodoWidget(widget.lines, widget.title)
  ));
}

export function shouldRequestPlanItems(expanded: boolean, itemCount: number) {
  return !expanded && itemCount === 0;
}

function StatusIcon({ status }: { status: TodoStatus }) {
  if (status === "completed") return <Check size={13} aria-hidden="true" />;
  if (status === "in_progress") return (
    <>
      <LoaderCircle size={13} className="conversation-plan-spinner" aria-hidden="true" />
      <CircleDot size={11} className="conversation-plan-active-static" aria-hidden="true" />
    </>
  );
  return <Circle size={11} aria-hidden="true" />;
}

export function ConversationPlan({
  widget,
  defaultExpanded = false,
  onRequestItems,
}: {
  widget: ExtensionWidgetItem;
  defaultExpanded?: boolean;
  onRequestItems?: () => void;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const model = parseTodoWidget(widget.lines, widget.title);
  if (!model) return null;
  const summaryStatus: TodoStatus = model.items.some((item) => item.status === "in_progress")
    ? "in_progress"
    : model.hasOpenItems ? "pending" : "completed";
  const hasDetails = model.items.length > 0 || Boolean(model.summary);

  const toggle = () => {
    if (shouldRequestPlanItems(expanded, model.items.length)) onRequestItems?.();
    setExpanded((value) => !value);
  };

  return (
    <section className="conversation-plan" aria-label={t("chat.updatePlan")}>
      <button
        type="button"
        className="conversation-plan-summary"
        aria-expanded={expanded}
        aria-label={`${t("chat.updatePlan")}: ${t(TODO_STATUS_LABEL_KEYS[summaryStatus])}, ${model.completed}/${model.total}`}
        aria-live="polite"
        aria-atomic="true"
        onClick={toggle}
        title={t(expanded ? "i18n.collapse" : "i18n.expand")}
      >
        <span className="conversation-plan-mark" data-status={summaryStatus} aria-hidden="true"><StatusIcon status={summaryStatus} /></span>
        <strong>{t("chat.updatePlan")}</strong>
        <span className="conversation-plan-count">{model.completed}/{model.total}</span>
        <ChevronRight size={13} aria-hidden="true" className="conversation-plan-chevron" />
      </button>
      {hasDetails ? (
        <div className="conversation-plan-items" data-expanded={expanded} aria-hidden={!expanded}>
          <div className="conversation-plan-items-inner">
            <div className="conversation-plan-items-content" role="list">
              {model.items.map((item, index) => (
                <div
                  className="conversation-plan-item"
                  data-status={item.status}
                  key={`${item.text}:${index}`}
                  role="listitem"
                  aria-label={`${t(TODO_STATUS_LABEL_KEYS[item.status])}: ${item.text}${item.detail ? `, ${item.detail}` : ""}`}
                >
                  <span className="conversation-plan-status"><StatusIcon status={item.status} /></span>
                  <span className="conversation-plan-copy">
                    <span>{item.text}</span>
                    {item.detail ? <small>{item.detail}</small> : null}
                  </span>
                </div>
              ))}
              {model.summary ? <div className="conversation-plan-more">{model.summary}</div> : null}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
