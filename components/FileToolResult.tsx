"use client";

import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vs } from "react-syntax-highlighter/dist/cjs/styles/prism";
import { vscDarkPlus } from "react-syntax-highlighter/dist/cjs/styles/prism";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import { getFileName } from "@/lib/file-paths";
import { getLanguageFromPath } from "@/lib/file-language";
import { getFileIcon } from "./FileIcons";

interface Props {
  /** Absolute file path. */
  filePath: string;
  /** Whether this was a write (new/overwrite) vs edit (modify) vs read. */
  isWrite: boolean;
  /** Whether this was a read operation. */
  isRead?: boolean;
  /** Full result text (may be the file content). */
  resultText: string;
  /** Content extracted from tool input (for write tools). */
  inputContent?: string;
  /** Whether the result is empty. */
  isEmpty: boolean;
  /** Whether there was an error. */
  isError: boolean;
}

/**
 * Compact summary + syntax-highlighted content viewer for a successful
 * `write`/`edit` tool result.
 *
 * Always renders the content viewer directly — it is only ever used inside an
 * already-expanded `ToolCallBlock`, so a second expand/collapse toggle would
 * only force the user to click twice.
 */
export function FileToolResult({ filePath, isWrite, isRead = false, resultText, inputContent, isEmpty, isError }: Props) {
  const { t } = useI18n();
  const { isDark } = useTheme();
  const name = getFileName(filePath);
  const language = getLanguageFromPath(filePath);
  // Use inputContent if available (from write tool), otherwise fall back to resultText
  const displayContent = inputContent ?? resultText;
  const lineCount = displayContent ? displayContent.split("\n").length : 0;

  const summaryLabel = isWrite ? t("chat.fileWritten", { name }) : isRead ? t("chat.fileRead", { name }) : t("chat.fileModified", { name });
  const linesLabel = t("chat.fileLines", { count: lineCount });

  return (
    <div
      style={{
        borderTop: `1px solid ${isError ? "rgba(248,113,113,0.3)" : "rgba(34,197,94,0.15)"}`,
        background: isError ? "rgba(248,113,113,0.04)" : "var(--bg-subtle)",
      }}
    >
      {/* Compact summary row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 10px",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg)",
        }}
      >
        {getFileIcon(name, 14)}
        <span style={{ fontSize: 12, color: "var(--text)", fontWeight: 500 }}>
          {summaryLabel}
        </span>
        <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
          · {linesLabel}
        </span>
      </div>

      {/* Syntax-highlighted content viewer */}
      <div
        style={{
          maxHeight: 600,
          overflow: "auto",
          background: "var(--bg)",
        }}
      >
        {isError ? (
          <div style={{ padding: "8px 10px", color: "#f87171", fontSize: 12 }}>
            {resultText || "(error)"}
          </div>
        ) : isEmpty || !displayContent ? (
          <div style={{ padding: "8px 10px", color: "var(--text-dim)", fontSize: 12, fontStyle: "italic" }}>
            (no output)
          </div>
        ) : (
          <SyntaxHighlighter
            language={language === "text" ? "plaintext" : language}
            style={isDark ? vscDarkPlus : vs}
            showLineNumbers
            customStyle={{
              margin: 0,
              padding: "8px",
              border: 0,
              background: "var(--bg)",
              fontSize: "calc(12px + var(--chat-font-size-offset, 0px))",
              lineHeight: 1.6,
              width: "100%",
              overflow: "visible",
            }}
            codeTagProps={{
              style: {
                fontFamily: "var(--font-mono)",
                overflowWrap: "anywhere",
              },
            }}
            lineProps={{
              style: {
                // Override the display:flex that wrapLongLines+showLineNumbers
                // forces on each line (turns tokens into flex blocks). Keeping
                // inline tokens lets long code wrap like normal text.
                display: "block",
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
              },
            }}
            wrapLongLines
          >
            {displayContent}
          </SyntaxHighlighter>
        )}
      </div>
    </div>
  );
}
