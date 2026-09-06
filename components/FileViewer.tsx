"use client";

import { memo, startTransition, useDeferredValue, useEffect, useState, useRef, useCallback, useMemo, type CSSProperties, type MouseEvent } from "react";
import {
  Prism as SyntaxHighlighter,
  createElement as renderSyntaxNode,
  type SyntaxHighlighterProps,
} from "react-syntax-highlighter";
import { vs } from "react-syntax-highlighter/dist/cjs/styles/prism";
import { vscDarkPlus } from "react-syntax-highlighter/dist/cjs/styles/prism";
import ReactMarkdown from "react-markdown";
import { useTheme } from "@/hooks/useTheme";
import {
  DOCX_PREVIEW_MAX_BYTES,
  getFileExt,
  isAudioPath,
  isDocumentPreviewPath,
  isImagePath,
  isVideoPath,
} from "@/lib/file-types";
import { encodeFilePathForApi, getFileDirectory, getFileName, getRelativeFilePath } from "@/lib/file-paths";
import { resolveLocalFileHref, shouldOpenLocalFileInApp } from "@/lib/file-links";
import { parseFrontmatter } from "@/lib/frontmatter";
import { markdownPreviewRehypePlugins, markdownPreviewRemarkPlugins, markdownUrlTransform, normalizeDisplayMath } from "@/lib/markdown";
import { CodeBlock, MermaidBlock } from "./MermaidBlock";
import { FrontmatterCard } from "./FrontmatterCard";
import { parseUnifiedPatch } from "@/lib/patch";
import type { GitFileDiffResponse } from "@/lib/git-types";
import type { FileVersion } from "@/lib/file-version";
import { useI18n } from "@/hooks/useI18n";
import {
  resolveInitialFileDisplayMode,
  type FileViewerDisplayMode as DisplayMode,
  type FileViewerState,
} from "@/lib/file-viewer-state";
import {
  getCachedTextFile,
  invalidateCachedTextFile,
  setCachedTextFile,
  textFileCacheKey,
  type CachedTextFileData,
} from "./file-content-cache";

export type { FileViewerState } from "@/lib/file-viewer-state";

interface Props {
  filePath: string;
  cwd?: string;
  sourceSessionId?: string | null;
  onOpenFile?: (filePath: string) => void;
  onMentionLines?: (relativePath: string, startLine: number, endLine: number) => void;
  /** Insert this file's relative path into the chat input (@ mention). */
  onAtMention?: (relativePath: string, isDir: boolean) => void;
  gitRefreshKey?: number;
  initialDisplayMode?: DisplayMode;
  initialState?: FileViewerState;
  onStateChange?: (state: FileViewerState) => void;
  watchEnabled?: boolean;
}

type FileData = CachedTextFileData;

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
  const encoded = encodeFilePathForApi(filePath);
  const searchParams = new URLSearchParams({ type });
  if (sourceSessionId) searchParams.set("sessionId", sourceSessionId);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) searchParams.set(key, String(value));
  }
  return `/api/files/${encoded}?${searchParams.toString()}`;
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

const SourceFileContent = memo(function SourceFileContent({
  content,
  language,
  wrapLines,
}: {
  content: string;
  language: string;
  wrapLines: boolean;
}) {
  const { isDark } = useTheme();
  const sourceLines = useMemo(() => content.split("\n"), [content]);
  if (sourceLines.length > SOURCE_HIGHLIGHT_MAX_LINES) {
    return (
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
        {sourceLines.map((line, lineIndex) => (
          <span
            className="file-source-line"
            data-line-number={lineIndex + 1}
            key={`source-line-${lineIndex}`}
            style={{ display: "flex", minWidth: "100%" }}
          >
            <span aria-hidden="true" style={FILE_LINE_NUMBER_STYLE}>{lineIndex + 1}</span>
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
        ))}
      </div>
    );
  }
  return (
    <SyntaxHighlighter
      className={wrapLines ? "file-source-view is-wrapped" : "file-source-view"}
      language={language === "text" ? "plaintext" : language}
      style={isDark ? vscDarkPlus : vs}
      showLineNumbers
      lineNumberStyle={{ ...FILE_LINE_NUMBER_STYLE }}
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
      {content}
    </SyntaxHighlighter>
  );
});

const MarkdownFilePreview = memo(function MarkdownFilePreview({
  content,
  filePath,
  cwd,
  sourceSessionId,
  onOpenFile,
}: {
  content: string;
  filePath: string;
  cwd?: string;
  sourceSessionId?: string | null;
  onOpenFile?: (filePath: string) => void;
}) {
  const markdownDirectory = getFileDirectory(filePath);
  const markdownPreview = useMemo(() => normalizeDisplayMath(content), [content]);
  const frontmatter = useMemo(() => parseFrontmatter(content), [content]);

  return (
    <div className="markdown-body markdown-file-preview" style={{ padding: "24px 32px" }}>
      {frontmatter?.data && <FrontmatterCard data={frontmatter.data} />}
      <ReactMarkdown
        remarkPlugins={markdownPreviewRemarkPlugins}
        rehypePlugins={markdownPreviewRehypePlugins}
        urlTransform={onOpenFile ? markdownUrlTransform : undefined}
        components={{
          code({ className, children, ...props }) {
            const lang = className?.replace("language-", "").toLowerCase() ?? "";
            const raw = String(children);
            const isBlock = className?.includes("language-") || raw.includes("\n");
            if (isBlock) {
              if (lang === "mermaid") {
                return <MermaidBlock code={raw.replace(/\n$/, "")} defaultPreview />;
              }
              return <CodeBlock code={raw.replace(/\n$/, "")} lang={lang} />;
            }
            return <code className={className} {...props}>{children}</code>;
          },
          pre({ children }) {
            return <>{children}</>;
          },
          a({ href, children, ...props }) {
            delete props.node;
            const linkedFile = onOpenFile
              ? resolveLocalFileHref(href, markdownDirectory, cwd ?? markdownDirectory)
              : null;
            if (!linkedFile || !onOpenFile) return <a href={href} {...props}>{children}</a>;

            const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
              if (!shouldOpenLocalFileInApp(event)) return;
              event.preventDefault();
              onOpenFile(linkedFile);
            };
            return <a href={href} {...props} onClick={handleClick}>{children}</a>;
          },
          img({ src, alt, ...props }) {
            delete props.node;
            const imagePath = typeof src === "string"
              ? resolveLocalFileHref(src, markdownDirectory, cwd ?? markdownDirectory)
              : null;
            const imageSrc = imagePath
              ? getFileApiUrl(imagePath, "read", sourceSessionId)
              : src;
            // eslint-disable-next-line @next/next/no-img-element
            return <img src={imageSrc} alt={alt ?? ""} loading="lazy" {...props} />;
          },
        }}
      >
        {markdownPreview}
      </ReactMarkdown>
    </div>
  );
});

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

function useWatchedFileVersion(
  filePath: string,
  sourceSessionId: string | null | undefined,
  watchEnabled: boolean,
): { version: FileVersion | null; watching: boolean; watchError: string | null } {
  const [version, setVersion] = useState<FileVersion | null>(null);
  const [watching, setWatching] = useState(false);
  const [watchError, setWatchError] = useState<string | null>(null);
  const versionRef = useRef<FileVersion | null>(null);

  useEffect(() => {
    versionRef.current = null;
    setVersion(null);
    setWatching(false);
    setWatchError(null);
  }, [filePath, sourceSessionId]);

  useEffect(() => {
    let active = true;
    let connected = false;
    let fallbackStarted = false;
    let changeTimer: ReturnType<typeof setTimeout> | null = null;
    const controller = new AbortController();

    const applyVersion = (nextVersion: FileVersion) => {
      if (!active || versionRef.current?.etag === nextVersion.etag) return;
      versionRef.current = nextVersion;
      setVersion(nextVersion);
      setWatchError(nextVersion.exists ? null : "Not found");
    };
    const parseVersion = (event: Event): FileVersion | null => {
      try {
        return (JSON.parse((event as MessageEvent).data) as { version?: FileVersion }).version ?? null;
      } catch {
        return null;
      }
    };
    const loadMeta = async () => {
      if (fallbackStarted || versionRef.current) return;
      fallbackStarted = true;
      try {
        const response = await fetch(getFileApiUrl(filePath, "meta", sourceSessionId), {
          signal: controller.signal,
        });
        const data = await response.json() as { version?: FileVersion; error?: string };
        if (!active) return;
        if (!response.ok || !data.version) {
          setWatchError(data.error ?? `HTTP ${response.status}`);
          return;
        }
        applyVersion(data.version);
      } catch (error) {
        if (active && (error as { name?: string }).name !== "AbortError") {
          setWatchError(String(error));
        }
      }
    };

    if (!watchEnabled) {
      void loadMeta();
      return () => {
        active = false;
        controller.abort();
      };
    }

    const es = new EventSource(getFileApiUrl(filePath, "watch", sourceSessionId));
    es.addEventListener("connected", (event) => {
      connected = true;
      setWatching(true);
      const nextVersion = parseVersion(event);
      if (nextVersion) applyVersion(nextVersion);
      else void loadMeta();
    });
    es.addEventListener("change", (event) => {
      const nextVersion = parseVersion(event);
      if (!nextVersion || nextVersion.etag === versionRef.current?.etag) return;
      if (changeTimer) clearTimeout(changeTimer);
      changeTimer = setTimeout(() => applyVersion(nextVersion), 80);
    });
    const markDisconnected = () => {
      setWatching(false);
      if (!connected) void loadMeta();
    };
    es.addEventListener("error", markDisconnected);

    return () => {
      active = false;
      if (changeTimer) clearTimeout(changeTimer);
      controller.abort();
      es.close();
    };
  }, [filePath, sourceSessionId, watchEnabled]);

  return { version, watching, watchError };
}

function ImageViewer({ filePath, cwd, sourceSessionId, watchEnabled = true }: Props) {
  const { t } = useI18n();
  const { version, watching, watchError } = useWatchedFileVersion(
    filePath,
    sourceSessionId,
    watchEnabled,
  );
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);

  const ext = getFileName(filePath).toLowerCase().split(".").pop() ?? "";

  useEffect(() => {
    setNaturalSize(null);
    setRenderError(null);
  }, [filePath, sourceSessionId, version?.etag]);

  const src = version?.exists
    ? getFileApiUrl(filePath, "read", sourceSessionId, { v: version.etag })
    : null;
  const error = renderError ?? watchError;
  const formatSizeStr = version?.exists ? formatSize(version.size) : null;

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
        ) : src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={filePath}
            onLoad={(e) => {
              const img = e.currentTarget;
              setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
            }}
            onError={() => setRenderError("Failed to load image")}
            style={{
              maxWidth: "100%",
              maxHeight: "100%",
              objectFit: "contain",
              boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
            }}
          />
        ) : (
          <div style={{ color: "var(--text-muted)", fontSize: 13 }}>{t("i18n.loading")}</div>
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
  const { version, watching, watchError } = useWatchedFileVersion(
    filePath,
    sourceSessionId,
    watchEnabled,
  );
  const [duration, setDuration] = useState<number | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);

  const ext = getFileName(filePath).toLowerCase().split(".").pop() ?? "";

  useEffect(() => {
    setDuration(null);
    setRenderError(null);
  }, [filePath, sourceSessionId, version?.etag]);

  const src = version?.exists
    ? getFileApiUrl(filePath, "read", sourceSessionId, { v: version.etag })
    : null;
  const error = renderError ?? watchError;
  const size = version?.exists ? version.size : null;

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
          {src ? (
            <audio
              key={src}
              controls
              preload="metadata"
              src={src}
              onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
              onError={() => setRenderError("Failed to load audio")}
              style={{ width: "100%" }}
            />
          ) : !error ? (
            <div style={{ color: "var(--text-muted)", fontSize: 13, textAlign: "center" }}>
              {t("i18n.loading")}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function VideoViewer({ filePath, cwd, sourceSessionId, watchEnabled = true }: Props) {
  const { t } = useI18n();
  const { version, watching, watchError } = useWatchedFileVersion(
    filePath,
    sourceSessionId,
    watchEnabled,
  );
  const [duration, setDuration] = useState<number | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const ext = getFileName(filePath).toLowerCase().split(".").pop() ?? "";

  useEffect(() => {
    setDuration(null);
    setRenderError(null);
  }, [filePath, sourceSessionId, version?.etag]);

  const src = version?.exists
    ? getFileApiUrl(filePath, "read", sourceSessionId, { v: version.etag })
    : null;
  const error = renderError ?? watchError;
  const size = version?.exists ? version.size : null;

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
          {src ? (
            <video
              key={src}
              controls
              playsInline
              preload="metadata"
              src={src}
              onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
              onError={() => setRenderError("Failed to load video")}
              style={{ maxWidth: "100%", maxHeight: "100%" }}
            />
          ) : !error ? (
            <div style={{ color: "var(--text-muted)", fontSize: 13 }}>{t("i18n.loading")}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function DocumentViewer({ filePath, cwd, sourceSessionId, watchEnabled = true }: Props) {
  const { t } = useI18n();
  const { version, watching, watchError } = useWatchedFileVersion(
    filePath,
    sourceSessionId,
    watchEnabled,
  );
  const ext = getFileExt(filePath);
  const isPdf = ext === "pdf";
  const size = version?.exists ? version.size : null;
  const tooLarge = !isPdf && size !== null && size > DOCX_PREVIEW_MAX_BYTES;
  const error = tooLarge ? "DOCX too large for preview (>10MB)" : watchError;
  const previewUrl = version?.exists && !tooLarge
    ? isPdf
      ? getFileApiUrl(filePath, "read", sourceSessionId, { v: version.etag })
      : getFileApiUrl(filePath, "preview", sourceSessionId, { v: version.etag })
    : null;

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
        ) : previewUrl ? (
          <iframe
            key={previewUrl}
            src={previewUrl}
            sandbox={isPdf ? undefined : "allow-same-origin"}
            title={t("i18n.previewFile", { file: getFileName(filePath) })}
            style={{ width: "100%", height: "100%", border: "none", background: isPdf ? "var(--bg)" : "#eef1f5" }}
          />
        ) : (
          <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 13 }}>
            {t("i18n.loading")}
          </div>
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
  onMentionLines,
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
      onMentionLines={onMentionLines}
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
  onMentionLines,
  onAtMention,
  gitRefreshKey,
  initialDisplayMode,
  initialState,
  onStateChange,
  watchEnabled = true,
}: Props) {
  const { t } = useI18n();
  const [data, setData] = useState<FileData | null>(null);
  const [gitDiff, setGitDiff] = useState<GitFileDiffResponse | null>(null);
  const [gitDiffAvailable, setGitDiffAvailable] = useState(false);
  const [gitDiffLoading, setGitDiffLoading] = useState(false);
  const [gitDiffResolved, setGitDiffResolved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fileExtension = getFileExt(filePath);
  const extensionDefaultDisplayMode: DisplayMode | undefined =
    initialState === undefined
    && initialDisplayMode === undefined
    && ["md", "mdx", "html", "htm"].includes(fileExtension)
      ? "preview"
      : initialDisplayMode;
  const requestedInitialDisplayMode = resolveInitialFileDisplayMode(
    initialState,
    extensionDefaultDisplayMode,
  );
  const initialWrapLines = initialState?.wrapLines ?? false;
  const initialScrollTop = initialState?.scrollTop ?? 0;
  const initialScrollLeft = initialState?.scrollLeft ?? 0;
  const [displayMode, setDisplayMode] = useState<DisplayMode>(requestedInitialDisplayMode);
  const [wrapLines, setWrapLines] = useState(initialWrapLines);
  const [watching, setWatching] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const contentRequestRef = useRef(0);
  const gitDiffRequestRef = useRef(0);
  const contentAbortRef = useRef<AbortController | null>(null);
  const gitDiffAbortRef = useRef<AbortController | null>(null);
  const dataRef = useRef<FileData | null>(null);
  const gitLoadKeyRef = useRef<string | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const autoDiffAppliedRef = useRef(false);
  const defaultPreviewEligibleRef = useRef(false);
  const scrollRestorePendingRef = useRef(true);
  const viewerStateRef = useRef<FileViewerState>({
    displayMode: requestedInitialDisplayMode,
    wrapLines: initialWrapLines,
    scrollTop: initialScrollTop,
    scrollLeft: initialScrollLeft,
  });
  const onStateChangeRef = useRef(onStateChange);
  const [selectedLineRange, setSelectedLineRange] = useState<SelectedLineRange | null>(null);
  const cacheKey = useMemo(
    () => textFileCacheKey(filePath, sourceSessionId),
    [filePath, sourceSessionId],
  );

  onStateChangeRef.current = onStateChange;

  const updateDisplayMode = useCallback((nextDisplayMode: DisplayMode) => {
    viewerStateRef.current.displayMode = nextDisplayMode;
    setDisplayMode(nextDisplayMode);
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

  const fetchContent = useCallback(async (targetPath: string) => {
    const requestId = ++contentRequestRef.current;
    contentAbortRef.current?.abort();
    const controller = new AbortController();
    contentAbortRef.current = controller;
    const current = dataRef.current;

    try {
      const response = await fetch(getFileApiUrl(targetPath, "read", sourceSessionId), {
        signal: controller.signal,
        headers: current ? { "If-None-Match": current.version.etag } : undefined,
      });
      if (requestId !== contentRequestRef.current) return null;
      if (response.status === 304 && current) {
        setError(null);
        setData(current);
        return current;
      }
      const next = await response.json() as FileData & { error?: string };
      if (next.error) {
        setError(next.error);
        return null;
      }
      setError(null);
      dataRef.current = next;
      setCachedTextFile(cacheKey, next);
      setData(next);
      return next;
    } catch (nextError) {
      if (
        requestId !== contentRequestRef.current
        || (nextError as { name?: string }).name === "AbortError"
      ) return null;
      setError(String(nextError));
      return null;
    } finally {
      if (contentAbortRef.current === controller) contentAbortRef.current = null;
    }
  }, [cacheKey, sourceSessionId]);

  const fetchGitDiff = useCallback(async (targetPath: string, probeOnly = false) => {
    const requestId = ++gitDiffRequestRef.current;
    gitDiffAbortRef.current?.abort();
    const controller = new AbortController();
    gitDiffAbortRef.current = controller;
    if (!probeOnly) setGitDiffLoading(true);

    const applyProbeResult = (available: boolean) => {
      startTransition(() => {
        setGitDiffAvailable(available);
        setGitDiff(null);
      });
    };

    if (!cwd) {
      if (probeOnly) {
        applyProbeResult(false);
      } else {
        setGitDiff(null);
        setGitDiffAvailable(false);
        setGitDiffLoading(false);
        setGitDiffResolved(true);
      }
      if (gitDiffAbortRef.current === controller) gitDiffAbortRef.current = null;
      return;
    }

    try {
      const params = new URLSearchParams({ cwd, path: targetPath });
      if (probeOnly) params.set("probe", "1");
      const response = await fetch(`/api/git/diff?${params.toString()}`, {
        signal: controller.signal,
      });
      const next = await response.json() as GitFileDiffResponse & { error?: string };
      if (requestId !== gitDiffRequestRef.current) return;
      const available = response.ok && next.supported;
      if (probeOnly) {
        applyProbeResult(available);
      } else {
        const completeDiff = available && typeof next.patch === "string" ? next : null;
        setGitDiffAvailable(completeDiff !== null);
        setGitDiff(completeDiff);
      }
    } catch (nextError) {
      if (
        requestId === gitDiffRequestRef.current
        && (nextError as { name?: string }).name !== "AbortError"
      ) {
        if (probeOnly) {
          applyProbeResult(false);
        } else {
          setGitDiff(null);
          setGitDiffAvailable(false);
        }
      }
    } finally {
      if (gitDiffAbortRef.current === controller) gitDiffAbortRef.current = null;
      if (requestId === gitDiffRequestRef.current && !probeOnly) {
        setGitDiffLoading(false);
        setGitDiffResolved(true);
      }
    }
  }, [cwd]);

  // Reset only when file identity changes. The watcher effect owns the first
  // snapshot so Strict Effects and connected cannot race two full reads.
  useEffect(() => {
    contentAbortRef.current?.abort();
    contentRequestRef.current += 1;
    dataRef.current = getCachedTextFile(cacheKey) ?? null;
    setLoading(true);
    setError(null);
    // Cached content remains provisional until the watcher or conditional
    // read has re-authorized the request and confirmed its version.
    setData(null);
    setGitDiff(null);
    setGitDiffAvailable(false);
    setGitDiffResolved(false);
    setWatching(false);
  }, [cacheKey, filePath, sourceSessionId]);

  useEffect(() => {
    setWatching(false);

    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    let active = true;
    let connected = false;
    let fallbackStarted = false;
    let changeTimer: ReturnType<typeof setTimeout> | null = null;

    const loadSnapshot = (nextVersion?: FileVersion, refreshDiff = false) => {
      if (nextVersion && dataRef.current?.version.etag === nextVersion.etag) {
        setData(dataRef.current);
        setLoading(false);
        return;
      }
      void fetchContent(filePath).finally(() => {
        if (active) setLoading(false);
      });
      if (refreshDiff) {
        const wantsPatch = viewerStateRef.current.displayMode === "diff"
          || requestedInitialDisplayMode === "diff";
        void fetchGitDiff(filePath, !wantsPatch);
      }
    };

    if (!watchEnabled) {
      // A conditional read re-authorizes a provisional cache entry before it
      // can become visible while live watching is paused.
      loadSnapshot();
      return () => {
        active = false;
      };
    }

    const eventVersion = (event: Event): FileVersion | undefined => {
      try {
        return (JSON.parse((event as MessageEvent).data) as { version?: FileVersion }).version;
      } catch {
        return undefined;
      }
    };
    const es = new EventSource(getFileApiUrl(filePath, "watch", sourceSessionId));
    esRef.current = es;

    es.addEventListener("connected", (event) => {
      connected = true;
      setWatching(true);
      loadSnapshot(eventVersion(event));
    });

    es.addEventListener("change", (event) => {
      const nextVersion = eventVersion(event);
      if (nextVersion && dataRef.current?.version.etag === nextVersion.etag) return;
      invalidateCachedTextFile(cacheKey);
      if (changeTimer) clearTimeout(changeTimer);
      changeTimer = setTimeout(() => loadSnapshot(nextVersion, true), 80);
    });

    const markDisconnected = () => {
      setWatching(false);
      if (!active || connected || fallbackStarted) return;
      fallbackStarted = true;
      loadSnapshot();
    };
    es.addEventListener("error", markDisconnected);

    return () => {
      active = false;
      if (changeTimer) clearTimeout(changeTimer);
      es.close();
      if (esRef.current === es) esRef.current = null;
    };
  }, [cacheKey, filePath, fetchContent, fetchGitDiff, requestedInitialDisplayMode, sourceSessionId, watchEnabled]);

  useEffect(() => {
    const wantsPatch = displayMode === "diff" || requestedInitialDisplayMode === "diff";
    const loadKind = wantsPatch ? "patch" : "probe";
    const loadKey = `${filePath}\0${cwd ?? ""}\0${gitRefreshKey ?? 0}\0${loadKind}`;
    if (gitLoadKeyRef.current === loadKey) return;
    gitLoadKeyRef.current = loadKey;
    void fetchGitDiff(filePath, !wantsPatch);
  }, [cwd, displayMode, fetchGitDiff, filePath, gitRefreshKey, requestedInitialDisplayMode]);

  useEffect(() => {
    // HTML gets the same rendered-first treatment as markdown: a generated page
    // is usually more useful viewed than read as source. Both have a preview
    // mode already; the source tab stays one click away. A restored choice or
    // explicit mode hint always wins over this default.
    if (
      defaultPreviewEligibleRef.current
      && (data?.language === "markdown" || data?.language === "html")
    ) {
      defaultPreviewEligibleRef.current = false;
      updateDisplayMode("preview");
    }
  }, [data?.language, updateDisplayMode]);

  const hasGitDiff = gitDiff?.supported === true && typeof gitDiff.patch === "string";
  const canShowGitDiff = gitDiffAvailable || hasGitDiff;
  const isDeletedDiff = hasGitDiff && gitDiff.status === "deleted";

  useEffect(() => {
    if (gitDiffResolved && !canShowGitDiff && displayMode === "diff") updateDisplayMode("source");
  }, [canShowGitDiff, displayMode, gitDiffResolved, updateDisplayMode]);

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
  const hasPreview = isHtml || isMarkdown;
  const effectiveDisplayMode = isDeletedDiff ? "diff" : displayMode;

  useEffect(() => {
    const updateSelectedLineRange = () => {
      const root = contentRef.current;
      setSelectedLineRange((current) => {
        const next = onMentionLines && displayMode === "source" && root
          ? getSelectedSourceLineRange(root, window.getSelection())
          : null;
        // Skip no-op updates: selectionchange fires continuously while dragging,
        // and a fresh-but-equal range object would re-render the whole viewer.
        if (current === null && next === null) return current;
        if (current && next && current.startLine === next.startLine && current.endLine === next.endLine) return current;
        return next;
      });
    };

    updateSelectedLineRange();
    if (!onMentionLines || displayMode !== "source") return;

    document.addEventListener("selectionchange", updateSelectedLineRange);
    return () => document.removeEventListener("selectionchange", updateSelectedLineRange);
  }, [data?.content, displayMode, onMentionLines]);

  const mentionLineRange = useCallback((lineRange: SelectedLineRange | null) => {
    if (!onMentionLines || !lineRange) return;
    onMentionLines(
      getRelativeFilePath(filePath, cwd),
      lineRange.startLine,
      lineRange.endLine,
    );
  }, [cwd, filePath, onMentionLines]);

  useEffect(() => {
    if (!onMentionLines || displayMode !== "source") return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.key.toLowerCase() !== "i" || (!event.metaKey && !event.ctrlKey) || event.altKey || event.shiftKey) return;

      const target = event.target;
      if (target instanceof Element && target.closest("input, textarea, [contenteditable='true']")) return;

      const root = contentRef.current;
      const lineRange = root ? getSelectedSourceLineRange(root, window.getSelection()) : null;
      if (!lineRange) return;

      event.preventDefault();
      mentionLineRange(lineRange);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [displayMode, mentionLineRange, onMentionLines]);

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

  const deferredSourceContent = useDeferredValue(data?.content ?? "");

  if (loading || (requestedInitialDisplayMode === "diff" && gitDiffLoading && !data)) {
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
        ...(canShowGitDiff ? ["diff" as const] : []),
      ];
  const metadata = isDeletedDiff
    ? t("files.deleted")
    : `${language} · ${lines.length} lines · ${formatSize(data!.size)}`;

  return (
    <div className="file-viewer-shell" style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
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
          {displayModes.length > 1 && (
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
            {(onAtMention || onMentionLines) && (
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
            {effectiveDisplayMode === "source" && (
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
          </div>

          {!isDeletedDiff && <DownloadLink filePath={filePath} sourceSessionId={sourceSessionId} />}
        </div>
      </div>

      {/* Content area */}
      <div
        ref={contentRef}
        className="file-viewer-content"
        onScroll={(event) => {
          viewerStateRef.current.scrollTop = event.currentTarget.scrollTop;
          viewerStateRef.current.scrollLeft = event.currentTarget.scrollLeft;
        }}
        style={{ flex: 1, overflow: "auto", background: "var(--bg)" }}
      >
        {effectiveDisplayMode === "diff" && hasGitDiff ? (
          <DiffView patch={gitDiff.patch!} />
        ) : isHtml && effectiveDisplayMode === "preview" ? (
          <iframe
            srcDoc={content}
            sandbox="allow-scripts"
            style={{ width: "100%", height: "100%", border: "none", background: "var(--bg)" }}
             title={t("i18n.htmlPreview")}
          />
        ) : isMarkdown && effectiveDisplayMode === "preview" ? (
          <MarkdownFilePreview
            content={content}
            filePath={filePath}
            cwd={cwd}
            sourceSessionId={sourceSessionId}
            onOpenFile={onOpenFile}
          />
        ) : (
          <SourceFileContent
            content={deferredSourceContent}
            language={language}
            wrapLines={wrapLines}
          />
        )}
      </div>
    </div>
  );
}
