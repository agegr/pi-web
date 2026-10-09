"use client";

import { memo, useMemo, type CSSProperties } from "react";
import { tokenizeBash, type BashTokenKind } from "@/lib/bash-highlight";

const TOKEN_STYLE: Record<Exclude<BashTokenKind, "plain">, CSSProperties> = {
  command: { color: "var(--syntax-command)", fontWeight: 600 },
  flag: { color: "var(--syntax-flag)" },
  string: { color: "var(--syntax-string)" },
  variable: { color: "var(--syntax-variable)" },
  operator: { color: "var(--syntax-operator)" },
  comment: { color: "var(--syntax-comment)", fontStyle: "italic" },
};

/**
 * A shell command with its tokens coloured. Only the coloured parts are
 * elements, so this renders inline anywhere — a single-line tool header as
 * readily as a block of its own — and uncoloured words inherit the colour of
 * whatever contains it.
 */
export const BashCommand = memo(function BashCommand({ command, limit }: { command: string; limit?: number }) {
  const tokens = useMemo(() => tokenizeBash(command, limit), [command, limit]);
  return (
    <>
      {tokens.map((token, index) =>
        token.kind === "plain"
          ? token.text
          : <span key={index} style={TOKEN_STYLE[token.kind]}>{token.text}</span>,
      )}
    </>
  );
});