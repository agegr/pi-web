"use client";

import { useEffect, useState, useRef, useCallback, useMemo, type CSSProperties, type MouseEvent } from "react";
import dynamic from "next/dynamic";
import ReactMarkdown from "react-markdown";
import { useTheme } from "@/hooks/useTheme";
import {
  DOCX_PREVIEW_MAX_BYTES,
  getFileExt,
  isAudioPath,
  isDocumentPreviewPath,
  isImagePath,
  isVideoPath,
  type TextFileReadOnlyReason,
} from "@/lib/file-types";
import { encodeFilePathForApi, getFileDirectory, getFileName, getRelativeFilePath } from "@/lib/file-paths";
import { parsePdfPageFragment, resolveLocalFileHref, shouldOpenLocalFileInApp } from "@/lib/file-links";
import { parseFrontmatter } from "@/lib/frontmatter";
import { isExternalMarkdownHref, markdownAppUrlTransform, markdownPreviewRehypePlugins, markdownPreviewRemarkPlugins, markdownUrlTransform, normalizeDisplayMath } from "@/lib/markdown";
import { CodeBlock, MermaidBlock } from "./MermaidBlock";
import { FrontmatterCard } from "./FrontmatterCard";
import { parseUnifiedPatch } from "@/lib/patch";
import type { GitFileDiffResponse } from "@/lib/git-types";
import { useI18n } from "@/hooks/useI18n";
import {
  resolveInitialFileDisplayMode,
  type FileViewerDisplayMode as DisplayMode,
  type FileViewerState,
} from "@/lib/file-viewer-state";

import { getFileEditDraft, setFileEditDraft } from "@/lib/file-edit-drafts";
import type { CodeEditorHandle, SelectedLineRange } from "./CodeEditor";

export type { FileViewerState } from "@/lib/file-viewer-state";

// The editor is its own chunk: only a text file's source view loads it.
const CodeEditor = dynamic(() => import("./CodeEditor"), { ssr: false });

interface Props {
  filePath: string;
  cwd?: string;
  sourceSessionId?: string | null;
  onOpenFile?: (filePath: string, page?: number) => void;
  onMentionLines?: (relativePath: string, startLine: number, endLine: number) => void;
  /** Insert this file's relative path into the chat input (@ mention). */
  onAtMention?: (relativePath: string, isDir: boolean) => void;
  gitRefreshKey?: number;
  initialDisplayMode?: DisplayMode;
  /** PDF page to open on first render (`#page=N` from a markdown link). */
  initialPage?: number;
  initialState?: FileViewerState;
  onStateChange?: (state: FileViewerState) => void;
  watchEnabled?: boolean;
  /** A save from the editor wrote the file (the explorer refreshes its Git status). */
  onFileSaved?: () => void;
}

interface FileData {
  content: string;
  language: string;
  size: number;
  nextOffset: number;
  truncated: boolean;
  /** From `?type=read&edit=1`: hash of the bytes, for the save's conflict check. */
  hash?: string;
  eol?: "\n" | "\r\n";
  editable?: boolean;
  readOnlyReason?: TextFileReadOnlyReason;
}

/** What the editor knows about the version on disk when it diverged from the buffer. */
type DiskConflict =
  | { kind: "changed" | "save"; disk: FileData }
  | { kind: "deleted" };

const READ_ONLY_REASON_KEYS: Record<TextFileReadOnlyReason, string> = {
  "too-large": "files.readOnlyTooLarge",
  binary: "files.readOnlyBinary",
  encoding: "files.readOnlyEncoding",
  "line-endings": "files.readOnlyLineEndings",
  "outside-roots": "files.readOnlyOutsideRoots",
  symlink: "files.readOnlySymlink",
  permission: "files.readOnlyPermission",
};
const DISPLAY_MODE_LABELS: Record<DisplayMode, string> = {
  source: "Source",
  preview: "Preview",
  diff: "Diff",
};

const FILE_CODE_STYLE: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontWeight: "var(--font-mono-weight)",
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
  fontWeight: "var(--font-mono-weight)",
  fontSize: 11,
  fontStyle: "normal",
  fontVariantNumeric: "tabular-nums",
  lineHeight: "20.8px",
  userSelect: "none",
  flexShrink: 0,
  verticalAlign: "top",
};

function MentionIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8" />
    </svg>
  );
}

function getFileApiUrl(
  filePath: string,
  type: "read" | "download" | "meta" | "preview" | "watch" | "save",
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

function DocumentViewer({ filePath, cwd, sourceSessionId, initialPage, watchEnabled = true }: Props) {
  const { t } = useI18n();
  const [watching, setWatching] = useState(false);
  const [bust, setBust] = useState(0);
  const [size, setSize] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const syncRequestRef = useRef(0);

  const ext = getFileExt(filePath);
  const isPdf = ext === "pdf";
  const pageFragment = isPdf && initialPage && initialPage > 0 ? `#page=${initialPage}` : "";
  const previewUrl = isPdf
    ? `${getFileApiUrl(filePath, "read", sourceSessionId, bust ? { v: bust } : undefined)}${pageFragment}`
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
  onMentionLines,
  onAtMention,
  gitRefreshKey,
  initialDisplayMode,
  initialState,
  initialPage,
  onStateChange,
  watchEnabled = true,
  onFileSaved,
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
    return <DocumentViewer filePath={filePath} cwd={cwd} sourceSessionId={sourceSessionId} initialPage={initialPage} watchEnabled={watchEnabled} />;
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
      onFileSaved={onFileSaved}
    />
  );
}

function EditIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
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
  onFileSaved,
}: Props) {
  const { isDark } = useTheme();
  const { t } = useI18n();
  const [data, setData] = useState<FileData | null>(null);
  const [gitDiff, setGitDiff] = useState<GitFileDiffResponse | null>(null);
  const [gitDiffLoading, setGitDiffLoading] = useState(false);
  const [gitDiffResolved, setGitDiffResolved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
  const contentRef = useRef<HTMLDivElement | null>(null);
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

  // Editing. The buffer lives in CodeMirror; `data` is the version on disk it
  // is compared against, and `baseHashRef` that version's hash, which a save
  // must still find on disk.
  const editorHandleRef = useRef<CodeEditorHandle | null>(null);
  const [editorSeed, setEditorSeed] = useState<{ value: string; saved: string } | null>(null);
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [diskConflict, setDiskConflict] = useState<DiskConflict | null>(null);
  const [comparing, setComparing] = useState<string | null>(null);
  const [previewDraft, setPreviewDraft] = useState<string | null>(null);
  const dirtyRef = useRef(false);
  const baseHashRef = useRef<string | null>(null);
  const loadedRef = useRef(false);
  const savingRef = useRef(false);
  const pendingSyncRef = useRef(false);

  onStateChangeRef.current = onStateChange;

  const updateDisplayMode = useCallback((nextDisplayMode: DisplayMode) => {
    viewerStateRef.current.displayMode = nextDisplayMode;
    setDisplayMode(nextDisplayMode);
  }, []);

  // Previews render the unsaved buffer, not the file on disk.
  const selectDisplayMode = useCallback((nextDisplayMode: DisplayMode) => {
    setPreviewDraft(dirtyRef.current ? editorHandleRef.current?.getValue() ?? null : null);
    updateDisplayMode(nextDisplayMode);
  }, [updateDisplayMode]);

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

  /** Mirror the editor's unsaved state into the draft store (tab marker, close prompt). */
  const recordDraft = useCallback(() => {
    if (dirtyRef.current && baseHashRef.current) {
      setFileEditDraft(filePath, { content: null, baseHash: baseHashRef.current });
    } else {
      setFileEditDraft(filePath, null);
    }
  }, [filePath]);

  const handleDirtyChange = useCallback((next: boolean) => {
    dirtyRef.current = next;
    setDirty(next);
    recordDraft();
  }, [recordDraft]);

  // Unmounting with unsaved changes parks them for the next viewer of this
  // file, unless closing the tab discarded them (and with them the entry).
  const handleEditorDispose = useCallback((text: string) => {
    if (dirtyRef.current && baseHashRef.current && getFileEditDraft(filePath)) {
      setFileEditDraft(filePath, { content: text, baseHash: baseHashRef.current });
    }
  }, [filePath]);

  // Take a full read of the file: on the first load (restoring a parked
  // draft), and after every change on disk. An unchanged hash is our own save
  // or a touch; a change under unsaved edits becomes a conflict to resolve.
  const applyDiskVersion = useCallback((next: FileData) => {
    if (!loadedRef.current) {
      loadedRef.current = true;
      const draft = getFileEditDraft(filePath);
      if (draft?.content != null && next.editable && next.hash) {
        baseHashRef.current = draft.baseHash;
        setEditorSeed({ value: draft.content, saved: next.content });
        setEditing(true);
        if (next.hash !== draft.baseHash) setDiskConflict({ kind: "changed", disk: next });
        setFileEditDraft(filePath, { content: null, baseHash: draft.baseHash });
      } else {
        if (draft) setFileEditDraft(filePath, null);
        baseHashRef.current = next.hash ?? null;
        setEditorSeed({ value: next.content, saved: next.content });
      }
      setData(next);
      return;
    }

    if (next.hash && next.hash === baseHashRef.current) return;
    if (dirtyRef.current) {
      setDiskConflict({ kind: "changed", disk: next });
      return;
    }
    baseHashRef.current = next.hash ?? null;
    setDiskConflict(null);
    setEditorSeed({ value: next.content, saved: next.content });
    setData(next);
  }, [filePath]);

  const fetchContent = useCallback((filePath: string, offset = 0) => {
    const requestId = ++contentRequestRef.current;
    return fetch(getFileApiUrl(filePath, "read", sourceSessionId, offset ? { offset } : { edit: 1 }))
      .then(async (r) => ({ status: r.status, body: await r.json() as FileData & { error?: string } }))
      .then(({ status, body: d }) => {
        if (requestId !== contentRequestRef.current) return null;
        if (d.error) {
          // Keep unsaved edits on screen when their file disappears.
          if (!offset && status === 404 && dirtyRef.current) {
            setDiskConflict({ kind: "deleted" });
            return null;
          }
          setError(d.error);
          return null;
        }
        setError(null);
        if (offset) {
          setData((current) => current
            ? { ...current, content: current.content + d.content, nextOffset: d.nextOffset, truncated: d.truncated }
            : d);
        } else {
          applyDiskVersion(d);
        }
        return d;
      })
      .catch((e) => {
        if (requestId !== contentRequestRef.current) return null;
        setError(String(e));
        return null;
      });
  }, [applyDiskVersion, sourceSessionId]);

  const fetchDiskVersion = useCallback(async (): Promise<FileData | null> => {
    try {
      const response = await fetch(getFileApiUrl(filePath, "read", sourceSessionId, { edit: 1 }));
      const next = await response.json() as FileData & { error?: string };
      return response.ok && !next.error ? next : null;
    } catch {
      return null;
    }
  }, [filePath, sourceSessionId]);

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

  // A save's own change event would look like someone else's edit while the
  // response is still on its way: hold synchronization until it lands.
  const synchronize = useCallback(() => {
    if (savingRef.current) {
      pendingSyncRef.current = true;
      return;
    }
    void fetchContent(filePath);
    void fetchGitDiff(filePath);
  }, [fetchContent, fetchGitDiff, filePath]);

  // Reset and load the file itself when its identity changes. Live watching is
  // managed separately so pausing it never clears the displayed content.
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setData(null);
    setGitDiff(null);
    setGitDiffResolved(false);
    setWatching(false);

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
  }, [filePath, synchronize, sourceSessionId, watchEnabled]);

  useEffect(() => {
    void fetchGitDiff(filePath);
  }, [fetchGitDiff, filePath, gitRefreshKey]);

  // A new version on disk (reload, Load more) replaces a clean buffer.
  useEffect(() => {
    const handle = editorHandleRef.current;
    if (!handle || data === null || dirtyRef.current) return;
    handle.setValue(data.content);
    handle.markSaved(data.content);
  }, [data]);

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
  // Unsaved edits of a file deleted on disk stay in the editor, not a diff.
  const isDeletedDiff = hasGitDiff && gitDiff.status === "deleted" && !dirty;

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

  const previewSource = previewDraft ?? data?.content ?? "";

  const markdownPreview = useMemo(
    () => (data?.language === "markdown" ? normalizeDisplayMath(previewSource) : ""),
    [data?.language, previewSource],
  );

  const frontmatter = useMemo(
    () => (data?.language === "markdown" ? parseFrontmatter(previewSource) : null),
    [data?.language, previewSource],
  );

  const viewerContent = data?.content ?? "";
  const lineCount = useMemo(() => viewerContent.split("\n").length, [viewerContent]);
  const language = data?.language ?? "text";
  const isHtml = language === "html";
  const isMarkdown = language === "markdown";
  const hasPreview = !data?.truncated && (isHtml || isMarkdown);
  const effectiveDisplayMode = isDeletedDiff ? "diff" : displayMode;
  const showDiff = effectiveDisplayMode === "diff" && hasGitDiff;
  const showHtmlPreview = !showDiff && isHtml && effectiveDisplayMode === "preview";
  const showMarkdownPreview = !showDiff && isMarkdown && effectiveDisplayMode === "preview";
  const showSource = !showDiff && !showHtmlPreview && !showMarkdownPreview;
  const canEdit = data?.editable === true && !isDeletedDiff;
  const activeLineRange = showSource ? selectedLineRange : null;

  const mentionLineRange = useCallback((lineRange: SelectedLineRange | null) => {
    if (!onMentionLines || !lineRange) return;
    onMentionLines(
      getRelativeFilePath(filePath, cwd),
      lineRange.startLine,
      lineRange.endLine,
    );
  }, [cwd, filePath, onMentionLines]);

  const save = useCallback(async () => {
    const handle = editorHandleRef.current;
    const baseHash = baseHashRef.current;
    if (!handle || savingRef.current || !dirtyRef.current || !baseHash) return;
    const content = handle.getValue();
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    // A read started before the save would report the old version.
    contentRequestRef.current++;
    try {
      const response = await fetch(getFileApiUrl(filePath, "save"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, baseHash }),
      });
      const result = await response.json().catch(() => ({})) as {
        error?: string;
        hash?: string;
        size?: number;
      };
      if (response.status === 409) {
        const disk = await fetchDiskVersion();
        if (disk) setDiskConflict({ kind: "save", disk });
        else setSaveError(result.error ?? t("files.saveConflict"));
        return;
      }
      if (response.status === 404) {
        setDiskConflict({ kind: "deleted" });
        return;
      }
      if (!response.ok || !result.hash) {
        setSaveError(result.error ?? `HTTP ${response.status}`);
        return;
      }
      baseHashRef.current = result.hash;
      setData((current) => current ? { ...current, content, hash: result.hash, size: result.size ?? current.size } : current);
      setDiskConflict(null);
      setComparing(null);
      handle.markSaved(content);
      recordDraft();
      onFileSaved?.();
    } catch (e) {
      setSaveError(String(e));
    } finally {
      savingRef.current = false;
      setSaving(false);
      if (pendingSyncRef.current) {
        pendingSyncRef.current = false;
        synchronize();
      }
    }
  }, [fetchDiskVersion, filePath, onFileSaved, recordDraft, synchronize, t]);

  /** Discard the buffer for the version on disk. */
  const reloadFromDisk = useCallback((disk: FileData) => {
    const handle = editorHandleRef.current;
    baseHashRef.current = disk.hash ?? null;
    handle?.setValue(disk.content);
    handle?.markSaved(disk.content);
    dirtyRef.current = false;
    setFileEditDraft(filePath, null);
    setEditorSeed({ value: disk.content, saved: disk.content });
    setData(disk);
    setDiskConflict(null);
    setComparing(null);
    setPreviewDraft(null);
  }, [filePath]);

  /** Keep the buffer and make the version on disk the one a save replaces. */
  const keepMine = useCallback((disk: FileData, compare: boolean) => {
    baseHashRef.current = disk.hash ?? null;
    editorHandleRef.current?.markSaved(disk.content);
    recordDraft();
    // The editor keeps its line separator; the buffer is what gets saved.
    setData((current) => ({ ...disk, eol: current?.eol ?? disk.eol }));
    setDiskConflict(null);
    setComparing(compare ? disk.content : null);
  }, [recordDraft]);

  const handleEditorReady = useCallback(() => {
    if (!scrollRestorePendingRef.current || viewerStateRef.current.displayMode !== "source") return;
    const { scrollTop, scrollLeft } = viewerStateRef.current;
    scrollRestorePendingRef.current = false;
    requestAnimationFrame(() => {
      const scroller = editorHandleRef.current?.getScrollElement();
      if (!scroller) return;
      scroller.scrollTop = scrollTop;
      scroller.scrollLeft = scrollLeft;
    });
  }, []);

  const handleEditorScroll = useCallback((scrollTop: number, scrollLeft: number) => {
    viewerStateRef.current.scrollTop = scrollTop;
    viewerStateRef.current.scrollLeft = scrollLeft;
  }, []);

  useEffect(() => {
    if (!scrollRestorePendingRef.current || loading) return;
    if (error && !isDeletedDiff) return;
    if (requestedInitialDisplayMode === "diff" && !gitDiffResolved) return;
    if (requestedInitialDisplayMode === "diff" && hasGitDiff && displayMode !== "diff") return;

    // The source view restores its own scroller once the editor is ready.
    const content = contentRef.current;
    if (!content || showSource) return;

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
    showSource,
  ]);

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

  const content = previewSource;
  const markdownDirectory = getFileDirectory(filePath);
  const displayModes: DisplayMode[] = isDeletedDiff
    ? ["diff"]
    : [
        "source",
        ...(hasPreview ? ["preview" as const] : []),
        ...(hasGitDiff ? ["diff" as const] : []),
      ];
  const metadata = isDeletedDiff
    ? t("files.deleted")
    : `${language} · ${lineCount} lines · ${formatSize(data!.size)}`;
  const readOnlyTitle = data?.readOnlyReason
    ? t(READ_ONLY_REASON_KEYS[data.readOnlyReason])
    : t("files.readOnly");
  const conflictDisk = diskConflict && diskConflict.kind !== "deleted" ? diskConflict.disk : null;
  const conflictDiskEditable = conflictDisk?.editable === true && Boolean(conflictDisk.hash);

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
        {dirty && (
          <span
            className="file-viewer-dirty-indicator"
            title={t("files.unsavedChanges")}
            aria-label={t("files.unsavedChanges")}
            role="status"
          />
        )}

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
          {(editing || dirty) && !isDeletedDiff && (
            <button
              type="button"
              className="file-viewer-save-button"
              disabled={!dirty || saving}
              onClick={() => void save()}
              title={t("files.saveShortcut")}
            >
              {saving ? t("files.saving") : t("files.save")}
            </button>
          )}

          {displayModes.length > 1 && (
            <div className="file-viewer-mode-switch" aria-label={t("i18n.fileViewMode")}>
              {displayModes.map((mode) => {
                const active = effectiveDisplayMode === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => selectDisplayMode(mode)}
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
                  if (activeLineRange && onMentionLines) {
                    mentionLineRange(activeLineRange);
                  } else {
                    onAtMention?.(getRelativeFilePath(filePath, cwd), false);
                  }
                }}
                title={
                  activeLineRange && onMentionLines
                    ? `${t("i18n.mentionSelectedLines")} (L${activeLineRange.startLine}${activeLineRange.startLine !== activeLineRange.endLine ? `-L${activeLineRange.endLine}` : ""})`
                    : t("files.insertPath")
                }
                aria-label={t("files.mention")}
                disabled={!onAtMention && !onMentionLines}
                className="file-viewer-icon-button"
              >
                <MentionIcon />
              </button>
            )}
            {showSource && !isDeletedDiff && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    const next = !editing;
                    setEditing(next);
                    if (next) requestAnimationFrame(() => editorHandleRef.current?.focus());
                  }}
                  disabled={!canEdit}
                  title={canEdit ? t(editing ? "files.stopEditing" : "files.edit") : readOnlyTitle}
                  aria-label={canEdit ? t(editing ? "files.stopEditing" : "files.edit") : readOnlyTitle}
                  aria-pressed={canEdit ? editing : undefined}
                  className="file-viewer-icon-button"
                  style={{
                    background: editing && canEdit ? "var(--bg-selected)" : "transparent",
                    color: editing && canEdit ? "var(--text)" : undefined,
                  }}
                >
                  <EditIcon />
                </button>
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

      {diskConflict && (
        <div className="file-viewer-notice" role="alert">
          <span className="file-viewer-notice-text">
            {diskConflict.kind === "deleted"
              ? t("files.deletedOnDisk")
              : diskConflict.kind === "save"
                ? t("files.saveConflict")
                : t("files.changedOnDisk")}
          </span>
          {conflictDisk && (
            <button type="button" className="file-viewer-notice-button" onClick={() => reloadFromDisk(conflictDisk)} title={t("files.reloadFromDiskTitle")}>
              {t("files.reloadFromDisk")}
            </button>
          )}
          {conflictDisk && conflictDiskEditable && (
            <>
              <button type="button" className="file-viewer-notice-button" onClick={() => keepMine(conflictDisk, true)}>
                {t("files.compare")}
              </button>
              <button type="button" className="file-viewer-notice-button" onClick={() => keepMine(conflictDisk, false)}>
                {t("files.keepMine")}
              </button>
            </>
          )}
          {diskConflict.kind === "deleted" && (
            <button type="button" className="file-viewer-notice-button" onClick={() => setDiskConflict(null)}>
              {t("files.dismiss")}
            </button>
          )}
        </div>
      )}
      {!diskConflict && comparing !== null && (
        <div className="file-viewer-notice" role="status">
          <span className="file-viewer-notice-text">{t("files.comparing")}</span>
          <button type="button" className="file-viewer-notice-button" onClick={() => setComparing(null)}>
            {t("files.doneComparing")}
          </button>
        </div>
      )}
      {saveError && (
        <div className="file-viewer-notice is-error" role="alert">
          <span className="file-viewer-notice-text">{t("files.saveFailed", { error: saveError })}</span>
          <button type="button" className="file-viewer-notice-button" onClick={() => setSaveError(null)}>
            {t("files.dismiss")}
          </button>
        </div>
      )}

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

      {/* Content area. The editor stays mounted (hidden) in the other modes so
          its unsaved text and undo history survive a look at the preview. */}
      <div
        className="file-viewer-content"
        style={{ flex: 1, minHeight: 0, position: "relative", overflow: "hidden", background: "var(--bg)" }}
      >
        {data && editorSeed && !isDeletedDiff && (
          <div
            className="file-viewer-editor"
            style={{
              position: "absolute",
              inset: 0,
              bottom: data.truncated ? 48 : 0,
              display: showSource ? "block" : "none",
            }}
          >
            <CodeEditor
              handleRef={editorHandleRef}
              initialValue={editorSeed.value}
              savedValue={editorSeed.saved}
              filePath={filePath}
              language={language}
              lineSeparator={data.eol ?? "\n"}
              readOnly={!editing || !canEdit}
              wrapLines={wrapLines}
              isDark={isDark}
              compareWith={comparing}
              ariaLabel={t("files.editorLabel", { name: getFileName(filePath) })}
              onDirtyChange={handleDirtyChange}
              onSelectionLinesChange={setSelectedLineRange}
              onSave={() => void save()}
              onMentionSelection={mentionLineRange}
              onScroll={handleEditorScroll}
              onReady={handleEditorReady}
              onDispose={handleEditorDispose}
            />
          </div>
        )}
        {!showSource && (
          <div
            ref={contentRef}
            onScroll={(event) => {
              viewerStateRef.current.scrollTop = event.currentTarget.scrollTop;
              viewerStateRef.current.scrollLeft = event.currentTarget.scrollLeft;
            }}
            style={{ position: "absolute", inset: 0, overflow: "auto", background: "var(--bg)" }}
          >
            {showDiff ? (
              <DiffView patch={gitDiff!.patch!} />
            ) : showHtmlPreview ? (
              <iframe
                srcDoc={content}
                sandbox="allow-scripts"
                style={{ width: "100%", height: "100%", border: "none", background: "var(--bg)" }}
                title={t("i18n.htmlPreview")}
              />
            ) : (
              <div
                className="markdown-body markdown-file-preview"
                style={{ padding: "24px 32px" }}
              >
                {frontmatter?.data && <FrontmatterCard data={frontmatter.data} />}
                <ReactMarkdown
                  remarkPlugins={markdownPreviewRemarkPlugins}
                  rehypePlugins={markdownPreviewRehypePlugins}
                  urlTransform={onOpenFile ? markdownUrlTransform : markdownAppUrlTransform}
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
                      return (
                        <code className={className} {...props}>
                          {children}
                        </code>
                      );
                    },
                    pre({ children }) {
                      // Render the code block directly — CodeBlock provides its own wrapping.
                      // For non-mermaid blocks, pass through to default pre rendering.
                      return <>{children}</>;
                    },
                    a({ href, children, ...props }) {
                      delete props.node;
                      const linkedFile = onOpenFile
                        ? resolveLocalFileHref(href, markdownDirectory, cwd ?? markdownDirectory)
                        : null;
                      if (!linkedFile || !onOpenFile) {
                        // Like chat links: a web or app link must not replace Pi Web.
                        return isExternalMarkdownHref(href)
                          ? <a href={href} {...props} target="_blank" rel="noopener noreferrer">{children}</a>
                          : <a href={href} {...props}>{children}</a>;
                      }

                      const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
                        if (!shouldOpenLocalFileInApp(event)) return;
                        event.preventDefault();
                        onOpenFile(linkedFile, parsePdfPageFragment(href) ?? undefined);
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
                      // Dynamic local paths are served directly by the file API.
                      // eslint-disable-next-line @next/next/no-img-element
                      return <img src={imageSrc} alt={alt ?? ""} loading="lazy" {...props} />;
                    },
                  }}
                >
                  {markdownPreview}
                </ReactMarkdown>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
