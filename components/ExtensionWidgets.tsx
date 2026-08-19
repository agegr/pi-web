"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { ExtensionWidgetItem } from "@/lib/types";
import type { FooterPanelData } from "@/lib/footer-status";
import { FooterPanel } from "./FooterPanel";

export const DEFAULT_EXPANDED_WIDGET_LINES = 3;
export const WIDGET_UPDATE_IDLE_MS = 1100;

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

/** Widget key for the filechanges extension. */
const FILECHANGES_WIDGET_KEY = "filechanges";

/**
 * Parse a filechanges widget line into a structured file entry.
 * Lines follow the format: `Δ path/to/file.ts (+5/-2)` or `+ path/to/new-file.ts (+10/-0)`
 * Returns null for non-matching lines (e.g. summary-only lines).
 */
export function parseFilechangeLine(
  line: string,
): { status: string; path: string; added: number; removed: number } | null {
  const match = line.match(/^([Δ+])\s+(.+?)\s+\(\+(\d+)\/-([\d]+)\)$/);
  if (!match) return null;
  return {
    status: match[1] === "+" ? "added" : "modified",
    path: match[2],
    added: Number(match[3]),
    removed: Number(match[4]),
  };
}

/**
 * Compute a compact summary string for the filechanges widget trigger.
 * Example: "Δ 17 files (10 mod / 7 new)" or "Δ 1 file changed".
 */
export function computeFileSummary(lines: string[]): string {
  let modified = 0;
  let added = 0;
  for (const line of lines) {
    const entry = parseFilechangeLine(line);
    if (!entry) continue;
    if (entry.status === "added") added++;
    else modified++;
  }
  const total = modified + added;
  if (total === 0) return "Δ 0 files";
  const parts: string[] = [];
  if (modified > 0) parts.push(`${modified} mod`);
  if (added > 0) parts.push(`${added} new`);
  return `Δ ${total} file${total === 1 ? "" : "s"} (${parts.join(" / ")})`;
}

export function ExtensionWidgets({ widgets, footer = null }: {
  widgets: ExtensionWidgetItem[];
  /** Optional structured footer panel data (see lib/footer-status.ts). */
  footer?: FooterPanelData | null;
}) {
  const { t } = useI18n();
  const idPrefix = useId();
  const previousContentsRef = useRef<Map<string, string[]> | null>(null);
  const updateClearTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [expandedWidgetKey, setExpandedWidgetKey] = useState<string | null>(
    () => getDefaultExpandedWidgetKey(widgets),
  );
  const [footerExpanded, setFooterExpanded] = useState(false);
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

  if (widgets.length === 0 && !footer) return null;

  const expandedWidget = widgets.find((widget) => (
    widget.key === expandedWidgetKey
    && widget.lines.length >= 1
  ));

  const toggleWidget = (widget: ExtensionWidgetItem) => {
    setFooterExpanded(false);
    setExpandedWidgetKey((current) => getNextExpandedWidgetKey(current, widget.key));
  };

  const toggleFooter = () => {
    setExpandedWidgetKey(null);
    setFooterExpanded((current) => !current);
  };

  const footerId = `${idPrefix}-trigger-footer`;
  const footerPanelId = `${idPrefix}-panel-footer`;

  return (
    <>
      {expandedWidget && (
        <div className="extension-widget-panels">
          {(() => {
            const widget = expandedWidget;
            const index = widgets.indexOf(widget);
            const triggerId = `${idPrefix}-trigger-${index}`;
            const panelId = `${idPrefix}-panel-${index}`;
            return (
              <section
                key={widget.key}
                id={panelId}
                className="extension-widget-panel"
                aria-labelledby={triggerId}
              >
                <div className="extension-widget-panel-heading">{widget.key}</div>
                {widget.key === FILECHANGES_WIDGET_KEY ? (
                  <div className="extension-widget-content extension-widget-file-list">
                    {widget.lines.map((line, i) => {
                      const entry = parseFilechangeLine(line);
                      return entry ? (
                        <div key={i} className="extension-widget-file-entry">
                          <span className="extension-widget-file-status" data-status={entry.status}>
                            {entry.status === "added" ? "+" : "✎"}
                          </span>
                          <span className="extension-widget-file-path">{entry.path}</span>
                          <span className="extension-widget-file-changes">
                            +{entry.added}/-{entry.removed}
                          </span>
                        </div>
                      ) : (
                        <div key={i} className="extension-widget-file-entry">
                          <span className="extension-widget-file-path">{line}</span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <pre className="extension-widget-content">
                    {formatExtensionWidgetContent(widget.lines)}
                  </pre>
                )}
              </section>
            );
          })()}
        </div>
      )}
      {footer && footerExpanded && (
        <div className="extension-widget-panels">
          <section
            id={footerPanelId}
            className="extension-widget-panel"
            aria-labelledby={footerId}
          >
            <div className="extension-widget-panel-heading">Details</div>
            <FooterPanel data={footer} />
          </section>
        </div>
      )}
      <div className="extension-widget-triggers" aria-label={t("chat.extensionWidgets")}>
        {widgets.map((widget, index) => {
          // Any widget with content is clickable — even a single-line summary
          // (e.g. filechanges collapsed mode). The panel shows all lines.
          const expandable = widget.lines.length >= 1;
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
          const isFilechanges = widget.key === FILECHANGES_WIDGET_KEY;
          const summary = isFilechanges ? computeFileSummary(widget.lines) : null;
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
              <span className="extension-widget-key">
                {summary ?? widget.key}
              </span>
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
        {footer && (
          <button
            key="footer"
            id={footerId}
            type="button"
            className={`extension-widget-trigger${footerExpanded ? " is-expanded" : ""}`}
            aria-controls={footerPanelId}
            aria-expanded={footerExpanded}
            title={`Details - ${footerExpanded ? t("i18n.collapse") : t("i18n.expand")}`}
            onClick={toggleFooter}
          >
            <span className="extension-widget-update-pulse" aria-hidden="true" />
            <span className="extension-widget-placement" aria-hidden="true">
              <svg
                className="extension-widget-placement-icon"
                viewBox="0 0 8 6"
                width="8"
                height="6"
                data-direction="up"
                focusable="false"
              >
                <path d="M4 0l4 6H0z" />
              </svg>
            </span>
            <span className="extension-widget-key">Details</span>
          </button>
        )}
      </div>
    </>
  );
}
