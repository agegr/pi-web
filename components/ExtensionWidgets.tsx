"use client";

import { CheckCircle2, ChevronDown, ChevronRight, Circle, LoaderCircle } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { stripAnsi } from "@/lib/ansi";
import { useI18n } from "@/hooks/useI18n";
import type { ExtensionWidgetItem } from "@/lib/types";

export const DEFAULT_EXPANDED_WIDGET_LINES = 3;
export const WIDGET_UPDATE_IDLE_MS = 1100;

const WIDGET_TOGGLE_COMMANDS: Record<string, string> = {
  "rpiv-todos": "todos-toggle",
};

type TodoStatus = "pending" | "in_progress" | "completed" | "deleted";

interface TodoWidgetModel {
  label: string;
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

export function parseTodoWidget(lines: string[], title?: string): TodoWidgetModel | null {
  const cleanLines = lines.map((line) => stripAnsi(line).trimEnd()).filter(Boolean);
  const heading = cleanLines[0] ?? (title ? stripAnsi(title) : "");
  const headingMatch = heading.match(/^[●○]\s+(.+?)\s+\((\d+)\/(\d+)\)$/);
  if (!headingMatch) return null;

  const items: TodoWidgetModel["items"] = [];
  let summary: string | undefined;
  for (const line of cleanLines.slice(1)) {
    const row = line.match(/^[├└]─\s+([○◐✓✗])(?:\s+#\d+)?\s+(.+)$/);
    if (!row) {
      const summaryMatch = line.match(/^[├└]─\s+(.+)$/);
      if (summaryMatch) summary = summaryMatch[1];
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
    label: headingMatch[1],
    completed: Number(headingMatch[2]),
    total: Number(headingMatch[3]),
    items,
    ...(summary ? { summary } : {}),
  };
}

function TodoStatusIcon({ status }: { status: TodoStatus }) {
  if (status === "completed") return <CheckCircle2 size={14} aria-hidden="true" />;
  if (status === "in_progress") return <LoaderCircle size={14} aria-hidden="true" />;
  if (status === "deleted") return <Circle size={14} aria-hidden="true" />;
  return <Circle size={14} aria-hidden="true" />;
}

function CodexTodoPanel({ widget, onToggle }: {
  widget: ExtensionWidgetItem;
  onToggle?: () => void;
}) {
  const { t } = useI18n();
  const model = parseTodoWidget(widget.lines, widget.title);
  if (!model) return null;
  const collapsed = model.items.length === 0;

  return (
    <section className="codex-todo-panel" aria-label={model.label}>
      <div className="codex-todo-heading">
        <strong>{model.label}</strong>
        <span className="codex-todo-count">{model.completed}/{model.total}</span>
        {onToggle ? (
          <button type="button" onClick={onToggle} aria-label={t(collapsed ? "i18n.expand" : "i18n.collapse")}>
            {collapsed ? <ChevronRight size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
          </button>
        ) : null}
      </div>
      {!collapsed ? (
        <div className="codex-todo-list">
          {model.items.map((item, index) => (
            <div className="codex-todo-item" data-status={item.status} key={`${item.status}:${item.text}:${index}`}>
              <span className="codex-todo-status"><TodoStatusIcon status={item.status} /></span>
              <span className="codex-todo-copy">
                <span>{item.text}</span>
                {item.detail ? <small>{item.detail}</small> : null}
              </span>
            </div>
          ))}
          {model.summary ? <div className="codex-todo-summary">{model.summary}</div> : null}
        </div>
      ) : null}
    </section>
  );
}

export function formatExtensionWidgetContent(lines: string[]): string {
  return lines.join("\n");
}

export function snapshotExtensionWidgetContents(
  widgets: ExtensionWidgetItem[],
): Map<string, string[]> {
  return new Map(widgets.map((widget) => [widget.key, [...widget.lines]]));
}

export function getUpdatedExtensionWidgetKeys(
  previous: ReadonlyMap<string, readonly string[]> | null,
  next: ReadonlyMap<string, readonly string[]>,
): string[] {
  if (!previous) return [];
  return Array.from(next, ([key, lines]) => {
    const previousLines = previous.get(key);
    if (!previousLines || previousLines.length !== lines.length) {
      return previousLines ? key : null;
    }
    return lines.some((line, index) => line !== previousLines[index]) ? key : null;
  }).filter((key): key is string => key !== null);
}

function getDefaultExpandedWidgetKey(widgets: ExtensionWidgetItem[]): string | null {
  return widgets.find((widget) => {
    if (widget.key === "rpiv-todos" && parseTodoWidget(widget.lines, widget.title)) return false;
    const lineCount = widget.lines.length;
    return lineCount > 1 && lineCount <= DEFAULT_EXPANDED_WIDGET_LINES;
  })?.key ?? null;
}

export function getNextExpandedWidgetKey(
  currentKey: string | null,
  requestedKey: string,
): string | null {
  return currentKey === requestedKey ? null : requestedKey;
}

export function ExtensionWidgets({ widgets, onRunCommand }: {
  widgets: ExtensionWidgetItem[];
  onRunCommand?: (command: string) => void;
}) {
  const { t } = useI18n();
  const idPrefix = useId();
  const previousContentsRef = useRef<Map<string, string[]> | null>(null);
  const updateClearTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [expandedWidgetKey, setExpandedWidgetKey] = useState<string | null>(
    () => getDefaultExpandedWidgetKey(widgets),
  );
  const [updatingWidgetKeys, setUpdatingWidgetKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  useEffect(() => {
    const nextContents = snapshotExtensionWidgetContents(widgets);
    const updatedKeys = getUpdatedExtensionWidgetKeys(
      previousContentsRef.current,
      nextContents,
    );
    previousContentsRef.current = nextContents;

    for (const [key, timer] of updateClearTimersRef.current) {
      if (nextContents.has(key)) continue;
      clearTimeout(timer);
      updateClearTimersRef.current.delete(key);
    }

    setUpdatingWidgetKeys((current) => {
      const next = new Set(Array.from(current).filter((key) => nextContents.has(key)));
      for (const key of updatedKeys) next.add(key);
      if (
        next.size === current.size
        && Array.from(next).every((key) => current.has(key))
      ) return current;
      return next;
    });

    for (const key of updatedKeys) {
      const currentTimer = updateClearTimersRef.current.get(key);
      if (currentTimer) clearTimeout(currentTimer);
      updateClearTimersRef.current.set(key, setTimeout(() => {
        updateClearTimersRef.current.delete(key);
        setUpdatingWidgetKeys((current) => {
          if (!current.has(key)) return current;
          const next = new Set(current);
          next.delete(key);
          return next;
        });
      }, WIDGET_UPDATE_IDLE_MS));
    }
  }, [widgets]);

  useEffect(() => () => {
    for (const timer of updateClearTimersRef.current.values()) clearTimeout(timer);
    updateClearTimersRef.current.clear();
  }, []);

  if (widgets.length === 0) return null;

  const todoWidget = widgets.find((widget) => widget.key === "rpiv-todos");
  const todoModel = todoWidget ? parseTodoWidget(todoWidget.lines, todoWidget.title) : null;
  const genericWidgets = todoModel ? widgets.filter((widget) => widget !== todoWidget) : widgets;
  const expandedWidget = genericWidgets.find((widget) => (
    widget.key === expandedWidgetKey
    && widget.lines.length > 1
  ));

  const toggleWidget = (widget: ExtensionWidgetItem) => {
    setExpandedWidgetKey((current) => getNextExpandedWidgetKey(current, widget.key));
  };

  return (
    <>
      {todoWidget && todoModel ? (
        <CodexTodoPanel
          widget={todoWidget}
          onToggle={onRunCommand ? () => onRunCommand(WIDGET_TOGGLE_COMMANDS[todoWidget.key]) : undefined}
        />
      ) : null}
      {expandedWidget && (
        <div className="extension-widget-panels">
          {(() => {
            const widget = expandedWidget;
            const index = genericWidgets.indexOf(widget);
            const triggerId = `${idPrefix}-trigger-${index}`;
            const panelId = `${idPrefix}-panel-${index}`;
            const toggleCommand = onRunCommand ? WIDGET_TOGGLE_COMMANDS[widget.key] : undefined;
            return (
              <section
                key={widget.key}
                id={panelId}
                className="extension-widget-panel"
                aria-labelledby={triggerId}
              >
                <div className="extension-widget-panel-heading">
                  <span>{widget.title ?? widget.key}</span>
                  {toggleCommand && (
                    <button type="button" onClick={() => onRunCommand?.(toggleCommand)}>
                      {t("i18n.collapsePanel")}
                    </button>
                  )}
                </div>
                <pre className="extension-widget-content">
                  {formatExtensionWidgetContent(widget.lines)}
                </pre>
              </section>
            );
          })()}
        </div>
      )}
      {genericWidgets.length > 0 ? (
      <div className="extension-widget-triggers" aria-label={t("chat.extensionWidgets")}>
        {genericWidgets.map((widget, index) => {
          const expandable = widget.lines.length > 1;
          const expanded = expandable && widget.key === expandedWidget?.key;
          const updating = updatingWidgetKeys.has(widget.key);
          const lineCountLabel = t(
            widget.lines.length === 1 ? "chat.extensionWidgetLine" : "chat.extensionWidgetLines",
            { count: widget.lines.length },
          );
          const placementLabel = t(
            widget.placement === "belowEditor"
              ? "chat.extensionWidgetBelow"
              : "chat.extensionWidgetAbove",
          );
          const triggerId = `${idPrefix}-trigger-${index}`;
          const panelId = `${idPrefix}-panel-${index}`;
          const content = (
            <>
              <span className="extension-widget-update-pulse" aria-hidden="true" />
              <span className="extension-widget-placement" aria-hidden="true">
                <svg
                  className="extension-widget-placement-icon"
                  viewBox="0 0 8 6"
                  width="8"
                  height="6"
                  data-direction={widget.placement === "belowEditor" ? "down" : "up"}
                  focusable="false"
                >
                  <path
                    d={widget.placement === "belowEditor"
                      ? "M0 0h8L4 6z"
                      : "M4 0l4 6H0z"}
                  />
                </svg>
              </span>
              <span className="extension-widget-key">{widget.key}</span>
            </>
          );

          return expandable ? (
            <button
              key={widget.key}
              id={triggerId}
              type="button"
              className={`extension-widget-trigger${expanded ? " is-expanded" : ""}${updating ? " is-updating" : ""}`}
              aria-controls={panelId}
              aria-expanded={expanded}
              aria-label={`${placementLabel}: ${widget.key}, ${lineCountLabel}`}
              title={`${widget.key} - ${placementLabel} - ${expanded ? t("i18n.collapse") : t("i18n.expand")}`}
              onClick={() => toggleWidget(widget)}
            >
              {content}
            </button>
          ) : (
            <div
              key={widget.key}
              className={`extension-widget-trigger${updating ? " is-updating" : ""}`}
              aria-label={`${placementLabel}: ${widget.key}, ${lineCountLabel}`}
              title={`${widget.key} - ${placementLabel}`}
            >
              {content}
            </div>
          );
        })}
      </div>
      ) : null}
    </>
  );
}
