"use client";

import { useI18n } from "@/hooks/useI18n";
import { ChevronDown } from "lucide-react";
import type { ExtensionWidgetItem } from "@/lib/types";

export const MAX_EXTENSION_WIDGET_LINES = 10;

/** Widget keys whose title bar gets a collapse/expand action button.
 *  The button runs the matching extension slash command (see onRunCommand),
 *  because Pi Web forwards no extension keyboard shortcuts. */
const WIDGET_TOGGLE_COMMANDS: Record<string, string> = {
  "rpiv-todos": "todos-toggle",
};

function getDisplayLines(lines: string[]): string[] {
  if (lines.length <= MAX_EXTENSION_WIDGET_LINES) return lines;
  return [
    ...lines.slice(0, MAX_EXTENSION_WIDGET_LINES),
    "... (widget truncated)",
  ];
}

export function ExtensionWidgets({ widgets, onRunCommand }: {
  widgets: ExtensionWidgetItem[];
  onRunCommand?: (command: string) => void;
}) {
  const { t } = useI18n();
  if (widgets.length === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
      {widgets.map((widget) => {
        const toggleCommand = onRunCommand ? WIDGET_TOGGLE_COMMANDS[widget.key] : undefined;
        return (
          <div
            key={widget.key}
            style={{
              border: "1px solid var(--border)",
              borderRadius: 7,
              background: "var(--bg-panel)",
              overflow: "hidden",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 9px", borderBottom: "1px solid var(--border)", color: "var(--text-dim)", fontSize: 11, fontFamily: "var(--font-mono)" }}>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{widget.title ?? widget.key}</span>
              {toggleCommand && (
                <button
                  onClick={() => onRunCommand?.(toggleCommand)}
                  title={`Collapse or expand (/${toggleCommand})`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "1px 6px",
                    background: "none",
                    border: "1px solid var(--border)",
                    borderRadius: 4,
                    cursor: "pointer",
                    color: "var(--text-muted)",
                    fontFamily: "var(--font-mono)",
                    fontSize: 10,
                    lineHeight: 1.6,
                    flexShrink: 0,
                  }}
                >
                  <ChevronDown size={9} strokeWidth={1.6} aria-hidden="true" />
                  {t("i18n.collapsePanel")}
                </button>
              )}
            </div>
            {widget.lines.length > 0 && (
              <pre style={{ margin: 0, padding: "8px 9px", color: "var(--text-muted)", fontSize: 12, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "var(--font-mono)" }}>
                {getDisplayLines(widget.lines).join("\n")}
              </pre>
            )}
          </div>
        );
      })}
    </div>
  );
}
