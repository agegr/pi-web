"use client";

import { useEffect, useMemo, useState, type CSSProperties, type RefObject } from "react";
import { measureColumnWidths, parseDelimitedTable, visibleRowRange } from "@/lib/delimited-table";

const ROW_HEIGHT = 26;
const GUTTER_WIDTH = 56;
const OVERSCAN_ROWS = 20;

const ROW: CSSProperties = {
  display: "flex",
  height: ROW_HEIGHT,
  boxSizing: "border-box",
  borderBottom: "1px solid var(--border)",
};

// The source view's line-number gutter, kept beside the columns while they
// scroll sideways. Opaque (--bg-panel), or cells would show through it.
const GUTTER: CSSProperties = {
  position: "sticky",
  left: 0,
  zIndex: 1,
  boxSizing: "border-box",
  width: GUTTER_WIDTH,
  flexShrink: 0,
  padding: "0 10px",
  display: "flex",
  alignItems: "center",
  justifyContent: "flex-end",
  color: "var(--text-dim)",
  background: "var(--bg-panel)",
  borderRight: "1px solid var(--border)",
  fontSize: 11,
  fontVariantNumeric: "tabular-nums",
  userSelect: "none",
};

const CELL: CSSProperties = {
  boxSizing: "border-box",
  flexShrink: 0,
  padding: "0 10px",
  lineHeight: `${ROW_HEIGHT - 1}px`,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  borderRight: "1px solid var(--border)",
};

/**
 * A `.csv` / `.tsv` file as a table: the first record is a sticky header, the
 * gutter shows the file line each record starts on. Rows have one fixed
 * height and only those around the viewport are rendered, so a large file
 * scrolls without a DOM per row. The viewer's own content box scrolls (its
 * position is saved and restored like the source view's); `scrollRef` is it.
 * `complete: false` means `content` is a loaded prefix of the file, whose cut
 * last record is left out.
 */
export function DelimitedTable({
  content,
  filePath,
  complete,
  scrollRef,
}: {
  content: string;
  filePath: string;
  complete: boolean;
  scrollRef: RefObject<HTMLElement | null>;
}) {
  const table = useMemo(() => parseDelimitedTable(content, filePath, complete), [complete, content, filePath]);
  const widths = useMemo(() => measureColumnWidths(table.columns, table.rows), [table]);
  const totalWidth = useMemo(() => widths.reduce((sum, width) => sum + width, GUTTER_WIDTH), [widths]);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  // A passive effect: the scroll box's ref is attached only after this
  // component's layout effects have run.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    let frame: number | null = null;
    const sync = () => {
      setScrollTop(element.scrollTop);
      setViewportHeight(element.clientHeight);
    };
    const handleScroll = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        sync();
      });
    };
    sync();
    element.addEventListener("scroll", handleScroll, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(sync);
    observer?.observe(element);
    return () => {
      element.removeEventListener("scroll", handleScroll);
      observer?.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [scrollRef]);

  if (table.columns.length === 0) return null;

  // The header row sits above the first body row.
  const { start, end } = visibleRowRange(
    table.rows.length,
    ROW_HEIGHT,
    scrollTop - ROW_HEIGHT,
    viewportHeight,
    OVERSCAN_ROWS,
  );
  const rows = [];
  for (let index = start; index < end; index += 1) {
    const row = table.rows[index];
    rows.push(
      <div
        key={index}
        role="row"
        aria-rowindex={index + 2}
        style={{ ...ROW, position: "absolute", top: index * ROW_HEIGHT, left: 0, width: totalWidth }}
      >
        <div role="rowheader" style={GUTTER}>{table.rowLines[index]}</div>
        {widths.map((width, cellIndex) => {
          const value = row[cellIndex] ?? "";
          return (
            <div key={cellIndex} role="cell" style={{ ...CELL, width }} title={value || undefined}>
              {value}
            </div>
          );
        })}
      </div>,
    );
  }

  return (
    <div
      role="table"
      aria-rowcount={table.rows.length + 1}
      aria-colcount={table.columns.length}
      style={{
        width: totalWidth,
        minWidth: "100%",
        fontFamily: "var(--font-mono)",
        fontWeight: "var(--font-mono-weight)",
        fontSize: 12,
        color: "var(--text-muted)",
        background: "var(--bg)",
      }}
    >
      <div
        role="row"
        aria-rowindex={1}
        style={{
          ...ROW,
          position: "sticky",
          top: 0,
          zIndex: 2,
          width: totalWidth,
          background: "var(--bg-panel)",
          color: "var(--text)",
          fontWeight: 600,
        }}
      >
        <div role="rowheader" style={GUTTER}>{table.headerLine}</div>
        {table.columns.map((column, index) => (
          <div key={index} role="columnheader" style={{ ...CELL, width: widths[index] }} title={column || undefined}>
            {column}
          </div>
        ))}
      </div>
      <div style={{ position: "relative", height: table.rows.length * ROW_HEIGHT }}>
        {rows}
      </div>
    </div>
  );
}
