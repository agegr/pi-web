"use client";

import { Prism as SyntaxHighlighter, createElement } from "react-syntax-highlighter";
import { vs } from "react-syntax-highlighter/dist/cjs/styles/prism";
import { vscDarkPlus } from "react-syntax-highlighter/dist/cjs/styles/prism";
import { useTheme } from "@/hooks/useTheme";

interface Props {
  text: string;
  isError: boolean;
  isEmpty: boolean;
  /** If true, display as a command (with $ prompt), not output. */
  isCommand?: boolean;
}

/**
 * Custom renderer: prepend an independent `$` prompt element to each wrapped
 * line. Keeping the prompt outside the token stream means Prism never tries to
 * parse `$` as a variable/command-substitution and the highlighting stays clean.
 */
function commandRenderer({ rows, stylesheet, useInlineStyles }: rendererProps): React.ReactNode {
  return rows.map((node, i) => (
    <div
      key={`cmd-line-${i}`}
      style={{ display: "flex", width: "100%", alignItems: "flex-start", fontFamily: "var(--font-mono)" }}
    >
      <span style={{ color: "var(--text-dim)", marginRight: 8, flexShrink: 0, userSelect: "none" }}>$</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        {createElement({ node, stylesheet, useInlineStyles, key: `code-segment-${i}` })}
      </div>
    </div>
  ));
}

/**
 * Displays bash command or output with syntax highlighting.
 * Used inside an already-expanded ToolCallBlock, so no extra expand/collapse.
 */
export function BashResultView({ text, isError, isEmpty, isCommand = false }: Props) {
  const { isDark } = useTheme();
  const highlightStyle = isDark ? vscDarkPlus : vs;

  return (
    <div
      style={{
        borderTop: `1px solid ${isError ? "rgba(248,113,113,0.3)" : "rgba(34,197,94,0.15)"}`,
        background: isError ? "rgba(248,113,113,0.04)" : "var(--bg-subtle)",
      }}
    >
      <div
        style={{
          maxHeight: 600,
          overflow: "auto",
        }}
      >
        {isEmpty && !isError ? (
          <div style={{ padding: "8px 10px", color: "var(--text-dim)", fontSize: 12, fontStyle: "italic" }}>
            (no output)
          </div>
        ) : (
          <SyntaxHighlighter
            language="bash"
            style={highlightStyle}
            showLineNumbers={!isCommand}
            renderer={isCommand ? commandRenderer : undefined}
            customStyle={{
              margin: 0,
              padding: "8px",
              border: 0,
              background: "transparent",
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
                // Override the display:flex that wrapLongLines+showLineNumbers
                // forces on each line (turns tokens into flex blocks). Keeping
                // inline tokens lets long content wrap like normal text.
                display: "block",
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
              },
            }}
            wrapLongLines
          >
            {text || "(error)"}
          </SyntaxHighlighter>
        )}
      </div>
    </div>
  );
}
