"use client";

import { useI18n } from "@/hooks/useI18n";
import type { Ref } from "react";
import type { ParsedSegment, QuoteOption } from "@/lib/quote-reply";
import { formatQuote } from "@/lib/quote-reply";

interface Props {
  segments: ParsedSegment[];
  /** Called with the formatted quote-reply text (caller inserts it into the input). */
  onPick: (quote: string) => void;
  /** Optional ref to the popover element (caller scrolls it into view on open). */
  innerRef?: Ref<HTMLSpanElement>;
}

/**
 * A button row for one paragraph's parsed questions. Each question gets its
 * own sub-row: detected options (是/否, A/B, …) when available, otherwise a
 * single fallback "quote" button. Clicking inserts a quoted reply into the
 * input box — never sends.
 */
export function QuoteReplyPopover({ segments, onPick, innerRef }: Props) {
  const { t } = useI18n();
  // Show every segment: closed questions get option buttons, the rest get a
  // fallback quote button. (Any paragraph is quoteable.)
  const questions = segments;
  if (questions.length === 0) return null;

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
