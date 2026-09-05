/**
 * JsonParamList — renders a JSON object as a parameter list.
 *
 * First layer is shown as a clean key-value list. Nested objects/arrays
 * are collapsed by default and can be expanded to show the raw JSON.
 * Long string values are truncated with a "show more" toggle.
 */

import { useState, useMemo } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark, vs } from "react-syntax-highlighter/dist/esm/styles/prism";
import { useTheme } from "@/hooks/useTheme";

interface JsonParamListProps {
  data: Record<string, unknown>;
  maxStringLength?: number;
  isError?: boolean;
}

/**
 * Render a JSON value as a parameter list.
 * - Top-level: key-value list
 * - Nested objects/arrays: collapsible summary
 * - Long strings: truncated with toggle
 */
export function JsonParamList({ data, maxStringLength = 200, isError = false }: JsonParamListProps) {
  if (!data || Object.keys(data).length === 0) {
    return <div style={{ padding: "8px 10px", color: "var(--text-muted)", fontSize: 12 }}>No parameters</div>;
  }

  const entries = Object.entries(data);

  return (
    <div
      style={{
        padding: "8px 10px",
        background: "var(--bg-subtle)",
        borderTop: `1px solid ${isError ? "rgba(248,113,113,0.3)" : "rgba(34,197,94,0.15)"}`,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {entries.map(([key, value]) => (
          <ParamRow key={key} name={key} value={value} maxStringLength={maxStringLength} isError={isError} />
        ))}
      </div>
    </div>
  );
}

interface ParamRowProps {
  name: string;
  value: unknown;
  maxStringLength: number;
  isError: boolean;
}

function ParamRow({ name, value, maxStringLength, isError }: ParamRowProps) {
  if (value === null || value === undefined) {
    return (
      <div style={{ display: "flex", gap: 8, fontSize: 12, fontFamily: "var(--font-mono)" }}>
        <span style={{ color: "var(--accent)", fontWeight: 500 }}>{name}:</span>
        <span style={{ color: "var(--text-dim)" }}>null</span>
      </div>
    );
  }

  if (typeof value === "string") {
    return <StringParam name={name} value={value} maxStringLength={maxStringLength} />;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return (
      <div style={{ display: "flex", gap: 8, fontSize: 12, fontFamily: "var(--font-mono)" }}>
        <span style={{ color: "var(--accent)", fontWeight: 500 }}>{name}:</span>
        <span style={{ color: "var(--text-muted)" }}>{String(value)}</span>
      </div>
    );
  }

  if (Array.isArray(value)) {
    return <ArrayParam name={name} value={value} maxStringLength={maxStringLength} />;
  }

  if (typeof value === "object") {
    return <ObjectParam name={name} value={value as Record<string, unknown>} maxStringLength={maxStringLength} isError={isError} />;
  }

  return (
    <div style={{ display: "flex", gap: 8, fontSize: 12, fontFamily: "var(--font-mono)" }}>
      <span style={{ color: "var(--accent)", fontWeight: 500 }}>{name}:</span>
      <span style={{ color: "var(--text-muted)" }}>{String(value)}</span>
    </div>
  );
}

interface StringParamProps {
  name: string;
  value: string;
  maxStringLength: number;
}

function StringParam({ name, value, maxStringLength }: StringParamProps) {
  const [expanded, setExpanded] = useState(false);
  const isLong = value.length > maxStringLength;
  const displayValue = isLong && !expanded ? `${value.slice(0, maxStringLength)}...` : value;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 12, fontFamily: "var(--font-mono)" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
        <span style={{ color: "var(--accent)", fontWeight: 500, flexShrink: 0 }}>{name}:</span>
        <span style={{ color: "var(--text-muted)", wordBreak: "break-all" }}>
          {displayValue}
          {isLong && !expanded && (
            <button
              onClick={() => setExpanded(true)}
              style={{
                background: "none",
                border: "none",
                color: "var(--accent)",
                cursor: "pointer",
                fontSize: 11,
                padding: "0 4px",
                marginLeft: 4,
              }}
            >
              show more
            </button>
          )}
        </span>
      </div>
      {expanded && isLong && (
        <div style={{ marginLeft: 8 }}>
          <div style={{ color: "var(--text-dim)", fontSize: 11, marginBottom: 4 }}>
            Full value ({value.length} chars)
          </div>
          <pre
            style={{
              margin: 0,
              padding: 8,
              background: "var(--bg-panel)",
              borderRadius: 4,
              fontSize: 11,
              lineHeight: 1.4,
              overflow: "auto",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {value}
          </pre>
        </div>
      )}
    </div>
  );
}

interface ArrayParamProps {
  name: string;
  value: unknown[];
  maxStringLength: number;
}

function ArrayParam({ name, value, maxStringLength }: ArrayParamProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 12, fontFamily: "var(--font-mono)" }}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          display: "flex",
          gap: 8,
          alignItems: "flex-start",
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: 0,
          width: "100%",
          textAlign: "left",
          fontFamily: "inherit",
        }}
      >
        <span style={{ color: "var(--accent)", fontWeight: 500, flexShrink: 0 }}>{name}:</span>
        <span style={{ color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 4 }}>
          [{value.length} items]
          <span style={{ color: "var(--text-dim)", fontSize: 10 }}>{expanded ? "▼" : "▶"}</span>
        </span>
      </button>
      {expanded && (
        <div style={{ marginLeft: 8, width: "calc(100% - 16px)" }}>
          <JsonRawView data={value} />
        </div>
      )}
    </div>
  );
}

interface ObjectParamProps {
  name: string;
  value: Record<string, unknown>;
  maxStringLength: number;
  isError: boolean;
}

function ObjectParam({ name, value, maxStringLength, isError }: ObjectParamProps) {
  const [expanded, setExpanded] = useState(false);
  const keys = Object.keys(value);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 12, fontFamily: "var(--font-mono)" }}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          display: "flex",
          gap: 8,
          alignItems: "flex-start",
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: 0,
          width: "100%",
          textAlign: "left",
          fontFamily: "inherit",
        }}
      >
        <span style={{ color: "var(--accent)", fontWeight: 500, flexShrink: 0 }}>{name}:</span>
        <span style={{ color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 4 }}>
          {`{${keys.length} keys}`}
          <span style={{ color: "var(--text-dim)", fontSize: 10 }}>{expanded ? "▼" : "▶"}</span>
        </span>
      </button>
      {expanded && (
        <div style={{ marginLeft: 8, width: "calc(100% - 16px)" }}>
          <JsonParamList data={value} maxStringLength={maxStringLength} isError={isError} />
        </div>
      )}
    </div>
  );
}

interface JsonRawViewProps {
  data: unknown;
}

function JsonRawView({ data }: JsonRawViewProps) {
  const { isDark } = useTheme();
  const jsonStr = useMemo(() => JSON.stringify(data, null, 2), [data]);

  return (
    <SyntaxHighlighter
      language="json"
      customStyle={{
        margin: 0,
        padding: 8,
        borderRadius: 4,
        fontSize: 11,
        lineHeight: 1.4,
        background: "var(--bg-panel)",
      }}
      wrapLongLines={true}
    >
      {jsonStr}
    </SyntaxHighlighter>
  );
}
