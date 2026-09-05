/**
 * Diff line syntax highlighting.
 *
 * Highlights a whole code string once with refractor (so tokens spanning
 * multiple lines — string literals, block comments — stay correct), then
 * splits the resulting token tree into per-line arrays. Each row can then be
 * dropped straight into a diff cell while the +/- marker, line number and
 * add/remove background stay untouched.
 */

import { createElement, type CSSProperties, type ReactNode } from "react";
import { refractor } from "refractor/all";

interface StyleSheet {
  [className: string]: CSSProperties;
}

interface Segment {
  text: string;
  className: string | null;
}

/** Merge the Prism stylesheet rules for a token's class names, like the
 * react-syntax-highlighter `createElement` helper does for single classes. */
function classStyle(classes: string[], stylesheet: StyleSheet): CSSProperties | undefined {
  let style: CSSProperties = {};
  for (const cls of classes) {
    const rule = stylesheet[cls];
    if (rule) style = { ...style, ...rule };
  }
  return Object.keys(style).length > 0 ? style : undefined;
}

/** Flatten the hast tree into a flat list of (text, className) segments. */
function flatten(nodes: readonly unknown[], inherited: string[], out: Segment[]): void {
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    const current = node as {
      type?: string;
      value?: unknown;
      properties?: { className?: unknown };
      children?: unknown[];
    };
    if (current.type === "text") {
      out.push({ text: String(current.value ?? ""), className: inherited.length ? inherited.join(" ") : null });
    } else if (current.type === "element") {
      const own = Array.isArray(current.properties?.className)
        ? (current.properties!.className as string[])
        : [];
      flatten(current.children ?? [], [...inherited, ...own], out);
    }
  }
}

/** Split the flat segments into per-line React node arrays. */
function rowsFromSegments(segments: Segment[], stylesheet: StyleSheet): ReactNode[][] {
  const rows: ReactNode[][] = [];
  let currentRow: ReactNode[] = [];

  for (const seg of segments) {
    const parts = seg.text.split("\n");
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) {
        rows.push(currentRow);
        currentRow = [];
      }
      const text = parts[i];
      if (text === "") continue;
      const classes = seg.className ? seg.className.split(/\s+/).filter((c) => c !== "token") : [];
      const style = classStyle(classes, stylesheet);
      currentRow.push(style ? createElement("span", { style }, text) : text);
    }
  }
  rows.push(currentRow);
  return rows;
}

/**
 * Highlight `code` for `language` and return one array of React nodes per
 * logical line. On an unknown language or invalid input the code falls back to
 * plain-text rows.
 */
export function highlightCodeRows(code: string, language: string, stylesheet: StyleSheet): ReactNode[][] {
  if (!code) return [];
  try {
    const tree = refractor.highlight(code, language) as { type: string; children?: unknown[] };
    const segments: Segment[] = [];
    flatten(tree.children ?? [], [], segments);
    return rowsFromSegments(segments, stylesheet);
  } catch {
    return code.split("\n").map((line) => (line ? [line] : []));
  }
}
