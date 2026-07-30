"use client";

import { parseAnsiLine, stripAnsi } from "@/lib/ansi";
import type { ExtensionStatusItem } from "@/lib/types";

export function sanitizeExtensionStatusText(text: string): string {
  return text
    .replace(/[\r\n\t]/g, " ")
    .replace(/ +/g, " ")
    .trim();
}

export function formatExtensionStatusLine(statuses: ExtensionStatusItem[]): string {
  return [...statuses]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map(({ text }) => sanitizeExtensionStatusText(text))
    .join(" ");
}

export function ExtensionStatusBar({ statuses }: { statuses: ExtensionStatusItem[] }) {
  if (statuses.length === 0) return null;

  const statusLine = formatExtensionStatusLine(statuses);
  const plainStatusLine = stripAnsi(statusLine);

  return (
    <div
      role="status"
      aria-label={plainStatusLine}
      title={plainStatusLine}
      style={{
        display: "flex",
        alignItems: "center",
        flexShrink: 0,
        minWidth: 0,
        height: 36,
        padding: "0 12px",
        borderTop: "1px solid var(--border)",
        background: "transparent",
      }}
    >
      <span
        style={{
          minWidth: 0,
          overflow: "hidden",
          color: "var(--text-muted)",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {parseAnsiLine(statusLine).map((segment, index) => (
          <span key={index} style={segment.style}>{segment.text}</span>
        ))}
      </span>
    </div>
  );
}
