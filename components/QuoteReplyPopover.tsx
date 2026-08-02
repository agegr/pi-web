"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { Ref } from "react";
import { encodeFilePathForApi, joinFilePath } from "@/lib/file-paths";
import type { ParsedSegment, QuoteOption } from "@/lib/quote-reply";
import { extractFilePaths, formatQuote } from "@/lib/quote-reply";

interface Props {
  segments: ParsedSegment[];
  /** Called with the formatted quote-reply text (caller inserts it into the input). */
  onPick: (quote: string) => void;
  /** Open a file path (from inline paths mentioned in the text). */
  onOpenFile?: (filePath: string, fileName?: string) => void;
  /** Session cwd used to resolve relative paths before checking /api/files. */
  cwd?: string;
  /** Optional ref to the popover element (caller scrolls it into view on open). */
  innerRef?: Ref<HTMLSpanElement>;
}

/**
 * A button row for one paragraph's parsed questions. Each question gets its
 * own sub-row: detected options (是/否, A/B, …) when available, otherwise a
 * single fallback "quote" button. Clicking inserts a quoted reply into the
 * input box — never sends.
 */
export function QuoteReplyPopover({ segments, onPick, onOpenFile, cwd, innerRef }: Props) {
  const { t } = useI18n();
  // Show every segment: closed questions get option buttons, the rest get a
  // fallback quote button. (Any paragraph is quoteable.)
  const questions = segments;
  if (questions.length === 0) return null;

  // Inline file paths mentioned in the text (assistant often lists files as
  // plain text, not links). Verify each against the backend before offering
  // an "open" action so we don't render dead buttons.
  const [existingFiles, setExistingFiles] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    const allPaths = Array.from(new Set(questions.flatMap((seg) => extractFilePaths(seg.text))));
    const absPaths = allPaths.map((p) =>
      p.startsWith("/") ? p : (cwd ? joinFilePath(cwd, p) : p),
    );
    Promise.all(
      absPaths.map(async (abs) => {
        try {
          const res = await fetch(`/api/files/${encodeFilePathForApi(abs)}?type=meta`);
          return res.ok ? abs : null;
        } catch {
          return null;
        }
      }),
    ).then((found) => {
      if (!cancelled) setExistingFiles(found.filter((f): f is string => !!f));
    });
    return () => { cancelled = true; };
  }, [questions, cwd]);

  return (
    <span
      ref={innerRef}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 3,
        marginTop: 4,
        width: "fit-content",
        maxWidth: "100%",
        background: "var(--bg)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: 4,
        boxShadow: "0 4px 14px rgba(0,0,0,0.14)",
      }}
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => e.stopPropagation()}
    >
      {onOpenFile && existingFiles.length > 0 && (
        <span style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {existingFiles.map((abs) => (
            <button
              key={abs}
              type="button"
              onClick={(e) => { e.stopPropagation(); onOpenFile(abs, abs.split("/").pop() ?? abs); }}
              title={t("i18n.openFile")}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "3px 9px",
                fontSize: 12,
                color: "var(--accent)",
                background: "color-mix(in srgb, var(--accent) 10%, transparent)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                cursor: "pointer",
                whiteSpace: "nowrap",
                maxWidth: 220,
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              <FolderOpenIcon />
              {t("i18n.openFile")}: {abs.split("/").pop()}
            </button>
          ))}
        </span>
      )}
      {questions.map((seg, i) => (
        <SegmentRow key={i} segment={seg} onPick={onPick} t={t} />
      ))}
    </span>
  );
}

function SegmentRow({
  segment,
  onPick,
  t,
}: {
  segment: ParsedSegment;
  onPick: (quote: string) => void;
  t: (k: string) => string;
}) {
  const options: QuoteOption[] =
    segment.options ?? [{ label: t("chat.quoteReply"), value: "" }];
  return (
    <span style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
      {options.map((opt, j) => (
        <button
          key={j}
          onClick={(e) => {
            e.stopPropagation();
            onPick(formatQuote(segment.text, opt.value || undefined));
          }}
          title={segment.text.slice(0, 60)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "3px 9px",
            fontSize: 12,
            color: opt.value ? "var(--accent)" : "var(--text-muted)",
            background: opt.value
              ? "color-mix(in srgb, var(--accent) 10%, transparent)"
              : "var(--bg-hover)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            cursor: "pointer",
            whiteSpace: "nowrap",
            maxWidth: 220,
            overflow: "hidden",
            textOverflow: "ellipsis",
            transition: "background 0.12s, border-color 0.12s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = "color-mix(in srgb, var(--accent) 45%, var(--border))";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = "var(--border)";
          }}
        >
          {opt.label}
        </button>
      ))}
    </span>
  );
}

function FolderOpenIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}
