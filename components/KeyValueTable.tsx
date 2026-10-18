"use client";

import type { CSSProperties, ReactNode } from "react";

/** The left column: the name of the thing, never the prose around it. */
const LABEL: CSSProperties = {
  padding: "4px 12px 4px 0",
  color: "var(--text-dim)",
  fontSize: 11,
  whiteSpace: "nowrap",
  verticalAlign: "top",
};

const VALUE: CSSProperties = {
  padding: "4px 0",
  color: "var(--text-muted)",
  fontSize: 12,
  fontFamily: "var(--font-mono)",
  overflowWrap: "anywhere",
};

/** A value with newlines of its own: kept as text, scrolled in place, never folded into one line. */
const VALUE_BLOCK: CSSProperties = {
  margin: 0,
  padding: "8px 10px",
  maxHeight: 260,
  overflow: "auto",
  border: "1px solid var(--border)",
  borderRadius: 6,
  background: "var(--bg)",
  color: "var(--text-muted)",
  fontSize: 12,
  lineHeight: 1.5,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
};

export interface KeyValueRow {
  label: string;
  value: ReactNode;
  multiline?: boolean;
}

/**
 * One row per fact: label in the left column, value in mono on the right. A
 * tool call whose arguments are all single values reads this way instead of as
 * a JSON blob — see `lib/tool-fields.ts`.
 */
export function KeyValueTable({ rows }: { rows: KeyValueRow[] }) {
  return (
    <table style={{ borderCollapse: "collapse", tableLayout: "auto" }}>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label}>
            <td style={LABEL}>{row.label}</td>
            <td style={VALUE}>{row.multiline ? <pre style={VALUE_BLOCK}>{row.value}</pre> : row.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
