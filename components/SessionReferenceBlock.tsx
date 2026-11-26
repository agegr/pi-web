"use client";

import { useContext } from "react";
import { useI18n } from "@/hooks/useI18n";
import { formatShortRelativeTime } from "@/lib/i18n/format";
import { isPlainActivation, sessionDeepLink } from "@/lib/session-links";
import { OpenSessionContext } from "./open-session-context";
import { EXPANDABLE_DETAILS_STYLE, EXPANDABLE_TITLE_STYLE, ExpandableBlock } from "./ExpandableBlock";
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
  const openSession = useContext(OpenSessionContext);
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
    <ExpandableBlock
      label={t("chat.referencedSession")}
      title={
        <a
          href={sessionDeepLink(reference.id)}
          title={tooltip}
          onClick={(event) => {
            // A plain click opens the session here, as its sidebar row does;
            // Ctrl/Cmd-click, middle-click and the rest stay the browser's.
            if (!isPlainActivation(event)) return;
            if (openSession?.(reference.id)) event.preventDefault();
          }}
          style={{ ...EXPANDABLE_TITLE_STYLE, color: "var(--accent)", textDecoration: "none" }}
        >
          {title}
        </a>
      }
      details={
        <>
          {countLabel && <span style={EXPANDABLE_DETAILS_STYLE}>{countLabel}</span>}
          {reference.omitted > 0 && (
            <span style={EXPANDABLE_DETAILS_STYLE}>
              {t("chat.referencedOmitted", { count: reference.omitted })}
            </span>
          )}
        </>
      }
    >
      <div style={{ whiteSpace: "pre-wrap" }}>{reference.body}</div>
    </ExpandableBlock>
  );
}
