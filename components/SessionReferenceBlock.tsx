"use client";

import { useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { formatShortRelativeTime } from "@/lib/i18n/format";
import { sessionDeepLink } from "@/lib/session-links";
import type { SessionReferenceView } from "@/lib/session-reference-block";

/** One quoted session inside a sent message (the `#` reference the server
 *  expanded, lib/session-reference.ts): a single line by default — title,
 *  message count, a link to that session — expanding to the text the model
 *  actually read. Quoting a long conversation must not push the rest of the
 *  transcript off the screen, so it starts collapsed (#1716). The tooltip names
 *  the project and when the session last changed, and the line says how many
 *  messages the quote left out, so an incomplete quote never reads as the
 *  whole conversation. */
export function SessionReferenceBlock({ reference }: { reference: SessionReferenceView }) {
  const { t, locale } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const title = reference.title.trim() || reference.id.slice(0, 8);
  const countLabel = reference.messages === null
    ? ""
    : t("chat.referencedMessages", { count: reference.messages });
  const project = reference.cwd ? reference.cwd.split(/[\\/]/).pop() ?? "" : "";
  const updated = reference.modified
    ? formatShortRelativeTime(reference.modified, locale, new Date())
    : "";
  const tooltip = [project, updated].filter(Boolean).join(" · ") || reference.path || reference.id;

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
      <div style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0, padding: "5px 9px" }}>
        <button
          type="button"
          onClick={() => setExpanded((previous) => !previous)}
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
          <span>{t("chat.referencedSession")}</span>
        </button>
        <a
          href={sessionDeepLink(reference.id)}
          title={tooltip}
          style={{
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            color: "var(--accent)",
            fontSize: "calc(13px + var(--chat-font-size-offset, 0px))",
            textDecoration: "none",
          }}
        >
          {title}
        </a>
        {countLabel && (
          <span style={{ flexShrink: 0, color: "var(--text-dim)", fontSize: 12 }}>
            {countLabel}
          </span>
        )}
        {reference.omitted > 0 && (
          <span style={{ flexShrink: 0, color: "var(--text-dim)", fontSize: 12 }}>
            {t("chat.referencedOmitted", { count: reference.omitted })}
          </span>
        )}
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
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {reference.body}
        </div>
      )}
    </div>
  );
}