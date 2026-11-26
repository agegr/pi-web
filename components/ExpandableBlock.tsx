"use client";

import { useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";

/** A block a user message carries that the user did not type out: a quoted
 *  session (`SessionReferenceBlock`) or an invoked skill's text. One line by
 *  default — a label, a title, details after it — expanding to the body, which
 *  scrolls inside its own cap. pi's TUI shows a skill the same way: a
 *  `[skill] name` line that expands to the skill (`SkillInvocationMessageComponent`).
 *  A click anywhere on the line toggles it, except on a link or button the
 *  title brings. */
export function ExpandableBlock({ label, title, details, children }: {
  label: string;
  title: ReactNode;
  details?: ReactNode;
  /** The body, rendered only while expanded. */
  children: ReactNode;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const toggle = () => setExpanded((previous) => !previous);

  return (
    <div
      style={{
        border: "1px solid rgba(59,130,246,0.22)",
        borderRadius: 8,
        background: "color-mix(in srgb, var(--bg) 45%, var(--user-bg))",
        minWidth: 0,
        overflow: "hidden",
      }}
    >
      <div
        onClick={(event) => {
          if ((event.target as Element).closest("a, button")) return;
          toggle();
        }}
        style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0, padding: "5px 9px", cursor: "pointer" }}
      >
        <button
          type="button"
          onClick={toggle}
          title={expanded ? t("i18n.collapse") : t("i18n.expand")}
          aria-expanded={expanded}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            flexShrink: 0,
            padding: 0,
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--text-dim)",
            fontSize: "calc(13px + var(--chat-font-size-offset, 0px))",
          }}
        >
          <svg
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ flexShrink: 0, transform: expanded ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}
            aria-hidden="true"
          >
            <polyline points="9 6 15 12 9 18" />
          </svg>
          <span>{label}</span>
        </button>
        {title}
        {details}
      </div>
      {expanded && (
        <div
          style={{
            borderTop: "1px solid rgba(59,130,246,0.18)",
            maxHeight: 320,
            overflowY: "auto",
            padding: "7px 10px",
            color: "var(--text-muted)",
            fontSize: "calc(13px + var(--chat-font-size-offset, 0px))",
            lineHeight: 1.55,
            wordBreak: "break-word",
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

/** The title's text on one line, cut with an ellipsis. */
export const EXPANDABLE_TITLE_STYLE = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: "calc(13px + var(--chat-font-size-offset, 0px))",
} as const;

/** Counts and notes after the title. */
export const EXPANDABLE_DETAILS_STYLE = { flexShrink: 0, color: "var(--text-dim)", fontSize: 12 } as const;
