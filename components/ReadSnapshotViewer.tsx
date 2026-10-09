"use client";

import { useMemo } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vs } from "react-syntax-highlighter/dist/cjs/styles/prism";
import { vscDarkPlus } from "react-syntax-highlighter/dist/cjs/styles/prism";
import { useTheme } from "@/hooks/useTheme";
import { getLanguage } from "@/lib/file-types";
import { getFileDirectory } from "@/lib/file-paths";
import { MarkdownBody } from "./MarkdownBody";
import { CsvTable, isCsvPath } from "./CsvTable";

/**
 * The exact slice a `read` tool call returned — not the live file. Line
 * numbers continue from the read's offset so they match the source file.
 */
export function ReadSnapshotViewer({ filePath, content, offset }: { filePath: string; content: string; offset?: number }) {
  const { isDark } = useTheme();
  const language = getLanguage(filePath);
  const highlighted = useMemo(
    () => (
      <SyntaxHighlighter
        language={language === "text" ? "plaintext" : language}
        style={isDark ? vscDarkPlus : vs}
        showLineNumbers
        startingLineNumber={offset ?? 1}
        customStyle={{
          margin: 0,
          padding: "8px 12px",
          border: 0,
          background: "var(--bg)",
          fontSize: 12,
          minHeight: "100%",
          width: "max-content",
          minWidth: "100%",
        }}
        codeTagProps={{ style: { fontFamily: "var(--font-mono)", overflowWrap: "anywhere", whiteSpace: "pre-wrap" } }}
        wrapLongLines
      >
        {content}
      </SyntaxHighlighter>
    ),
    [isDark, language, content, offset],
  );
  if (isCsvPath(filePath)) {
    return <CsvTable content={content} filePath={filePath} startLine={offset} />;
  }
  if (language === "markdown") {
    return (
      <div style={{ height: "100%", overflow: "auto", background: "var(--bg)" }}>
        <div className="markdown-body markdown-file-preview" style={{ padding: "24px 32px" }}>
          <MarkdownBody cwd={getFileDirectory(filePath)}>{content}</MarkdownBody>
        </div>
      </div>
    );
  }
  return (
    <div style={{ height: "100%", overflow: "auto", background: "var(--bg)" }}>
      {highlighted}
    </div>
  );
}
