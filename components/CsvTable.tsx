"use client";

import { useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import Papa from "papaparse";
import { getFileExt } from "@/lib/file-types";

const ROW_HEIGHT = 26;
const GUTTER_WIDTH = 64;
const MEASURE_SAMPLE_ROWS = 500;
const CELL_CHAR_WIDTH = 7.2;
const CELL_PADDING = 10;
const MIN_COLUMN_WIDTH = 72;
const MAX_COLUMN_WIDTH = 420;

export function isCsvPath(filePath: string): boolean {
  const ext = getFileExt(filePath);
  return ext === "csv" || ext === "tsv";
}

/** A gutter the way a spreadsheet shows it: a dimmed, separated strip. */
const GUTTER: React.CSSProperties = {
  position: "sticky",
  left: 0,
  zIndex: 2,
  boxSizing: "border-box",
  width: GUTTER_WIDTH,
  minWidth: GUTTER_WIDTH,
  flexShrink: 0,
  height: "100%",
  padding: "0 12px 0 4px",
  display: "flex",
  alignItems: "center",
  justifyContent: "flex-end",
  textAlign: "right",
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  color: "var(--text-dim)",
  // Opaque --bg-subtle, so a column scrolling underneath does not show through.
  background: "var(--bg-subtle-solid)",
  borderRight: "1px solid var(--border)",
  fontVariantNumeric: "tabular-nums",
  userSelect: "none",
};

const CELL: React.CSSProperties = {
  flexShrink: 0,
  padding: "0 10px",
  display: "flex",
  alignItems: "center",
  height: "100%",
  fontFamily: "var(--font-mono)",
  fontSize: 12,
  color: "var(--text-muted)",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  borderRight: "1px solid var(--border)",
  // Opaque so columns scrolling under the sticky gutter do not show through it.
  background: "var(--bg)",
};

const ROW: React.CSSProperties = {
  display: "flex",
  height: ROW_HEIGHT,
  alignItems: "stretch",
  borderBottom: "1px solid var(--border)",
};

export interface DelimitedTable {
  columns: string[];
  body: string[][];
  /** The file line each record starts on, offset-adjusted. */
  bodyLines: number[];
}

/**
 * PapaParse gives each record's fields and where it ended in the text; the line
 * a record starts on follows from the newlines before it, so a record spanning
 * several lines is labelled by the line it starts on. `startLine` is the line
 * `content` itself begins on, so a `read` with an `offset` numbers its rows the
 * way the file does.
 *
 * Only content that starts at the top of a file has a header row; a slice from
 * the middle of one does not, so every record there is data and the columns are
 * numbered instead.
 */
export function parseDelimitedTable(content: string, filePath: string, startLine = 1): DelimitedTable {
  const rows: string[][] = [];
  const rowLines: number[] = [];
  let cursor = 0;
  let line = 1;
  Papa.parse<string[]>(content, {
    delimiter: getFileExt(filePath) === "tsv" ? "\t" : "",
    skipEmptyLines: true,
    step: (stepResult) => {
      rows.push(stepResult.data);
      rowLines.push(line);
      for (let index = cursor; index < stepResult.meta.cursor; index += 1) {
        if (content[index] === "\n") line += 1;
      }
      cursor = stepResult.meta.cursor;
    },
  });
  const hasHeader = startLine === 1 && rows.length > 0;
  const header = hasHeader ? rows[0] : [];
  const body = hasHeader ? rows.slice(1) : rows;
  const bodyLines = hasHeader ? rowLines.slice(1) : rowLines;
  const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const columns = header.length === columnCount && header.length > 0
    ? header
    : Array.from({ length: columnCount }, (_, index) => `#${index + 1}`);
  return { columns, body, bodyLines: bodyLines.map((rowLine) => rowLine + startLine - 1) };
}

/**
 * Each column as wide as its widest sampled value, within bounds — a table of
 * narrow values should not spend the viewport on empty space.
 */
export function measureColumnWidths(columns: string[], body: string[][]): number[] {
  // Sampling keeps a large file's measurement from scanning every cell.
  const sampled = body.length > MEASURE_SAMPLE_ROWS
    ? body.filter((_, index) => index % Math.ceil(body.length / MEASURE_SAMPLE_ROWS) === 0)
    : body;
  return columns.map((column, index) => {
    let widest = column.length;
    for (const row of sampled) {
      const length = row[index]?.split("\n")[0].length ?? 0;
      if (length > widest) widest = length;
    }
    return Math.min(Math.max(widest * CELL_CHAR_WIDTH + CELL_PADDING * 2, MIN_COLUMN_WIDTH), MAX_COLUMN_WIDTH);
  });
}

/**
 * A delimited file as a table: PapaParse parses it (quoted fields, embedded
 * newlines, auto-detected delimiter) and TanStack Virtual renders only the
 * visible rows, so a large file scrolls without building a DOM for every row.
 */
export function CsvTable({ content, filePath, startLine }: { content: string; filePath: string; startLine?: number }) {
  const parsed = useMemo(() => parseDelimitedTable(content, filePath, startLine), [content, filePath, startLine]);
  const widths = useMemo(
    () => measureColumnWidths(parsed.columns, parsed.body),
    [parsed],
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  // TanStack Virtual's instance is designed to be non-stable; the lint rule for
  // memoizable libraries does not apply to it.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: parsed.body.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
  });
  const firstLine = startLine ?? 1;

  return (
    <div
      ref={scrollRef}
      style={{ height: "100%", overflow: "auto", background: "var(--bg)" }}
    >
      <div style={{ minWidth: "max-content", padding: "12px 0" }}>
        <div
          style={{
            ...ROW,
            position: "sticky",
            top: 0,
            zIndex: 3,
            background: "var(--bg)",
          }}
        >
          <div style={GUTTER}>{firstLine}</div>
          {parsed.columns.map((column, index) => (
            <div key={index} style={{ ...CELL, width: widths[index], fontWeight: 600, color: "var(--text)" }} title={column}>
              {column}
            </div>
          ))}
        </div>
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((item) => {
            const row = parsed.body[item.index];
            return (
              <div
                key={item.key}
                style={{
                  ...ROW,
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  transform: `translateY(${item.start}px)`,
                }}
              >
                <div style={GUTTER}>{parsed.bodyLines[item.index]}</div>
                {parsed.columns.map((_, cellIndex) => (
                  <div key={cellIndex} style={{ ...CELL, width: widths[cellIndex] }} title={row?.[cellIndex] ?? ""}>
                    {row?.[cellIndex] ?? ""}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}