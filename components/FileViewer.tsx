"use client";

import { useEffect, useLayoutEffect, useState, useRef, useCallback, useMemo, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import {
  Prism as SyntaxHighlighter,
  createElement as renderSyntaxNode,
  type SyntaxHighlighterProps,
} from "react-syntax-highlighter";
import { vs } from "react-syntax-highlighter/dist/cjs/styles/prism";
import { vscDarkPlus } from "react-syntax-highlighter/dist/cjs/styles/prism";
import { useTheme } from "@/hooks/useTheme";
import { useIsMobile } from "@/hooks/useIsMobile";
import {
  DOCX_PREVIEW_MAX_BYTES,
  getFileExt,
  isEditableTextPath,
  isAudioPath,
  isDocumentPreviewPath,
  isImagePath,
  isVideoPath,
} from "@/lib/file-types";
import { encodeFilePathForApi, getFileName, getRelativeFilePath, sameFilePath } from "@/lib/file-paths";
import { buildFileLineMentionText } from "@/lib/file-fuzzy";
import { clearLocationTextHighlight, LOCATION_HIGHLIGHT_CLASS } from "@/lib/location-highlight";
import { MarkdownFilePreview } from "./MarkdownFilePreview";
import type { MarkdownEditorLocationApi, MarkdownEditorSelection } from "./MarkdownFileEditor";
import { ChatInput, type ChatInputHandle } from "./ChatInput";
import { parseUnifiedPatch } from "@/lib/patch";
import type { GitFileDiffResponse } from "@/lib/git-types";
import { useI18n } from "@/hooks/useI18n";
import {
  resolveInitialFileDisplayMode,
  type FileViewerDisplayMode as DisplayMode,
  type FileViewerState,
} from "@/lib/file-viewer-state";

export type { FileViewerState } from "@/lib/file-viewer-state";

export interface FileLocationTarget {
  filePath: string;
  sourceSessionId?: string | null;
  startLine?: number;
  endLine?: number;
  text: string;
}

const MarkdownFileEditor = dynamic(() => import("./MarkdownFileEditor"), { ssr: false });
const CodeFileEditor = dynamic(() => import("./CodeFileEditor"), { ssr: false });

interface Props {
  filePath: string;
  cwd?: string;
  sourceSessionId?: string | null;
  onOpenFile?: (filePath: string) => void;
  locationTarget?: FileLocationTarget | null;
  onLocationHandled?: (target: FileLocationTarget) => void;
  onLocationFailed?: (target: FileLocationTarget) => void;
  onMentionLines?: (selection: FileSelectionContext) => void;
  onAskInNewChat?: (prompt: string) => Promise<void>;
  /** Insert this file's relative path into the chat input (@ mention). */
  onAtMention?: (relativePath: string, isDir: boolean) => void;
  gitRefreshKey?: number;
  initialDisplayMode?: DisplayMode;
  initialState?: FileViewerState;
  onStateChange?: (state: FileViewerState) => void;
  watchEnabled?: boolean;
}

interface FileData {
  content: string;
  language: string;
  size: number;
  nextOffset: number;
  truncated: boolean;
  editable?: boolean;
}

const SOURCE_HIGHLIGHT_MAX_LINES = 1_000;
const DISPLAY_MODE_LABELS: Record<DisplayMode, string> = {
  source: "Source",
  preview: "Preview",
  diff: "Diff",
};

const FILE_CODE_STYLE: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 13,
  lineHeight: 1.6,
};

const FILE_LINE_NUMBER_STYLE: CSSProperties = {
  width: 48,
  minWidth: 48,
  padding: "0 10px",
  textAlign: "right",
  color: "var(--text-dim)",
  background: "var(--bg-panel)",
  borderRight: "1px solid var(--border)",
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  fontStyle: "normal",
  fontVariantNumeric: "tabular-nums",
  lineHeight: "20.8px",
  userSelect: "none",
  flexShrink: 0,
  verticalAlign: "top",
};

type SourceCodeRendererProps = Parameters<NonNullable<SyntaxHighlighterProps["renderer"]>>[0] & {
  wrapLines: boolean;
};

interface SelectedLineRange {
  startLine: number;
  endLine: number;
}

interface PendingFileSelection extends SelectedLineRange {
  text: string;
  top: number;
  left: number;
}

export interface FileSelectionContext {
  relativePath: string;
  filePath: string;
  sourceSessionId?: string | null;
  text: string;
  startLine: number;
  endLine: number;
  language?: string;
}

function MentionIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8" />
    </svg>
  );
}

function closestSourceLine(node: Node): HTMLElement | null {
  const element = node.nodeType === Node.ELEMENT_NODE
    ? node as Element
    : node.parentElement;
  return element?.closest<HTMLElement>(".file-source-line[data-line-number]") ?? null;
}

function getSelectedSourceLineRange(root: HTMLElement, selection: Selection | null): SelectedLineRange | null {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;

  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;

  let startElement = closestSourceLine(range.startContainer);
  let endElement = closestSourceLine(range.endContainer);
  if (!startElement || !endElement || !root.contains(startElement) || !root.contains(endElement)) return null;

  let startLine = Number(startElement.dataset.lineNumber);
  let endLine = Number(endElement.dataset.lineNumber);
  if (!Number.isInteger(startLine) || !Number.isInteger(endLine)) return null;

  if (startLine < endLine) {
    // Browser ranges can start at the end of the preceding line or end at the
    // start of the following line. Exclude either boundary line when none of
    // its source text is actually selected.
    const startContent = startElement.querySelector<HTMLElement>(".file-source-line-content");
    if (startContent?.contains(range.startContainer)) {
      const selectedSuffix = document.createRange();
      selectedSuffix.selectNodeContents(startContent);
      selectedSuffix.setStart(range.startContainer, range.startOffset);
      if (selectedSuffix.toString().length === 0) {
        const nextLine = startElement.nextElementSibling;
        if (nextLine instanceof HTMLElement && nextLine.matches(".file-source-line[data-line-number]")) {
          startElement = nextLine;
          startLine = Number(startElement.dataset.lineNumber);
        }
      }
    }

    const endContent = endElement.querySelector<HTMLElement>(".file-source-line-content");
    if (endContent?.contains(range.endContainer)) {
      const selectedPrefix = document.createRange();
      selectedPrefix.selectNodeContents(endContent);
      selectedPrefix.setEnd(range.endContainer, range.endOffset);
      if (selectedPrefix.toString().length === 0) {
        const previousLine = endElement.previousElementSibling;
        if (previousLine instanceof HTMLElement && previousLine.matches(".file-source-line[data-line-number]")) {
          endElement = previousLine;
          endLine = Number(endElement.dataset.lineNumber);
        }
      }
    }
  }

  if (startLine > endLine) return null;
  return { startLine, endLine };
}

function closestMarkdownSourceRange(node: Node): HTMLElement | null {
  const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
  return element?.closest<HTMLElement>("[data-source-start-line][data-source-end-line]") ?? null;
}

function getSelectedMarkdownLineRange(root: HTMLElement, selection: Selection | null): SelectedLineRange | null {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const startElement = closestMarkdownSourceRange(range.startContainer);
  const endElement = closestMarkdownSourceRange(range.endContainer);
  const startLine = Number(startElement?.dataset.sourceStartLine);
  const endLine = Number(endElement?.dataset.sourceEndLine);
  return Number.isInteger(startLine) && Number.isInteger(endLine) && startLine > 0 && endLine >= startLine
    ? { startLine, endLine }
    : null;
}

interface LocationTextPoint {
  node: Text;
  offset: number;
}

function normalizeLocationText(value: string) {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Find a rendered-text range without relying on Markdown punctuation or the
 * source line breaks that the preview renderer intentionally removes. The
 * returned range is used for scrolling only; it never changes the user's
 * native selection.
 */
function findLocationTextRangeInRoots(roots: readonly Node[], text: string): Range | null {
  const target = normalizeLocationText(text);
  if (!target) return null;

  const points: LocationTextPoint[] = [];
  let normalized = "";
  let hasContent = false;
  for (const root of roots) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        return parent?.closest("[hidden]") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      },
    });
    const textNodes: Text[] = [];
    let node = walker.nextNode() as Text | null;
    while (node) {
      if (node.nodeValue) textNodes.push(node);
      node = walker.nextNode() as Text | null;
    }
    if (textNodes.length === 0) continue;

    // Treat adjacent source blocks as a whitespace boundary so a selection
    // spanning two paragraphs can still be located as one rendered range.
    if (hasContent && normalized && normalized.at(-1) !== " ") {
      normalized += " ";
      points.push({ node: textNodes[0], offset: 0 });
    }
    for (const textNode of textNodes) {
      const value = textNode.nodeValue ?? "";
      for (let offset = 0; offset < value.length; offset += 1) {
        const character = value[offset];
        if (/\s/.test(character)) {
          if (normalized && normalized.at(-1) !== " ") {
            normalized += " ";
            points.push({ node: textNode, offset });
          }
        } else {
          normalized += character;
          points.push({ node: textNode, offset });
        }
      }
    }
    hasContent = true;
  }

  const match = normalized.indexOf(target);
  if (match < 0) return null;
  const start = points[match];
  const end = points[match + target.length - 1];
  if (!start || !end) return null;

  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset + 1);
  return range;
}

function findLocationTextRange(root: Node, text: string) {
  return findLocationTextRangeInRoots([root], text);
}

function scrollLocationRangeIntoView(scroller: HTMLElement, range: Range) {
  const rect = range.getClientRects()[0] ?? range.getBoundingClientRect();
  if (!rect || (!rect.width && !rect.height)) return false;

  const scrollerRect = scroller.getBoundingClientRect();
  const padding = Math.min(48, Math.max(16, scroller.clientHeight * 0.2));
  const visibleTop = scrollerRect.top + padding;
  const visibleBottom = scrollerRect.bottom - padding;
  if (rect.top >= visibleTop && rect.bottom <= visibleBottom) return true;

  scroller.scrollBy({
    top: (rect.top + rect.bottom) / 2 - (scrollerRect.top + scrollerRect.bottom) / 2,
    behavior: "auto",
  });
  return true;
}

function SourceCodeRenderer({ rows, stylesheet, useInlineStyles, wrapLines }: SourceCodeRendererProps) {
  return rows.map((row, lineIndex) => {
    const children = row.children ?? [];
    const firstChildClasses = children[0]?.properties?.className;
    const hasLineNumber = Array.isArray(firstChildClasses)
      && firstChildClasses.includes("react-syntax-highlighter-line-number");
    const lineNumberNode = hasLineNumber ? children[0] : null;
    const contentNodes = hasLineNumber ? children.slice(1) : children;

    return (
      <span
        className="file-source-line"
        data-line-number={lineIndex + 1}
        key={`source-line-${lineIndex}`}
        style={{ display: "flex", minWidth: "100%" }}
      >
        {lineNumberNode && renderSyntaxNode({
          node: lineNumberNode,
          stylesheet,
          useInlineStyles,
          key: `source-line-number-${lineIndex}`,
        })}
        <span
          className="file-source-line-content"
          style={{
            flex: "1 1 auto",
            minWidth: 0,
            overflowWrap: wrapLines ? "anywhere" : "normal",
            whiteSpace: wrapLines ? "pre-wrap" : "pre",
          }}
        >
          {contentNodes.map((node, tokenIndex) => renderSyntaxNode({
            node,
            stylesheet,
            useInlineStyles,
            key: `source-token-${lineIndex}-${tokenIndex}`,
          }))}
        </span>
      </span>
    );
  });
}

function getFileApiUrl(
  filePath: string,
  type: "read" | "download" | "meta" | "preview" | "watch",
  sourceSessionId?: string | null,
  params: Record<string, string | number | undefined> = {},
): string {
  const baseUrl = getFileApiBaseUrl(filePath);
  const searchParams = new URLSearchParams({ type });
  if (sourceSessionId) searchParams.set("sessionId", sourceSessionId);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) searchParams.set(key, String(value));
  }
  return `${baseUrl}?${searchParams.toString()}`;
}

function getFileApiBaseUrl(filePath: string): string {
  return `/api/files/${encodeFilePathForApi(filePath)}`;
}

function DownloadLink({ filePath, sourceSessionId }: { filePath: string; sourceSessionId?: string | null }) {
  const { t } = useI18n();
  return (
    <a
      href={getFileApiUrl(filePath, "download", sourceSessionId)}
      download={getFileName(filePath)}
      title={t("i18n.downloadFile")}
      aria-label={t("i18n.downloadFile")}
      className="file-viewer-icon-button"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
    </a>
  );
}

type DiffLine = {
  type: "unchanged" | "removed" | "added";
  text: string;
  oldLineNo: number | null;
  newLineNo: number | null;
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function diffLines(patch: string): DiffLine[] {
  const files = parseUnifiedPatch(patch);
  if (!files) return [];

  return files.flatMap((file) => file.rows.flatMap((row): DiffLine[] => {
    if (row.type === "hunk") return [];
    if (row.left.type === "context" && row.right.type === "context") {
      return [{
        type: "unchanged",
        text: row.right.text,
        oldLineNo: row.left.lineNo,
        newLineNo: row.right.lineNo,
      }];
    }

    const lines: DiffLine[] = [];
    if (row.left.type === "removed") {
      lines.push({
        type: "removed",
        text: row.left.text,
        oldLineNo: row.left.lineNo,
        newLineNo: null,
      });
    }
    if (row.right.type === "added") {
      lines.push({
        type: "added",
        text: row.right.text,
        oldLineNo: null,
        newLineNo: row.right.lineNo,
      });
    }
    return lines;
  }));
}

function DiffView({ patch }: { patch: string }) {
  const { t } = useI18n();
  const diff = diffLines(patch);

  const hasChanges = diff.some((l) => l.type !== "unchanged");
  if (!hasChanges) {
    return (
      <div style={{ padding: "12px 16px", fontSize: 12, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
        {t("i18n.noChanges")}
      </div>
    );
  }

  // Render with context: show 3 lines around each change, collapse the rest
  const CONTEXT = 3;
  const changed = new Set(diff.flatMap((l, i) => (l.type !== "unchanged" ? [i] : [])));
  const visible = new Set<number>();
  for (const ci of changed) {
    for (let j = Math.max(0, ci - CONTEXT); j <= Math.min(diff.length - 1, ci + CONTEXT); j++) {
      visible.add(j);
    }
  }

  const segments: Array<{ hidden: true; count: number } | { hidden: false; lines: DiffLine[] }> = [];
  let i = 0;
  while (i < diff.length) {
    if (visible.has(i)) {
      const block: DiffLine[] = [];
      while (i < diff.length && visible.has(i)) {
        block.push(diff[i]);
        i++;
      }
      segments.push({ hidden: false, lines: block });
    } else {
      let count = 0;
      while (i < diff.length && !visible.has(i)) {
        count++;
        i++;
      }
      segments.push({ hidden: true, count });
    }
  }

  return (
    <div
      className="file-diff-view"
      style={{
        width: "max-content",
        minWidth: "100%",
        ...FILE_CODE_STYLE,
      }}
    >
      {segments.map((seg, si) => {
        if (seg.hidden) {
          const result = (
            <div
              key={si}
              style={{
                padding: "2px 16px",
                color: "var(--text-dim)",
                background: "var(--bg-panel)",
                fontSize: 11,
                borderTop: "1px solid var(--border)",
                borderBottom: "1px solid var(--border)",
              }}
            >
              ... {seg.count} unchanged lines ...
            </div>
          );
          return result;
        }
        const lines = seg.lines.map((line, li) => {
          const bg =
            line.type === "added"
              ? "rgba(0,200,80,0.12)"
              : line.type === "removed"
              ? "rgba(240,60,60,0.14)"
              : "transparent";
          const prefix =
            line.type === "added" ? "+" : line.type === "removed" ? "-" : " ";
          const prefixColor =
            line.type === "added" ? "#4ade80" : line.type === "removed" ? "#f87171" : "var(--text-dim)";

          return (
            <div
              key={li}
              className="file-diff-line"
              style={{
                display: "flex",
                minWidth: "100%",
                background: bg,
                borderLeft: line.type === "added"
                  ? "3px solid #4ade80"
                  : line.type === "removed"
                  ? "3px solid #f87171"
                  : "3px solid transparent",
              }}
            >
              <span
                style={FILE_LINE_NUMBER_STYLE}
              >
                {line.type === "removed" ? line.oldLineNo : line.newLineNo}
              </span>
              <span
                style={{
                  minWidth: 16,
                  padding: "0 6px",
                  color: prefixColor,
                  userSelect: "none",
                  flexShrink: 0,
                  fontWeight: 600,
                }}
              >
                {prefix}
              </span>
              <span
                className="file-diff-line-content"
                style={{
                  flexShrink: 0,
                  padding: "0 8px 0 0",
                  whiteSpace: "pre",
                  color: "var(--text)",
                }}
              >
                {line.text || "\u00a0"}
              </span>
            </div>
          );
        });
        return <div key={si}>{lines}</div>;
      })}
    </div>
  );
}

function ImageViewer({ filePath, cwd, sourceSessionId, watchEnabled = true }: Props) {
  const { t } = useI18n();
  const [watching, setWatching] = useState(false);
  const [bust, setBust] = useState(0);
  const [size, setSize] = useState<number | null>(null);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const syncRequestRef = useRef(0);

  const ext = getFileName(filePath).toLowerCase().split(".").pop() ?? "";

  useEffect(() => {
    setBust(0);
    setSize(null);
    setNaturalSize(null);
    setError(null);
    setWatching(false);
  }, [filePath, sourceSessionId]);

  useEffect(() => {
    setWatching(false);

    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    if (!watchEnabled) return;

    let active = true;
    const synchronize = () => {
      const requestId = ++syncRequestRef.current;
      fetch(getFileApiUrl(filePath, "meta", sourceSessionId))
        .then((response) => response.json())
        .then((next: { size?: number; error?: string }) => {
          if (!active || requestId !== syncRequestRef.current) return;
          if (next.error) {
            setError(next.error);
            return;
          }
          if (typeof next.size === "number") setSize(next.size);
          setNaturalSize(null);
          setError(null);
          setBust((value) => value + 1);
        })
        .catch((nextError) => {
          if (active && requestId === syncRequestRef.current) setError(String(nextError));
        });
    };

    const es = new EventSource(getFileApiUrl(filePath, "watch", sourceSessionId));
    esRef.current = es;

    es.addEventListener("connected", () => {
      setWatching(true);
      synchronize();
    });
    es.addEventListener("change", (e) => {
      syncRequestRef.current += 1;
      try {
        const d = JSON.parse((e as MessageEvent).data) as { size?: number };
        if (typeof d.size === "number") setSize(d.size);
      } catch { /* ignore */ }
      setNaturalSize(null);
      setError(null);
      setBust((b) => b + 1);
    });
    const markDisconnected = () => {
      setWatching(false);
    };
    es.addEventListener("error", markDisconnected);
    es.onerror = markDisconnected;

    return () => {
      active = false;
      es.close();
      if (esRef.current === es) esRef.current = null;
    };
  }, [filePath, sourceSessionId, watchEnabled]);

  const src = getFileApiUrl(filePath, "read", sourceSessionId, bust ? { v: bust } : undefined);

  const formatSizeStr = size != null ? formatSize(size) : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "4px 16px",
          borderBottom: "1px solid var(--border)",
          fontSize: 11,
          color: "var(--text-dim)",
          background: "var(--bg)",
          flexShrink: 0,
        }}
      >
        <span style={{ fontFamily: "var(--font-mono)" }} title={filePath}>
          {getRelativeFilePath(filePath, cwd)}
        </span>
        <span style={{ marginLeft: "auto" }}>{ext || "image"}</span>
        {naturalSize && <span>{naturalSize.w} × {naturalSize.h}</span>}
        {formatSizeStr && <span>{formatSizeStr}</span>}
        <span
          title={watching ? t("i18n.liveSync") : t("i18n.notWatching")}
          style={{ display: "flex", alignItems: "center", gap: 4, color: watching ? "#4ade80" : "var(--text-dim)" }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: watching ? "#4ade80" : "var(--border)",
              display: "inline-block",
              boxShadow: watching ? "0 0 4px #4ade80" : "none",
            }}
          />
          {watching ? "live" : "static"}
        </span>
        <DownloadLink filePath={filePath} sourceSessionId={sourceSessionId} />
      </div>
      <div
        style={{
          flex: 1,
          overflow: "auto",
          background: "var(--bg-panel)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 16,
          backgroundImage:
            "linear-gradient(45deg, var(--bg) 25%, transparent 25%), linear-gradient(-45deg, var(--bg) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, var(--bg) 75%), linear-gradient(-45deg, transparent 75%, var(--bg) 75%)",
          backgroundSize: "16px 16px",
          backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0px",
        }}
      >
        {error ? (
          <div style={{ color: "#f87171", fontSize: 13 }}>{error}</div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={filePath}
            onLoad={(e) => {
              const img = e.currentTarget;
              setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
            }}
            onError={() => setError("Failed to load image")}
            style={{
              maxWidth: "100%",
              maxHeight: "100%",
              objectFit: "contain",
              boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
            }}
          />
        )}
      </div>
    </div>
  );
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return "";
  const totalSeconds = Math.round(seconds);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function AudioViewer({ filePath, cwd, sourceSessionId, watchEnabled = true }: Props) {
  const { t } = useI18n();
  const [watching, setWatching] = useState(false);
  const [bust, setBust] = useState(0);
  const [size, setSize] = useState<number | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const syncRequestRef = useRef(0);

  const ext = getFileName(filePath).toLowerCase().split(".").pop() ?? "";

  useEffect(() => {
    setBust(0);
    setSize(null);
    setDuration(null);
    setError(null);
    setWatching(false);
  }, [filePath, sourceSessionId]);

  useEffect(() => {
    setWatching(false);

    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    if (!watchEnabled) return;

    let active = true;
    const synchronize = () => {
      const requestId = ++syncRequestRef.current;
      fetch(getFileApiUrl(filePath, "meta", sourceSessionId))
        .then((response) => response.json())
        .then((next: { size?: number; error?: string }) => {
          if (!active || requestId !== syncRequestRef.current) return;
          if (next.error) {
            setError(next.error);
            return;
          }
          if (typeof next.size === "number") setSize(next.size);
          setDuration(null);
          setError(null);
          setBust((value) => value + 1);
        })
        .catch((nextError) => {
          if (active && requestId === syncRequestRef.current) setError(String(nextError));
        });
    };

    const es = new EventSource(getFileApiUrl(filePath, "watch", sourceSessionId));
    esRef.current = es;

    es.addEventListener("connected", () => {
      setWatching(true);
      synchronize();
    });
    es.addEventListener("change", (e) => {
      syncRequestRef.current += 1;
      try {
        const d = JSON.parse((e as MessageEvent).data) as { size?: number };
        if (typeof d.size === "number") setSize(d.size);
      } catch { /* ignore */ }
      setDuration(null);
      setError(null);
      setBust((b) => b + 1);
    });
    const markDisconnected = () => {
      setWatching(false);
    };
    es.addEventListener("error", markDisconnected);
    es.onerror = markDisconnected;

    return () => {
      active = false;
      es.close();
      if (esRef.current === es) esRef.current = null;
    };
  }, [filePath, sourceSessionId, watchEnabled]);

  const src = getFileApiUrl(filePath, "read", sourceSessionId, bust ? { v: bust } : undefined);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "4px 16px",
          borderBottom: "1px solid var(--border)",
          fontSize: 11,
          color: "var(--text-dim)",
          background: "var(--bg)",
          flexShrink: 0,
        }}
      >
        <span style={{ fontFamily: "var(--font-mono)" }} title={filePath}>
          {getRelativeFilePath(filePath, cwd)}
        </span>
        <span style={{ marginLeft: "auto" }}>{ext || "audio"}</span>
        {duration != null && <span>{formatDuration(duration)}</span>}
        {size != null && <span>{formatSize(size)}</span>}
        <span
          title={watching ? t("i18n.liveSync") : t("i18n.notWatching")}
          style={{ display: "flex", alignItems: "center", gap: 4, color: watching ? "#4ade80" : "var(--text-dim)" }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: watching ? "#4ade80" : "var(--border)",
              display: "inline-block",
              boxShadow: watching ? "0 0 4px #4ade80" : "none",
            }}
          />
          {watching ? "live" : "static"}
        </span>
        <DownloadLink filePath={filePath} sourceSessionId={sourceSessionId} />
      </div>
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          background: "var(--bg-panel)",
        }}
      >
        <div style={{ width: "min(680px, 100%)" }}>
          {error && (
            <div style={{ color: "#f87171", fontSize: 13, marginBottom: 12, textAlign: "center" }}>
              {error}
            </div>
          )}
          <audio
            key={src}
            controls
            preload="metadata"
            src={src}
            onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
            onError={() => setError("Failed to load audio")}
            style={{ width: "100%" }}
          />
        </div>
      </div>
    </div>
  );
}

function VideoViewer({ filePath, cwd, sourceSessionId, watchEnabled = true }: Props) {
  const { t } = useI18n();
  const [watching, setWatching] = useState(false);
  const [bust, setBust] = useState(0);
  const [size, setSize] = useState<number | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const syncRequestRef = useRef(0);

  const ext = getFileName(filePath).toLowerCase().split(".").pop() ?? "";

  useEffect(() => {
    setBust(0);
    setSize(null);
    setDuration(null);
    setError(null);
    setWatching(false);
  }, [filePath, sourceSessionId]);

  useEffect(() => {
    setWatching(false);

    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    if (!watchEnabled) return;

    let active = true;
    const synchronize = () => {
      const requestId = ++syncRequestRef.current;
      fetch(getFileApiUrl(filePath, "meta", sourceSessionId))
        .then((response) => response.json())
        .then((next: { size?: number; error?: string }) => {
          if (!active || requestId !== syncRequestRef.current) return;
          if (next.error) {
            setError(next.error);
            return;
          }
          if (typeof next.size === "number") setSize(next.size);
          setDuration(null);
          setError(null);
          setBust((value) => value + 1);
        })
        .catch((nextError) => {
          if (active && requestId === syncRequestRef.current) setError(String(nextError));
        });
    };

    const es = new EventSource(getFileApiUrl(filePath, "watch", sourceSessionId));
    esRef.current = es;

    es.addEventListener("connected", () => {
      setWatching(true);
      synchronize();
    });
    es.addEventListener("change", (e) => {
      syncRequestRef.current += 1;
      try {
        const d = JSON.parse((e as MessageEvent).data) as { size?: number };
        if (typeof d.size === "number") setSize(d.size);
      } catch { /* ignore */ }
      setDuration(null);
      setError(null);
      setBust((b) => b + 1);
    });
    const markDisconnected = () => {
      setWatching(false);
    };
    es.addEventListener("error", markDisconnected);
    es.onerror = markDisconnected;

    return () => {
      active = false;
      es.close();
      if (esRef.current === es) esRef.current = null;
    };
  }, [filePath, sourceSessionId, watchEnabled]);

  const src = getFileApiUrl(filePath, "read", sourceSessionId, bust ? { v: bust } : undefined);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "4px 16px",
          borderBottom: "1px solid var(--border)",
          fontSize: 11,
          color: "var(--text-dim)",
          background: "var(--bg)",
          flexShrink: 0,
        }}
      >
        <span style={{ fontFamily: "var(--font-mono)" }} title={filePath}>
          {getRelativeFilePath(filePath, cwd)}
        </span>
        <span style={{ marginLeft: "auto" }}>{ext || "video"}</span>
        {duration != null && <span>{formatDuration(duration)}</span>}
        {size != null && <span>{formatSize(size)}</span>}
        <span
          title={watching ? t("i18n.liveSync") : t("i18n.notWatching")}
          style={{ display: "flex", alignItems: "center", gap: 4, color: watching ? "#4ade80" : "var(--text-dim)" }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: watching ? "#4ade80" : "var(--border)",
              display: "inline-block",
              boxShadow: watching ? "0 0 4px #4ade80" : "none",
            }}
          />
          {watching ? "live" : "static"}
        </span>
        <DownloadLink filePath={filePath} sourceSessionId={sourceSessionId} />
      </div>
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          background: "var(--bg-panel)",
          minHeight: 0,
        }}
      >
        <div style={{ width: "min(960px, 100%)", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 0 }}>
          {error && (
            <div style={{ color: "#f87171", fontSize: 13, marginBottom: 12, textAlign: "center" }}>
              {error}
            </div>
          )}
          <video
            key={src}
            controls
            playsInline
            preload="metadata"
            src={src}
            onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
            onError={() => setError("Failed to load video")}
            style={{ maxWidth: "100%", maxHeight: "100%" }}
          />
        </div>
      </div>
    </div>
  );
}

function DocumentViewer({ filePath, cwd, sourceSessionId, watchEnabled = true }: Props) {
  const { t } = useI18n();
  const [watching, setWatching] = useState(false);
  const [bust, setBust] = useState(0);
  const [size, setSize] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const syncRequestRef = useRef(0);

  const ext = getFileExt(filePath);
  const isPdf = ext === "pdf";
  const previewUrl = isPdf
    ? getFileApiUrl(filePath, "read", sourceSessionId, bust ? { v: bust } : undefined)
    : getFileApiUrl(filePath, "preview", sourceSessionId, bust ? { v: bust } : undefined);

  useEffect(() => {
    setBust(0);
    setSize(null);
    setError(null);
    setWatching(false);

    let active = true;
    const requestId = ++syncRequestRef.current;
    fetch(getFileApiUrl(filePath, "meta", sourceSessionId))
      .then((r) => r.json())
      .then((d: { size?: number; error?: string }) => {
        if (!active || requestId !== syncRequestRef.current) return;
        if (d.error) setError(d.error);
        if (typeof d.size === "number") {
          setSize(d.size);
          if (!isPdf && d.size > DOCX_PREVIEW_MAX_BYTES) {
            setError("DOCX too large for preview (>10MB)");
          }
        }
      })
      .catch((nextError) => {
        if (active && requestId === syncRequestRef.current) setError(String(nextError));
      });

    return () => {
      active = false;
    };
  }, [filePath, isPdf, sourceSessionId]);

  useEffect(() => {
    setWatching(false);

    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    if (!watchEnabled) return;

    let active = true;
    const synchronize = () => {
      const requestId = ++syncRequestRef.current;
      fetch(getFileApiUrl(filePath, "meta", sourceSessionId))
        .then((r) => r.json())
        .then((d: { size?: number; error?: string }) => {
          if (!active || requestId !== syncRequestRef.current) return;
          if (d.error) {
            setError(d.error);
            return;
          }
          if (typeof d.size === "number") {
            setSize(d.size);
            if (!isPdf && d.size > DOCX_PREVIEW_MAX_BYTES) {
              setError("DOCX too large for preview (>10MB)");
              return;
            }
          }
          setError(null);
          setBust((value) => value + 1);
        })
        .catch((nextError) => {
          if (active && requestId === syncRequestRef.current) setError(String(nextError));
        });
    };

    const es = new EventSource(getFileApiUrl(filePath, "watch", sourceSessionId));
    esRef.current = es;

    es.addEventListener("connected", () => {
      setWatching(true);
      synchronize();
    });
    es.addEventListener("change", (e) => {
      syncRequestRef.current += 1;
      try {
        const d = JSON.parse((e as MessageEvent).data) as { size?: number };
        if (typeof d.size === "number") {
          setSize(d.size);
          if (!isPdf && d.size > DOCX_PREVIEW_MAX_BYTES) {
            setError("DOCX too large for preview (>10MB)");
            return;
          }
        }
      } catch { /* ignore */ }
      setError(null);
      setBust((b) => b + 1);
    });
    const markDisconnected = () => {
      setWatching(false);
    };
    es.addEventListener("error", markDisconnected);
    es.onerror = markDisconnected;

    return () => {
      active = false;
      es.close();
      if (esRef.current === es) esRef.current = null;
    };
  }, [filePath, isPdf, sourceSessionId, watchEnabled]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "4px 16px",
          borderBottom: "1px solid var(--border)",
          fontSize: 11,
          color: "var(--text-dim)",
          background: "var(--bg)",
          flexShrink: 0,
        }}
      >
        <span style={{ fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={filePath}>
          {getRelativeFilePath(filePath, cwd)}
        </span>
        <span style={{ marginLeft: "auto" }}>{ext === "docx" ? "docx preview" : "pdf"}</span>
        {size != null && <span>{formatSize(size)}</span>}
        <DownloadLink filePath={filePath} sourceSessionId={sourceSessionId} />
        <span
          title={watching ? t("i18n.liveSync") : t("i18n.notWatching")}
          style={{ display: "flex", alignItems: "center", gap: 4, color: watching ? "#4ade80" : "var(--text-dim)", flexShrink: 0 }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: watching ? "#4ade80" : "var(--border)",
              display: "inline-block",
              boxShadow: watching ? "0 0 4px #4ade80" : "none",
            }}
          />
          {watching ? "live" : "static"}
        </span>
      </div>
      <div style={{ flex: 1, minHeight: 0, background: "var(--bg-panel)" }}>
        {error ? (
          <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, color: "#f87171", fontSize: 13, textAlign: "center" }}>
            {error}
          </div>
        ) : (
          <iframe
            key={previewUrl}
            src={previewUrl}
            sandbox={isPdf ? undefined : "allow-same-origin"}
            title={t("i18n.previewFile", { file: getFileName(filePath) })}
            style={{ width: "100%", height: "100%", border: "none", background: isPdf ? "var(--bg)" : "#eef1f5" }}
          />
        )}
      </div>
    </div>
  );
}

export function FileViewer({
  filePath,
  cwd,
  sourceSessionId,
  onOpenFile,
  locationTarget,
  onLocationHandled,
  onLocationFailed,
  onMentionLines,
  onAskInNewChat,
  onAtMention,
  gitRefreshKey,
  initialDisplayMode,
  initialState,
  onStateChange,
  watchEnabled = true,
}: Props) {
  if (isImagePath(filePath)) {
    return <ImageViewer filePath={filePath} cwd={cwd} sourceSessionId={sourceSessionId} watchEnabled={watchEnabled} />;
  }
  if (isAudioPath(filePath)) {
    return <AudioViewer filePath={filePath} cwd={cwd} sourceSessionId={sourceSessionId} watchEnabled={watchEnabled} />;
  }
  if (isVideoPath(filePath)) {
    return <VideoViewer filePath={filePath} cwd={cwd} sourceSessionId={sourceSessionId} watchEnabled={watchEnabled} />;
  }
  if (isDocumentPreviewPath(filePath)) {
    return <DocumentViewer filePath={filePath} cwd={cwd} sourceSessionId={sourceSessionId} watchEnabled={watchEnabled} />;
  }
  return (
    <TextFileViewer
      filePath={filePath}
      cwd={cwd}
      sourceSessionId={sourceSessionId}
      onOpenFile={onOpenFile}
      locationTarget={locationTarget}
      onLocationHandled={onLocationHandled}
      onLocationFailed={onLocationFailed}
      onMentionLines={onMentionLines}
      onAskInNewChat={onAskInNewChat}
      onAtMention={onAtMention}
      gitRefreshKey={gitRefreshKey}
      initialDisplayMode={initialDisplayMode}
      initialState={initialState}
      onStateChange={onStateChange}
      watchEnabled={watchEnabled}
    />
  );
}

function TextFileViewer({
  filePath,
  cwd,
  sourceSessionId,
  onOpenFile,
  locationTarget,
  onLocationHandled,
  onLocationFailed,
  onMentionLines,
  onAskInNewChat,
  onAtMention,
  gitRefreshKey,
  initialDisplayMode,
  initialState,
  onStateChange,
  watchEnabled = true,
}: Props) {
  const { isDark } = useTheme();
  const isMobile = useIsMobile();
  const { t } = useI18n();
  const [data, setData] = useState<FileData | null>(null);
  const [gitDiff, setGitDiff] = useState<GitFileDiffResponse | null>(null);
  const [gitDiffLoading, setGitDiffLoading] = useState(false);
  const [gitDiffResolved, setGitDiffResolved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [draftContent, setDraftContent] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const requestedInitialDisplayMode = resolveInitialFileDisplayMode(initialState, initialDisplayMode);
  const initialWrapLines = initialState?.wrapLines ?? false;
  const initialScrollTop = initialState?.scrollTop ?? 0;
  const initialScrollLeft = initialState?.scrollLeft ?? 0;
  const [displayMode, setDisplayMode] = useState<DisplayMode>(requestedInitialDisplayMode);
  const [wrapLines, setWrapLines] = useState(initialWrapLines);
  const [watching, setWatching] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const contentRequestRef = useRef(0);
  const gitDiffRequestRef = useRef(0);
  const loadedFilePathRef = useRef<string | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const editingRef = useRef(false);
  const liveEditingRef = useRef(false);
  const previousModeRef = useRef(displayMode);
  const editReturnModeRef = useRef<DisplayMode>("source");
  const autoDiffAppliedRef = useRef(false);
  const defaultPreviewEligibleRef = useRef(
    initialState === undefined && initialDisplayMode === undefined,
  );
  const scrollRestorePendingRef = useRef(true);
  const viewerStateRef = useRef<FileViewerState>({
    displayMode: requestedInitialDisplayMode,
    wrapLines: initialWrapLines,
    scrollTop: initialScrollTop,
    scrollLeft: initialScrollLeft,
  });
  const onStateChangeRef = useRef(onStateChange);
  const [selectedLineRange, setSelectedLineRange] = useState<SelectedLineRange | null>(null);
  const [selectionAction, setSelectionAction] = useState<PendingFileSelection | null>(null);
  const [fileQuoteInputOpen, setFileQuoteInputOpen] = useState(false);
  const [fileQuoteSubmitting, setFileQuoteSubmitting] = useState(false);
  const [fileQuoteError, setFileQuoteError] = useState<string | null>(null);
  const fileQuotePopoverRef = useRef<HTMLDivElement | null>(null);
  const fileQuoteChatInputRef = useRef<ChatInputHandle | null>(null);
  const locationHighlightRef = useRef<HTMLElement[]>([]);
  const markdownLocationApiRef = useRef<MarkdownEditorLocationApi | null>(null);
  const [markdownLocationReadyVersion, setMarkdownLocationReadyVersion] = useState(0);

  const handleMarkdownLocationReady = useCallback((api: MarkdownEditorLocationApi | null) => {
    markdownLocationApiRef.current = api;
    setMarkdownLocationReadyVersion((version) => version + 1);
  }, []);

  onStateChangeRef.current = onStateChange;

  const updateDisplayMode = useCallback((nextDisplayMode: DisplayMode) => {
    viewerStateRef.current.displayMode = nextDisplayMode;
    setDisplayMode(nextDisplayMode);
    // Keep the tab's lightweight state current while the viewer remains
    // mounted. A later location request can then reuse the live preview
    // instead of treating its preview mode as a fresh mount.
    onStateChangeRef.current?.({ ...viewerStateRef.current });
  }, []);

  const toggleWrapLines = useCallback(() => {
    setWrapLines((current) => {
      const next = !current;
      viewerStateRef.current.wrapLines = next;
      return next;
    });
  }, []);

  useEffect(() => {
    const nextState: FileViewerState = {
      displayMode: requestedInitialDisplayMode,
      wrapLines: initialWrapLines,
      scrollTop: initialScrollTop,
      scrollLeft: initialScrollLeft,
    };

    viewerStateRef.current = nextState;
    scrollRestorePendingRef.current = true;
    autoDiffAppliedRef.current = false;
    setDisplayMode(requestedInitialDisplayMode);
    setWrapLines(initialWrapLines);

    return () => {
      onStateChangeRef.current?.({ ...viewerStateRef.current });
    };
  }, [
    filePath,
    sourceSessionId,
    requestedInitialDisplayMode,
    initialWrapLines,
    initialScrollTop,
    initialScrollLeft,
  ]);

  const fetchContent = useCallback((filePath: string, offset = 0) => {
    const requestId = ++contentRequestRef.current;
    return fetch(getFileApiUrl(filePath, "read", sourceSessionId, { offset: offset || undefined }))
      .then((r) => r.json())
      .then((d: FileData & { error?: string }) => {
        if (requestId !== contentRequestRef.current) return null;
        if (d.error) {
          setError(d.error);
          return null;
        }
        setError(null);
        setData((current) => offset && current
          ? { ...d, content: current.content + d.content }
          : d);
        return d;
      })
      .catch((e) => {
        if (requestId !== contentRequestRef.current) return null;
        setError(String(e));
        return null;
      });
  }, [sourceSessionId]);

  const fetchGitDiff = useCallback(async (targetPath: string) => {
    const requestId = ++gitDiffRequestRef.current;
    setGitDiffLoading(true);
    if (!cwd) {
      setGitDiff(null);
      setGitDiffLoading(false);
      setGitDiffResolved(true);
      return;
    }

    try {
      const params = new URLSearchParams({ cwd, path: targetPath });
      const response = await fetch(`/api/git/diff?${params.toString()}`);
      const next = await response.json() as GitFileDiffResponse & { error?: string };
      if (requestId !== gitDiffRequestRef.current) return;
      setGitDiff(response.ok && next.supported && typeof next.patch === "string" ? next : null);
    } catch {
      if (requestId === gitDiffRequestRef.current) setGitDiff(null);
    } finally {
      if (requestId === gitDiffRequestRef.current) {
        setGitDiffLoading(false);
        setGitDiffResolved(true);
      }
    }
  }, [cwd]);

  useEffect(() => {
    if (previousModeRef.current === "preview" && displayMode !== "preview" && !isEditing && getFileExt(filePath) === "md") {
      void fetchContent(filePath);
    }
    previousModeRef.current = displayMode;
  }, [displayMode, fetchContent, filePath, isEditing]);

  // Reset and load the file itself when its identity changes. Live watching is
  // managed separately so pausing it never clears the displayed content.
  useEffect(() => {
    let active = true;
    const fileChanged = loadedFilePathRef.current !== filePath;
    loadedFilePathRef.current = filePath;
    setLoading(true);
    setError(null);
    // A location request can add a source session id to an already-open file.
    // Keep the current document mounted while that same file is revalidated;
    // clearing it here makes the whole editor flash and jump on first locate.
    if (fileChanged) setData(null);
    setGitDiff(null);
    setGitDiffResolved(false);
    setWatching(false);
    editingRef.current = false;
    setIsEditing(false);
    setDraftContent("");
    setSaveState("idle");
    setSaveError(null);

    fetchContent(filePath).finally(() => {
      if (active) setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [filePath, fetchContent, sourceSessionId]);

  useEffect(() => {
    setWatching(false);

    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    if (!watchEnabled) return;

    const synchronize = () => {
      if (editingRef.current) return;
      if (!liveEditingRef.current) void fetchContent(filePath);
      void fetchGitDiff(filePath);
    };

    const es = new EventSource(getFileApiUrl(filePath, "watch", sourceSessionId));
    esRef.current = es;

    es.addEventListener("connected", () => {
      setWatching(true);
      // The server emits connected only after its watcher exists. Reading now
      // closes the gap between the last snapshot and live events.
      synchronize();
    });

    es.addEventListener("change", synchronize);

    const markDisconnected = () => {
      setWatching(false);
    };
    es.addEventListener("error", markDisconnected);
    es.onerror = markDisconnected;

    return () => {
      es.close();
      if (esRef.current === es) esRef.current = null;
    };
  }, [filePath, fetchContent, fetchGitDiff, sourceSessionId, watchEnabled]);

  useEffect(() => {
    void fetchGitDiff(filePath);
  }, [fetchGitDiff, filePath, gitRefreshKey]);

  useEffect(() => {
    // HTML gets the same rendered-first treatment as markdown: a generated page
    // is usually more useful viewed than read as source. Both have a preview
    // mode already; the source tab stays one click away. A restored choice or
    // explicit mode hint always wins over this default.
    if (
      defaultPreviewEligibleRef.current
      && !data?.truncated
      && (data?.language === "markdown" || data?.language === "html")
    ) {
      defaultPreviewEligibleRef.current = false;
      updateDisplayMode("preview");
    }
  }, [data?.language, data?.truncated, updateDisplayMode]);

  const hasGitDiff = gitDiff?.supported === true && typeof gitDiff.patch === "string";
  const isDeletedDiff = hasGitDiff && gitDiff.status === "deleted";

  useEffect(() => {
    if (gitDiffResolved && !hasGitDiff && displayMode === "diff") updateDisplayMode("source");
  }, [displayMode, gitDiffResolved, hasGitDiff, updateDisplayMode]);

  // Wait for the git request before restoring diff mode so the unresolved
  // placeholder cannot immediately demote it back to source.
  useEffect(() => {
    if (requestedInitialDisplayMode === "diff" && hasGitDiff && !autoDiffAppliedRef.current) {
      autoDiffAppliedRef.current = true;
      updateDisplayMode("diff");
    }
  }, [requestedInitialDisplayMode, hasGitDiff, updateDisplayMode]);

  const viewerContent = data?.content ?? "";
  const sourceLines = useMemo(() => viewerContent.split("\n"), [viewerContent]);
  const language = data?.language ?? "text";
  const isHtml = language === "html";
  const isMarkdown = language === "markdown";
  const isCodeText = isEditableTextPath(filePath) && !isMarkdown;
  const hasPreview = !data?.truncated && (isHtml || isMarkdown);
  const effectiveDisplayMode = isDeletedDiff ? "diff" : displayMode;
  const draftDirty = isEditing && data !== null && draftContent !== data.content;
  const liveEditing = !isMobile && data?.editable === true && !data.truncated
    && !isEditing && !isDeletedDiff
    && ((isMarkdown && getFileExt(filePath) === "md" && effectiveDisplayMode === "preview")
      || (isCodeText && effectiveDisplayMode === "source"));
  liveEditingRef.current = liveEditing;

  useEffect(() => () => {
    for (const element of locationHighlightRef.current) element.classList.remove(LOCATION_HIGHLIGHT_CLASS);
    markdownLocationApiRef.current?.clearLocation();
    clearLocationTextHighlight();
    locationHighlightRef.current = [];
  }, []);

  // A file annotation stays in the viewer's current mode. Markdown preview and
  // editing are one persistent instance, so navigation must wait for that
  // instance's DOM instead of switching modes and remounting it.
  useEffect(() => {
    if (!locationTarget || !data || loading || error) return;

    let cancelled = false;
    let frame: number | null = null;
    let attempts = 0;
    let observer: MutationObserver | null = null;
    let locationVisible = false;
    const MAX_LOCATION_ATTEMPTS = 120;

    const stopObserver = () => {
      observer?.disconnect();
      observer = null;
    };

    const finishLocation = (handled: boolean) => {
      stopObserver();
      locationVisible = false;
      for (const element of locationHighlightRef.current) element.classList.remove(LOCATION_HIGHLIGHT_CLASS);
      markdownLocationApiRef.current?.clearLocation();
      clearLocationTextHighlight();
      locationHighlightRef.current = [];
      if (handled) onLocationHandled?.(locationTarget);
      else onLocationFailed?.(locationTarget);
    };

    const completeLocation = (elements: HTMLElement[], editorOwnsHighlight = false) => {
      stopObserver();
      locationVisible = true;
      for (const element of locationHighlightRef.current) element.classList.remove(LOCATION_HIGHLIGHT_CLASS);
      if (editorOwnsHighlight) {
        // The ProseMirror editor owns its block DOM. It applies and clears the
        // class itself so the parent effect cannot remove it during the
        // location callback or when the pending target is consumed.
        locationHighlightRef.current = [];
      } else {
        for (const element of elements) element.classList.add(LOCATION_HIGHLIGHT_CLASS);
        locationHighlightRef.current = elements;
      }
    };

    const dismissOnPointerDown = (event: PointerEvent) => {
      if (event.button === 0 && locationVisible) finishLocation(true);
    };
    const dismissOnKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && locationVisible) finishLocation(true);
    };
    document.addEventListener("pointerdown", dismissOnPointerDown, true);
    document.addEventListener("keydown", dismissOnKeyDown, true);

    const locate = () => {
      if (cancelled) return;
      const root = contentRef.current;
      if (!root) {
        if (attempts++ < MAX_LOCATION_ATTEMPTS) frame = window.requestAnimationFrame(locate);
        else finishLocation(false);
        return;
      }

      // A live editor is dynamically imported and owns its own location API.
      // Keep the request pending until its reveal API is ready instead of
      // treating a slow import as a failed location.
      if (liveEditing && !markdownLocationApiRef.current) {
        frame = window.requestAnimationFrame(locate);
        return;
      }

      // Observe the short mounting window so a slow dynamic import or a late
      // editor DOM update cannot consume the location request.
      if (!observer && typeof MutationObserver !== "undefined") {
        observer = new MutationObserver(() => locate());
        observer.observe(root, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["data-source-line", "data-source-start-line", "data-source-end-line"],
        });
      }

      // Location navigation should behave like conversation navigation: it
      // highlights the target without creating a native text selection (and
      // therefore without opening the selection action popover).
      window.getSelection()?.removeAllRanges();

      const lines = data.content.split("\n");
      const requestedStart = Number.isInteger(locationTarget.startLine) ? locationTarget.startLine! : 0;
      const requestedEnd = Number.isInteger(locationTarget.endLine) ? locationTarget.endLine! : requestedStart;
      let startLine = requestedStart;
      let endLine = requestedEnd;
      const snapshot = locationTarget.text.trim();
      // The snapshot comes from rendered Preview text, while `data.content`
      // still contains Markdown syntax (and may have different soft-breaks).
      // A valid line hint must therefore not be rejected just because the raw
      // source does not literally contain the rendered snapshot. Doing so
      // previously fell back to the first global text match, which was wrong
      // whenever the same phrase appeared more than once.
      const hasValidLineRange = startLine > 0 && endLine >= startLine && startLine <= lines.length;
      if (!hasValidLineRange && snapshot) {
        const match = data.content.indexOf(snapshot);
        if (match >= 0) {
          startLine = data.content.slice(0, match).split("\n").length;
          endLine = startLine + snapshot.split("\n").length - 1;
        }
      }

      let elements: HTMLElement[] = [];
      if (liveEditing) {
        elements = markdownLocationApiRef.current?.revealLocation({
          text: snapshot,
          startLine,
          endLine,
        }) ?? [];
        if (elements.length > 0) {
          completeLocation(elements, true);
          return;
        }
      } else if (isMarkdown && effectiveDisplayMode === "preview") {
        const sourceLineElements = Array.from(root.querySelectorAll<HTMLElement>(".markdown-source-line[data-source-line]"));
        const sourceRangeElements = Array.from(root.querySelectorAll<HTMLElement>("[data-source-start-line][data-source-end-line]")).filter((element) => {
          const blockStart = Number(element.dataset.sourceStartLine);
          const blockEnd = Number(element.dataset.sourceEndLine);
          return Number.isInteger(blockStart) && Number.isInteger(blockEnd)
            && (!startLine || blockEnd >= startLine) && (!endLine || blockStart <= endLine);
        });
        const outerSourceRangeElements = sourceRangeElements.filter((element) =>
          !element.parentElement?.closest("[data-source-start-line][data-source-end-line]"),
        );
        if (startLine > 0 && endLine >= startLine) {
          elements = sourceLineElements.filter((element) => {
            const line = Number(element.dataset.sourceLine);
            return Number.isInteger(line) && line >= startLine && line <= endLine;
          });
        }
        // Older rendered nodes and complex blocks may not expose per-line
        // spans. Keep the previous block-range behavior as a safe fallback.
        if (elements.length === 0) elements = outerSourceRangeElements;
        if (elements.length === 0 && snapshot) {
          elements = Array.from(root.querySelectorAll<HTMLElement>("[data-source-start-line][data-source-end-line]"))
            .filter((element) => !element.parentElement?.closest("[data-source-start-line][data-source-end-line]"))
            .filter((element) => findLocationTextRange(element, snapshot) !== null);
        }

        // Line metadata chooses the right block; the rendered text range then
        // chooses the exact phrase inside that block. This is what makes a
        // multiline paragraph or formatted text land at the actual selection
        // instead of merely centering the paragraph's first line.
        const textCandidates = outerSourceRangeElements.length > 0 ? outerSourceRangeElements : elements;
        const locationRange = snapshot ? findLocationTextRangeInRoots(textCandidates, snapshot) : null;
        if (locationRange && scrollLocationRangeIntoView(root, locationRange)) {
          completeLocation(elements);
          return;
        }
      } else if (effectiveDisplayMode === "source" && startLine > 0) {
        elements = Array.from({ length: Math.max(1, endLine - startLine + 1) }, (_, index) =>
          root.querySelector<HTMLElement>(`.file-source-line[data-line-number=\"${startLine + index}\"]`),
        ).filter((element): element is HTMLElement => Boolean(element));
      }

      const first = elements[0];
      if (!first) {
        if (attempts++ < MAX_LOCATION_ATTEMPTS) {
          frame = window.requestAnimationFrame(locate);
        } else {
          finishLocation(false);
        }
        return;
      }
      const scroller = first.closest<HTMLElement>(".file-viewer-content") ?? root;
      const firstRect = first.getBoundingClientRect();
      const scrollerRect = scroller.getBoundingClientRect();
      const padding = Math.min(48, Math.max(16, scroller.clientHeight * 0.2));
      const visibleTop = scrollerRect.top + padding;
      const visibleBottom = scrollerRect.bottom - padding;
      if (firstRect.top < visibleTop || firstRect.bottom > visibleBottom) {
        scroller.scrollBy({
          top: (firstRect.top + firstRect.bottom) / 2 - (scrollerRect.top + scrollerRect.bottom) / 2,
          behavior: "auto",
        });
      }
      completeLocation(elements);
    };

    frame = window.requestAnimationFrame(locate);
    return () => {
      cancelled = true;
      stopObserver();
      document.removeEventListener("pointerdown", dismissOnPointerDown, true);
      document.removeEventListener("keydown", dismissOnKeyDown, true);
      if (frame !== null) window.cancelAnimationFrame(frame);
      for (const element of locationHighlightRef.current) element.classList.remove(LOCATION_HIGHLIGHT_CLASS);
      markdownLocationApiRef.current?.clearLocation();
      clearLocationTextHighlight();
      locationHighlightRef.current = [];
    };
  }, [
    data,
    displayMode,
    effectiveDisplayMode,
    error,
    isMarkdown,
    liveEditing,
    loading,
    locationTarget,
    markdownLocationReadyVersion,
    onLocationFailed,
    onLocationHandled,
  ]);

  const cancelEdit = useCallback(() => {
    setDraftContent(data?.content ?? "");
    setSaveState("idle");
    setSaveError(null);
    editingRef.current = false;
    setIsEditing(false);
    updateDisplayMode(editReturnModeRef.current);
  }, [data, updateDisplayMode]);

  const saveMarkdown = useCallback(async () => {
    if (!data || !isMarkdown || data.truncated || isDeletedDiff || !isEditing || saveState === "saving") return;

    setSaveState("saving");
    setSaveError(null);
    try {
      const response = await fetch(getFileApiBaseUrl(filePath), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: draftContent, baseContent: data.content }),
      });
      const result = await response.json().catch(() => null) as { error?: unknown; size?: unknown } | null;
      if (!response.ok) {
        const message = typeof result?.error === "string" ? result.error : `Save failed (${response.status})`;
        throw new Error(message);
      }

      const size = typeof result?.size === "number"
        ? result.size
        : new TextEncoder().encode(draftContent).byteLength;
      setData((current) => current
        ? { ...current, content: draftContent, size, nextOffset: 0, truncated: false }
        : current);
      editingRef.current = false;
      setIsEditing(false);
      updateDisplayMode(editReturnModeRef.current);
      setSaveState("saved");
      void fetchGitDiff(filePath);
    } catch (saveFailure) {
      setSaveState("idle");
      setSaveError(saveFailure instanceof Error ? saveFailure.message : String(saveFailure));
    }
  }, [data, draftContent, fetchGitDiff, filePath, isDeletedDiff, isEditing, isMarkdown, saveState, updateDisplayMode]);

  const handleEditorKeyDown = useCallback((event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey || event.key.toLowerCase() !== "s") return;
    event.preventDefault();
    void saveMarkdown();
  }, [saveMarkdown]);

  const useLightweightSource = sourceLines.length > SOURCE_HIGHLIGHT_MAX_LINES
    && !(effectiveDisplayMode === "diff" && hasGitDiff)
    && !(effectiveDisplayMode === "preview" && hasPreview);
  // react-syntax-highlighter rebuilds every token element on each render, which
  // costs hundreds of milliseconds on large files. Cache the rendered trees so
  // unrelated re-renders (panel open/close, selection changes) reuse them as-is.
  const highlightedSource = useMemo(
    () => (
      <SyntaxHighlighter
        className={wrapLines ? "file-source-view is-wrapped" : "file-source-view"}
        language={language === "text" ? "plaintext" : language}
        style={isDark ? vscDarkPlus : vs}
        showLineNumbers
        lineNumberStyle={{
          ...FILE_LINE_NUMBER_STYLE,
        }}
        customStyle={{
          margin: 0,
          padding: 0,
          border: 0,
          background: "var(--bg)",
          ...FILE_CODE_STYLE,
          width: wrapLines ? "100%" : "max-content",
          minWidth: "100%",
          minHeight: "100%",
          overflow: "visible",
        }}
        codeTagProps={{
          style: {
            fontFamily: "var(--font-mono)",
            overflowWrap: wrapLines ? "anywhere" : "normal",
          },
        }}
        renderer={(rendererProps) => (
          <SourceCodeRenderer {...rendererProps} wrapLines={wrapLines} />
        )}
        wrapLongLines={wrapLines}
      >
        {viewerContent}
      </SyntaxHighlighter>
    ),
    [isDark, language, viewerContent, wrapLines],
  );
  const lightweightSourceLines = useMemo(
    () => useLightweightSource ? sourceLines.map((line, lineIndex) => (
      <span
        className="file-source-line"
        data-line-number={lineIndex + 1}
        key={`source-line-${lineIndex}`}
        style={{ display: "flex", minWidth: "100%" }}
      >
        <span aria-hidden="true" style={FILE_LINE_NUMBER_STYLE}>
          {lineIndex + 1}
        </span>
        <span
          className="file-source-line-content"
          style={{
            flex: "1 1 auto",
            minWidth: 0,
            overflowWrap: wrapLines ? "anywhere" : "normal",
            whiteSpace: wrapLines ? "pre-wrap" : "pre",
          }}
        >
          {line}
        </span>
      </span>
    )) : null,
    [sourceLines, useLightweightSource, wrapLines],
  );

  useEffect(() => {
    const updateSelectedLineRange = () => {
      if (locationTarget && sameFilePath(locationTarget.filePath, filePath)) {
        setSelectedLineRange(null);
        setSelectionAction(null);
        return;
      }
      const root = contentRef.current;
      const selection = window.getSelection();
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
      const supportsDomSelection = displayMode === "source" || (isMarkdown && effectiveDisplayMode === "preview" && !liveEditing);
      if (fileQuoteInputOpen) return;
      if (liveEditing) return;
      const lineRange = onMentionLines && supportsDomSelection && root
        ? displayMode === "source"
          ? getSelectedSourceLineRange(root, selection)
          : getSelectedMarkdownLineRange(root, selection)
        : null;
      setSelectedLineRange((current) => {
        const next = lineRange;
        // Skip no-op updates: selectionchange fires continuously while dragging,
        // and a fresh-but-equal range object would re-render the whole viewer.
        if (current === null && next === null) return current;
        if (current && next && current.startLine === next.startLine && current.endLine === next.endLine) return current;
        return next;
      });
      if (!onMentionLines || !supportsDomSelection || !root || !range) {
        setSelectionAction(null);
        return;
      }
      const text = selection?.toString().trim();
      if (!lineRange || !text) {
        setSelectionAction(null);
        return;
      }
      const rect = range.getBoundingClientRect();
      setSelectionAction((current) => {
        const next = {
          ...lineRange,
          text,
          top: Math.min(window.innerHeight - 44, rect.bottom + 8),
          left: Math.max(8, Math.min(window.innerWidth - 8, rect.left + rect.width / 2)),
        };
        return current
          && current.startLine === next.startLine
          && current.endLine === next.endLine
          && current.text === next.text
          && current.top === next.top
          && current.left === next.left
          ? current
          : next;
      });
    };

    updateSelectedLineRange();
    const supportsDomSelection = displayMode === "source" || (isMarkdown && effectiveDisplayMode === "preview" && !liveEditing);
    if (!onMentionLines || !supportsDomSelection) return;

    document.addEventListener("selectionchange", updateSelectedLineRange);
    return () => document.removeEventListener("selectionchange", updateSelectedLineRange);
  }, [data?.content, displayMode, effectiveDisplayMode, filePath, fileQuoteInputOpen, isMarkdown, liveEditing, locationTarget, onMentionLines]);

  const addFileSelection = useCallback((lineRange: SelectedLineRange | null, text: string) => {
    if (!onMentionLines || !lineRange) return;
    if (!text) return;
    onMentionLines({
      relativePath: getRelativeFilePath(filePath, cwd),
      filePath,
      sourceSessionId,
      text,
      startLine: lineRange.startLine,
      endLine: lineRange.endLine,
      language: data?.language,
    });
  }, [cwd, data?.language, filePath, onMentionLines, sourceSessionId]);

  const mentionLineRange = useCallback((lineRange: SelectedLineRange | null) => {
    const text = selectionAction
      && lineRange
      && selectionAction.startLine === lineRange.startLine
      && selectionAction.endLine === lineRange.endLine
      ? selectionAction.text
      : window.getSelection()?.toString().trim() ?? "";
    addFileSelection(lineRange, text);
  }, [addFileSelection, selectionAction]);

  const addSelectedFileContext = useCallback(() => {
    if (!selectionAction) return;
    addFileSelection(selectionAction, selectionAction.text);
    window.getSelection()?.removeAllRanges();
    setSelectionAction(null);
  }, [addFileSelection, selectionAction]);

  const closeFileQuote = useCallback(() => {
    if (fileQuoteSubmitting) return;
    setFileQuoteInputOpen(false);
    setFileQuoteError(null);
  }, [fileQuoteSubmitting]);

  // Keep the file selector's menu pixel-for-pixel aligned with the chat
  // selector: fixed popovers need a measured left edge, not a transform that
  // lets the browser shrink buttons near a viewport edge.
  useLayoutEffect(() => {
    const popover = fileQuotePopoverRef.current;
    if (!popover || !selectionAction) return;
    const viewport = window.visualViewport;
    const position = () => {
      const rect = popover.getBoundingClientRect();
      const top = viewport?.offsetTop ?? 0;
      const left = viewport?.offsetLeft ?? 0;
      popover.style.top = `${Math.max(top + 8, Math.min(selectionAction.top, top + (viewport?.height ?? window.innerHeight) - rect.height - 8))}px`;
      popover.style.left = `${Math.max(left + 8, Math.min(selectionAction.left - rect.width / 2, left + (viewport?.width ?? window.innerWidth) - rect.width - 8))}px`;
    };
    position();
    const observer = new ResizeObserver(position);
    observer.observe(popover);
    viewport?.addEventListener("resize", position);
    viewport?.addEventListener("scroll", position);
    return () => {
      observer.disconnect();
      viewport?.removeEventListener("resize", position);
      viewport?.removeEventListener("scroll", position);
    };
  }, [fileQuoteError, fileQuoteInputOpen, selectionAction]);

  useEffect(() => {
    if (!fileQuoteInputOpen || !selectionAction) return;
    fileQuoteChatInputRef.current?.insertIfEmpty(buildFileLineMentionText(
      getRelativeFilePath(filePath, cwd),
      selectionAction.startLine,
      selectionAction.endLine,
    ));
  }, [cwd, filePath, fileQuoteInputOpen, selectionAction]);

  const askFileSelectionInNewChat = useCallback(async (prompt: string) => {
    if (!onAskInNewChat || !prompt.trim()) return;
    setFileQuoteSubmitting(true);
    setFileQuoteError(null);
    try {
      await onAskInNewChat(prompt);
      window.getSelection()?.removeAllRanges();
      setSelectionAction(null);
      setFileQuoteInputOpen(false);
    } catch (error) {
      fileQuoteChatInputRef.current?.restoreSubmission(prompt);
      setFileQuoteError(error instanceof Error ? error.message : String(error));
    } finally {
      setFileQuoteSubmitting(false);
    }
  }, [onAskInNewChat]);

  useEffect(() => {
    if (!onMentionLines || displayMode !== "source") return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.key.toLowerCase() !== "i" || (!event.metaKey && !event.ctrlKey) || event.altKey || event.shiftKey) return;

      const target = event.target;
      if (target instanceof Element && target.closest("input, textarea, [contenteditable='true']")
        && !target.closest(".cm-editor")) return;

      const root = contentRef.current;
      const lineRange = liveEditing
        ? selectedLineRange
        : root ? getSelectedSourceLineRange(root, window.getSelection()) : null;
      if (!lineRange) return;

      event.preventDefault();
      mentionLineRange(lineRange);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [displayMode, liveEditing, mentionLineRange, onMentionLines, selectedLineRange]);

  useEffect(() => {
    if (!scrollRestorePendingRef.current || loading) return;
    if (error && !isDeletedDiff) return;
    if (requestedInitialDisplayMode === "diff" && !gitDiffResolved) return;
    if (requestedInitialDisplayMode === "diff" && hasGitDiff && displayMode !== "diff") return;

    const content = contentRef.current;
    if (!content) return;

    content.scrollTop = viewerStateRef.current.scrollTop;
    content.scrollLeft = viewerStateRef.current.scrollLeft;
    scrollRestorePendingRef.current = false;
  }, [
    data?.content,
    displayMode,
    error,
    gitDiffResolved,
    hasGitDiff,
    isDeletedDiff,
    loading,
    requestedInitialDisplayMode,
  ]);

  if ((loading && !data) || (requestedInitialDisplayMode === "diff" && gitDiffLoading && !data)) {
    return (
      <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 13 }}>
        {t("i18n.loading")}
      </div>
    );
  }

  if (error && !isDeletedDiff) {
    return (
      <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#f87171", fontSize: 13 }}>
        {error}
      </div>
    );
  }

  if (!data && !isDeletedDiff) return null;

  const content = viewerContent;
  const lines = sourceLines;
  const displayModes: DisplayMode[] = isDeletedDiff
    ? ["diff"]
    : [
        "source",
        ...(hasPreview ? ["preview" as const] : []),
        ...(hasGitDiff ? ["diff" as const] : []),
      ];
  const metadata = isDeletedDiff
    ? t("files.deleted")
    : `${language} · ${lines.length} lines · ${formatSize(data!.size)}`;

  return (
    <div className="file-viewer-shell" style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", position: "relative" }}>
      <div
        className="file-viewer-toolbar"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "5px 12px",
          borderBottom: "1px solid var(--border)",
          fontSize: 11,
          color: "var(--text-dim)",
          background: "var(--bg)",
          flexShrink: 0,
        }}
      >
        <span className="file-viewer-path" style={{ fontFamily: "var(--font-mono)" }} title={filePath}>
          {getRelativeFilePath(filePath, cwd)}
        </span>

        <span className="file-viewer-meta" title={metadata}>{metadata}</span>
        {saveState === "saved" && !isEditing && (
          <span className="file-viewer-save-status" role="status">{t("i18n.saved")}</span>
        )}
        {!isDeletedDiff && (
          <span
            title={watching ? t("i18n.liveSync") : t("i18n.notWatching")}
            aria-label={watching ? t("i18n.liveSync") : t("i18n.notWatching")}
            className="file-viewer-live-indicator"
            style={{
              background: watching ? "#4ade80" : "var(--border)",
              boxShadow: watching ? "0 0 4px #4ade80" : "none",
            }}
          />
        )}

        <div className="file-viewer-controls">
          {!isEditing && displayModes.length > 1 && (
            <div className="file-viewer-mode-switch" aria-label={t("i18n.fileViewMode")}>
              {displayModes.map((mode) => {
                const active = effectiveDisplayMode === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => updateDisplayMode(mode)}
                    title={mode === "diff" ? t("i18n.compareHead") : undefined}
                    aria-pressed={active}
                    className="file-viewer-mode-button"
                    style={{
                      background: active ? "var(--bg-selected)" : "transparent",
                      color: active ? "var(--text)" : "var(--text-muted)",
                    }}
                  >
                    {DISPLAY_MODE_LABELS[mode]}
                  </button>
                );
              })}
            </div>
          )}

          <div className="file-viewer-actions">
            {!isEditing && (onAtMention || onMentionLines) && (
              <button
                type="button"
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => {
                  // Mention selected lines when a range is active (and line
                  // mention is wired up); otherwise fall back to a whole-file
                  // @mention. Same button, behavior follows the selection.
                  if (selectedLineRange && onMentionLines) {
                    mentionLineRange(selectedLineRange);
                  } else {
                    onAtMention?.(getRelativeFilePath(filePath, cwd), false);
                  }
                }}
                title={
                  selectedLineRange && onMentionLines
                    ? `${t("i18n.mentionSelectedLines")} (L${selectedLineRange.startLine}${selectedLineRange.startLine !== selectedLineRange.endLine ? `-L${selectedLineRange.endLine}` : ""})`
                    : t("files.insertPath")
                }
                aria-label={t("files.mention")}
                disabled={!onAtMention && !onMentionLines}
                className="file-viewer-icon-button"
              >
                <MentionIcon />
              </button>
            )}
            {!isEditing && !liveEditing && effectiveDisplayMode === "source" && (
              <>
                <button
                  type="button"
                  onClick={toggleWrapLines}
                  title={wrapLines ? t("i18n.disableWrap") : t("i18n.enableWrap")}
                  aria-label={wrapLines ? t("i18n.disableWrap") : t("i18n.enableWrap")}
                  aria-pressed={wrapLines}
                  className="file-viewer-icon-button"
                  style={{
                    background: wrapLines ? "var(--bg-selected)" : "transparent",
                    color: wrapLines ? "var(--text)" : "var(--text-muted)",
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3 6h18" />
                    <path d="M3 12h15a3 3 0 1 1 0 6h-4" />
                    <path d="m16 16-2 2 2 2" />
                    <path d="M3 18h7" />
                  </svg>
                </button>
              </>
            )}
            {isEditing && (
              <>
                <button
                  type="button"
                  onClick={cancelEdit}
                  disabled={saveState === "saving"}
                  title={t("i18n.cancel")}
                  aria-label={t("i18n.cancel")}
                  className="file-viewer-mode-button"
                  style={{ border: "1px solid var(--border)", borderRadius: 5, color: "var(--text-muted)", background: "transparent" }}
                >
                  {t("i18n.cancel")}
                </button>
                <button
                  type="button"
                  onClick={() => void saveMarkdown()}
                  disabled={!draftDirty || saveState === "saving"}
                  title={t("i18n.save")}
                  aria-label={t("i18n.save")}
                  className="file-viewer-mode-button"
                  style={{ border: "1px solid var(--accent)", borderRadius: 5, color: "var(--text)", background: "var(--bg-selected)" }}
                >
                  {saveState === "saving" ? t("i18n.saving") : t("i18n.save")}
                </button>
              </>
            )}
          </div>

          {!isDeletedDiff && <DownloadLink filePath={filePath} sourceSessionId={sourceSessionId} />}
        </div>
      </div>

      {data?.truncated && (
        <div
          className="file-viewer-load-more"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            padding: "5px 8px",
            border: "1px solid var(--border)",
            borderRadius: 6,
            color: "var(--text-dim)",
            fontSize: 11,
          }}
        >
          <span>{formatSize(data.nextOffset)} / {formatSize(data.size)}</span>
          <button
            type="button"
            className="file-viewer-mode-button"
            disabled={loadingMore}
            onClick={() => {
              setLoadingMore(true);
              void fetchContent(filePath, data.nextOffset).finally(() => setLoadingMore(false));
            }}
          >
            {loadingMore ? t("i18n.loading") : t("i18n.loadMore")}
          </button>
        </div>
      )}

      {/* Content area */}
      <div
        ref={contentRef}
        className="file-viewer-content"
        onScroll={(event) => {
          viewerStateRef.current.scrollTop = event.currentTarget.scrollTop;
          viewerStateRef.current.scrollLeft = event.currentTarget.scrollLeft;
        }}
        style={{ flex: 1, overflow: "auto", background: "var(--bg)", paddingBottom: data?.truncated ? 48 : undefined }}
      >
        {isEditing ? (
          <div className="file-markdown-editor-shell">
            <textarea
              className="file-markdown-editor"
              value={draftContent}
              onChange={(event) => {
                setDraftContent(event.currentTarget.value);
                setSaveError(null);
              }}
              onKeyDown={handleEditorKeyDown}
              autoFocus
              spellCheck={false}
              aria-label={getFileName(filePath)}
            />
            {saveError && (
              <div className="file-viewer-save-error" role="alert">{saveError}</div>
            )}
          </div>
        ) : liveEditing && isCodeText ? (
          <CodeFileEditor
            filePath={filePath}
            content={content}
            sourceSessionId={sourceSessionId}
            watchEnabled={watchEnabled}
            initialScrollTop={initialScrollTop}
            initialScrollLeft={initialScrollLeft}
            hasPendingLocation={Boolean(locationTarget)}
            onScrollPositionChange={({ scrollTop, scrollLeft }) => {
              viewerStateRef.current.scrollTop = scrollTop;
              viewerStateRef.current.scrollLeft = scrollLeft;
              onStateChangeRef.current?.({ ...viewerStateRef.current });
            }}
            onLocationReady={handleMarkdownLocationReady}
            onSelectionChange={(selection: MarkdownEditorSelection | null) => {
              if (!selection) {
                setSelectedLineRange(null);
                setSelectionAction(null);
                return;
              }
              setSelectedLineRange({ startLine: selection.startLine, endLine: selection.endLine });
              setSelectionAction(selection);
            }}
          />
        ) : effectiveDisplayMode === "diff" && hasGitDiff ? (
          <DiffView patch={gitDiff.patch!} />
        ) : isHtml && effectiveDisplayMode === "preview" ? (
          <iframe
            srcDoc={content}
            sandbox="allow-scripts"
            style={{ width: "100%", height: "100%", border: "none", background: "var(--bg)" }}
             title={t("i18n.htmlPreview")}
          />
        ) : liveEditing ? (
          <MarkdownFileEditor key={filePath} filePath={filePath} cwd={cwd} sourceSessionId={sourceSessionId}
            onOpenFile={onOpenFile} content={content} watchEnabled={watchEnabled}
            onLocationReady={handleMarkdownLocationReady}
            onSelectionChange={(selection: MarkdownEditorSelection | null) => {
              if (!selection) {
                setSelectedLineRange(null);
                setSelectionAction(null);
                return;
              }
              setSelectedLineRange({ startLine: selection.startLine, endLine: selection.endLine });
              setSelectionAction(selection);
            }} />
        ) : isMarkdown && effectiveDisplayMode === "preview" ? (
          <div className="markdown-body markdown-file-preview markdown-readable-column" style={{ padding: "24px 32px" }}>
            <MarkdownFilePreview content={content} filePath={filePath} cwd={cwd}
              sourceSessionId={sourceSessionId} onOpenFile={onOpenFile} />
          </div>
        ) : useLightweightSource ? (
          <div
            className="file-source-view is-lightweight"
            style={{
              width: wrapLines ? "100%" : "max-content",
              minWidth: "100%",
              minHeight: "100%",
              background: "var(--bg)",
              ...FILE_CODE_STYLE,
            }}
          >
            {lightweightSourceLines}
          </div>
        ) : (
          highlightedSource
        )}
      </div>
      {selectionAction && !locationTarget && onMentionLines && createPortal(
        <div
          ref={fileQuotePopoverRef}
          role={fileQuoteInputOpen ? "dialog" : "toolbar"}
          aria-label={t(fileQuoteInputOpen ? "chat.newQuoteChat" : "chat.askSelection")}
          style={{
            position: "fixed",
            top: selectionAction.top,
            left: selectionAction.left,
            zIndex: 130,
            display: "flex",
            flexWrap: "wrap",
            gap: 3,
            width: fileQuoteInputOpen ? "min(420px, calc(100vw - 16px))" : undefined,
            maxWidth: "calc(100vw - 16px)",
            maxHeight: "calc(var(--app-viewport-height, 100dvh) - 16px)",
            overflowY: "auto",
            padding: fileQuoteInputOpen ? 12 : 3,
            border: "1px solid var(--border)",
            borderRadius: 6,
            background: "var(--bg)",
            boxShadow: "0 2px 10px rgba(0,0,0,0.12)",
          }}
        >
          {fileQuoteInputOpen ? (
            <fieldset disabled={fileQuoteSubmitting} aria-busy={fileQuoteSubmitting} style={{ width: "100%", minWidth: 0, margin: 0, padding: 0, border: "none", display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 600 }}>{t("chat.askInNewChat")}</span>
                <button type="button" className="file-viewer-icon-button" title={t("i18n.close")} aria-label={t("i18n.close")} disabled={fileQuoteSubmitting} onClick={closeFileQuote} style={{ border: "none" }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
                </button>
              </div>
              <ChatInput ref={fileQuoteChatInputRef} compact onSend={askFileSelectionInNewChat} onAbort={closeFileQuote} isStreaming={false} />
              {fileQuoteError && <div role="alert" style={{ color: "#dc2626", fontSize: 12, overflowWrap: "anywhere" }}>{fileQuoteError}</div>}
            </fieldset>
          ) : <>
            <button
              type="button"
              className="file-viewer-icon-button"
              title={t("chat.askInCurrent")}
              aria-label={t("chat.askInCurrent")}
              onPointerDown={(event) => event.preventDefault()}
              onClick={addSelectedFileContext}
              style={{ width: "auto", height: 35, flex: "0 0 auto", gap: 5, padding: "0 10px", border: "none", fontSize: 12, fontWeight: 500 }}
            >
              <span aria-hidden="true" style={{ fontSize: 15 }}>@</span>
              <span>{t("chat.askInCurrent")}</span>
            </button>
            {onAskInNewChat && (
              <button
                type="button"
                className="file-viewer-icon-button"
                title={t("chat.askInNewChat")}
                aria-label={t("chat.askInNewChat")}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => setFileQuoteInputOpen(true)}
                style={{ width: "auto", height: 35, flex: "0 0 auto", gap: 5, padding: "0 10px", border: "none", fontSize: 12, fontWeight: 500 }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M6 3v12M18 9a9 9 0 0 1-9 9" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" />
                </svg>
                <span>{t("chat.askInNewChat")}</span>
              </button>
            )}
          </>}
        </div>,
        document.body,
      )}
    </div>
  );
}
