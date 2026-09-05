"use client";

import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vs } from "react-syntax-highlighter/dist/cjs/styles/prism";
import { vscDarkPlus } from "react-syntax-highlighter/dist/cjs/styles/prism";
import { useTheme } from "@/hooks/useTheme";

interface Props {
  text: string;
  isError: boolean;
  isEmpty: boolean;
  /** If true, display as a command (with $ prefix), not output. */
  isCommand?: boolean;
}

/**
 * Displays bash command or output with syntax highlighting.
 * Used inside an already-expanded ToolCallBlock, so no extra expand/collapse.
 */
export function BashResultView({ text, isError, isEmpty, isCommand = false }: Props) {
  const { isDark } = useTheme();
  const lines = text ? text.split("\n") : [];
  const displayText = isCommand ? lines.map((line, i) => `${i === 0 ? "$ " : "  "}${line}`).join("\n") : text;

  return (
    <div
      style={{
        borderTop: `1px solid ${isError ? "rgba(248,113,113,0.3)" : "rgba(34,197,94,0.15)"}`,
        background: "var(--bg-subtle)",
      }}
    >
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
        {isCommand ? (
          <span style={{ fontSize: 12, color: "var(--text)", fontWeight: 500 }}>
            Command
          </span>
        ) : (
          <span style={{ fontSize: 12, color: "var(--text)", fontWeight: 500 }}>
            Output
          </span>
        )}
        {text && (
          <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
            · {lines.length} lines
          </span>
        )}
      </div>

      <div
        style={{
          maxHeight: 600,
          overflow: "auto",
          background: "var(--bg)",
        }}
      >
        {isError ? (
          <div style={{ padding: "8px 10px", color: "#f87171", fontSize: 12 }}>
            {text || "(error)"}
          </div>
        ) : isEmpty ? (
          <div style={{ padding: "8px 10px", color: "var(--text-dim)", fontSize: 12, fontStyle: "italic" }}>
            (no output)
          </div>
        ) : (
          <SyntaxHighlighter
            language="bash"
            style={isDark ? vscDarkPlus : vs}
            showLineNumbers
            customStyle={{
              margin: 0,
              padding: "8px",
              border: 0,
              background: "var(--bg)",
              fontSize: 12,
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
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
              },
            }}
            wrapLongLines
            showLineNumbers={false}
          >
            {displayText}
          </SyntaxHighlighter>
        )}
      </div>
    </div>
  );
}
