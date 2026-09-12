/**
 * JsonParamList — renders a JSON object as a parameter list.
 *
 * First layer is shown as a clean key-value list with type-aware colors and
 * an aligned key column. Nested objects/arrays are collapsed by default and
 * expand into an indented tree (with guide line). Long string values are
 * truncated with a "show more" toggle.
 */

import { useState } from "react";

interface JsonParamListProps {
  data: Record<string, unknown>;
  maxStringLength?: number;
  isError?: boolean;
  /** Nested rendering: no background plate or top divider line. */
  bare?: boolean;
}

/**
 * Compute a mono-space key-column width (in ch) so every value in one level
 * starts at the same column. `+ 1` leaves room for the colon/gap.
 */
function keyColumnWidth(entries: [string, unknown][]): string {
  const maxLen = entries.reduce((n, [k]) => Math.max(n, k.length), 0);
  return `${maxLen + 1}ch`;
}

/**
 * Render a JSON value as a parameter list.
 * - Top-level: key-value list
 * - Nested objects/arrays: collapsible summary expanding into a tree
 * - Long strings: truncated with toggle
 */
export function JsonParamList({ data, maxStringLength = 200, isError = false, bare = false }: JsonParamListProps) {
  if (!data || Object.keys(data).length === 0) {
    return <div style={{ padding: "8px 10px", color: "var(--text-muted)", fontSize: "calc(12px + var(--chat-font-size-offset, 0px))" }}>No parameters</div>;
  }

  const entries = Object.entries(data);
  const colWidth = keyColumnWidth(entries);

  return (
    <div
      style={bare
        ? { padding: "2px 0" }
        : {
            padding: "8px 10px",
            background: "var(--bg-subtle)",
            borderTop: `1px solid ${isError ? "rgba(248,113,113,0.3)" : "rgba(34,197,94,0.15)"}`,
          }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {entries.map(([key, value]) => (
          <ParamRow key={key} name={key} value={value} colWidth={colWidth} maxStringLength={maxStringLength} isError={isError} />
        ))}
      </div>
    </div>
  );
}

interface ParamRowProps {
  name: string;
  value: unknown;
  colWidth: string;
  maxStringLength: number;
  isError: boolean;
}

function ParamRow({ name, value, colWidth, maxStringLength, isError }: ParamRowProps) {
  if (value === null || value === undefined) {
    return (
      <div style={{ display: "flex", gap: 6, fontSize: "calc(12px + var(--chat-font-size-offset, 0px))", fontFamily: "var(--font-mono)" }}>
        <span style={{ color: "var(--accent)", fontWeight: 500, flexShrink: 0, minWidth: colWidth }}>{name}:</span>
        <span style={{ color: "var(--text-dim)" }}>null</span>
      </div>
    );
  }

  if (typeof value === "string") {
    return <StringParam name={name} value={value} colWidth={colWidth} maxStringLength={maxStringLength} />;
  }

  if (typeof value === "number") {
    return (
      <div style={{ display: "flex", gap: 6, fontSize: "calc(12px + var(--chat-font-size-offset, 0px))", fontFamily: "var(--font-mono)" }}>
        <span style={{ color: "var(--accent)", fontWeight: 500, flexShrink: 0, minWidth: colWidth }}>{name}:</span>
        <span style={{ color: "var(--json-number)" }}>{String(value)}</span>
      </div>
    );
  }

  if (typeof value === "boolean") {
    return (
      <div style={{ display: "flex", gap: 6, fontSize: "calc(12px + var(--chat-font-size-offset, 0px))", fontFamily: "var(--font-mono)" }}>
        <span style={{ color: "var(--accent)", fontWeight: 500, flexShrink: 0, minWidth: colWidth }}>{name}:</span>
        <span style={{ color: "var(--json-boolean)" }}>{String(value)}</span>
      </div>
    );
  }

  if (Array.isArray(value)) {
    // Scalar arrays render inline as a compact literal (no expand / no pre block).
    return isSimpleArray(value)
      ? <SimpleArrayParam name={name} value={value} colWidth={colWidth} />
      : <ArrayParam name={name} value={value} colWidth={colWidth} maxStringLength={maxStringLength} isError={isError} />;
  }

  if (typeof value === "object") {
    return <ObjectParam name={name} value={value as Record<string, unknown>} colWidth={colWidth} maxStringLength={maxStringLength} isError={isError} />;
  }

  return (
    <div style={{ display: "flex", gap: 6, fontSize: "calc(12px + var(--chat-font-size-offset, 0px))", fontFamily: "var(--font-mono)" }}>
      <span style={{ color: "var(--accent)", fontWeight: 500, flexShrink: 0, minWidth: colWidth }}>{name}:</span>
      <span style={{ color: "var(--text-muted)" }}>{String(value)}</span>
    </div>
  );
}

function isSimpleArray(value: unknown[]): boolean {
  return value.every((item) => item === null || typeof item !== "object");
}

function scalarColor(item: unknown): string {
  if (typeof item === "string") return "var(--json-string)";
  if (typeof item === "number") return "var(--json-number)";
  if (typeof item === "boolean") return "var(--json-boolean)";
  return "var(--text-dim)";
}

function formatScalarValue(item: unknown): string {
  return typeof item === "string" ? `"${item}"` : String(item);
}

/**
 * Renders a scalar array inline as a compact literal, e.g. `["class"]`
 * showing as `name: ["class"]` on a single row — no expand, no pre block.
 */
function SimpleArrayParam({ name, value, colWidth }: {
  name: string;
  value: unknown[];
  colWidth: string;
}) {
  const MAX_INLINE = 8;
  const shown = value.slice(0, MAX_INLINE);
  const hidden = value.length - shown.length;

  return (
    <div style={{ display: "flex", gap: 6, fontSize: "calc(12px + var(--chat-font-size-offset, 0px))", fontFamily: "var(--font-mono)" }}>
      <span style={{ color: "var(--accent)", fontWeight: 500, flexShrink: 0, minWidth: colWidth }}>{name}:</span>
      <span style={{ color: "var(--text-muted)", wordBreak: "break-all" }}>
        {`[`}
        {shown.map((item, i) => (
          <span key={i} style={{ color: scalarColor(item) }}>
            {formatScalarValue(item)}
            {i < shown.length - 1 ? ", " : ""}
          </span>
        ))}
        {`]`}
        {hidden > 0 && <span style={{ color: "var(--text-dim)" }}> … +{hidden} more</span>}
      </span>
    </div>
  );
}

interface StringParamProps {
  name: string;
  value: string;
  colWidth: string;
  maxStringLength: number;
}

function StringParam({ name, value, colWidth, maxStringLength }: StringParamProps) {
  const [expanded, setExpanded] = useState(false);
  const isLong = value.length > maxStringLength;
  const displayValue = isLong && !expanded ? `${value.slice(0, maxStringLength)}...` : value;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: "calc(12px + var(--chat-font-size-offset, 0px))", fontFamily: "var(--font-mono)" }}>
      <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
        <span style={{ color: "var(--accent)", fontWeight: 500, flexShrink: 0, minWidth: colWidth }}>{name}:</span>
        <span style={{ color: "var(--json-string)", wordBreak: "break-all" }}>
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
          <div style={{ color: "var(--text-dim)", fontSize: "calc(11px + var(--chat-font-size-offset, 0px))", marginBottom: 4 }}>
            Full value ({value.length} chars)
          </div>
          <pre
            style={{
              margin: 0,
              padding: 8,
              background: "var(--bg-panel)",
              borderRadius: 4,
              fontSize: "calc(11px + var(--chat-font-size-offset, 0px))",
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

/** Wrapper that draws the tree guide line for an expanded nested level. */
function TreeBranch({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        marginLeft: 10,
        borderLeft: "1px solid var(--border)",
        paddingLeft: 10,
      }}
    >
      {children}
    </div>
  );
}

interface ArrayParamProps {
  name: string;
  value: unknown[];
  colWidth: string;
  maxStringLength: number;
  isError: boolean;
}

function ArrayParam({ name, value, colWidth, maxStringLength, isError }: ArrayParamProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: "calc(12px + var(--chat-font-size-offset, 0px))", fontFamily: "var(--font-mono)" }}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          display: "flex",
          gap: 6,
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
        <span style={{ color: "var(--accent)", fontWeight: 500, flexShrink: 0, minWidth: colWidth }}>{name}:</span>
        <span style={{ color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 4 }}>
          [{value.length} items]
          <span
            style={{
              color: "var(--text-dim)",
              fontSize: "calc(10px + var(--chat-font-size-offset, 0px))",
              display: "inline-block",
              lineHeight: 1,
              transition: "transform 0.12s ease",
              transform: expanded ? "rotate(90deg)" : "none",
            }}
          >
            ▶
          </span>
        </span>
      </button>
      {expanded && (
        <TreeBranch>
          <ArrayItemsView value={value} maxStringLength={maxStringLength} isError={isError} />
        </TreeBranch>
      )}
    </div>
  );
}

/**
 * Renders the items of an expanded array as indexed rows. Items reuse the
 * normal type-aware ParamRow rendering, so e.g. `[\"xxx\"]` shows as
 * `0: \"xxx\"` without being re-packed into an object.
 */
function ArrayItemsView({ value, maxStringLength, isError }: {
  value: unknown[];
  maxStringLength: number;
  isError: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? value : value.slice(0, 10);
  const colWidth = keyColumnWidth(value.map((_, i) => [String(i), value[i]]));

  return (
    <>
      {visible.map((item, i) => (
        <ParamRow key={i} name={String(i)} value={item} colWidth={colWidth} maxStringLength={maxStringLength} isError={isError} />
      ))}
      {!showAll && value.length > 10 && (
        <button
          onClick={() => setShowAll(true)}
          style={{
            background: "none",
            border: "none",
            color: "var(--accent)",
            cursor: "pointer",
            fontSize: "calc(11px + var(--chat-font-size-offset, 0px))",
            padding: 0,
            textAlign: "left",
            fontFamily: "var(--font-mono)",
          }}
        >
          + {value.length - 10} more
        </button>
      )}
    </>
  );
}

interface ObjectParamProps {
  name: string;
  value: Record<string, unknown>;
  colWidth: string;
  maxStringLength: number;
  isError: boolean;
}

function ObjectParam({ name, value, colWidth, maxStringLength, isError }: ObjectParamProps) {
  const [expanded, setExpanded] = useState(false);
  const keys = Object.keys(value);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: "calc(12px + var(--chat-font-size-offset, 0px))", fontFamily: "var(--font-mono)" }}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          display: "flex",
          gap: 6,
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
        <span style={{ color: "var(--accent)", fontWeight: 500, flexShrink: 0, minWidth: colWidth }}>{name}:</span>
        <span style={{ color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 4 }}>
          {`{${keys.length} keys}`}
          <span
            style={{
              color: "var(--text-dim)",
              fontSize: "calc(10px + var(--chat-font-size-offset, 0px))",
              display: "inline-block",
              lineHeight: 1,
              transition: "transform 0.12s ease",
              transform: expanded ? "rotate(90deg)" : "none",
            }}
          >
            ▶
          </span>
        </span>
      </button>
      {expanded && (
        <TreeBranch>
          <JsonParamList data={value} maxStringLength={maxStringLength} isError={isError} bare />
        </TreeBranch>
      )}
    </div>
  );
}
