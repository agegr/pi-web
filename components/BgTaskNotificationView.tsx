"use client";

import { useMemo } from "react";
import { parseBgTaskReport } from "@/lib/bg-task-notification";

const LABEL: React.CSSProperties = {
  padding: "4px 12px 4px 0",
  color: "var(--text-dim)",
  fontSize: 11,
  whiteSpace: "nowrap",
  verticalAlign: "top",
};

const VALUE: React.CSSProperties = {
  padding: "4px 0",
  color: "var(--text-muted)",
  fontSize: 12,
  fontFamily: "var(--font-mono)",
  overflowWrap: "anywhere",
};

/**
 * A settled background bash task, shown as its facts rather than as the raw
 * report text: the model-only prefix never reaches the screen, and the fields
 * read as a table instead of prose.
 */
export function BgTaskNotificationView({ text }: { text: string }) {
  const report = useMemo(() => parseBgTaskReport(text), [text]);
  if (!report) return null;
  const rows: Array<[string, string]> = [
    ["Outcome", `${report.outcome} in ${report.duration}s`],
    ["Command", report.command],
    ["Log file", report.logPath],
  ];
  return (
    <div style={{ fontSize: 12 }}>
      <table style={{ borderCollapse: "collapse", tableLayout: "auto" }}>
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label}>
              <td style={LABEL}>{label}</td>
              <td style={VALUE}>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: 8 }}>
        <div style={{ ...LABEL, padding: "0 0 4px" }}>Output tail</div>
        <pre
          style={{
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
          }}
        >
          {report.tail}
        </pre>
      </div>
    </div>
  );
}