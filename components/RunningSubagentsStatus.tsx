"use client";

import { useI18n } from "@/hooks/useI18n";
import type { SessionInfo } from "@/lib/types";

interface Props {
  runningSubagents?: readonly SessionInfo[];
}

/** An independent chat-tail block; never owns the main agent's phase or command status. */
export function RunningSubagentsStatus({ runningSubagents = [] }: Props) {
  const { t, locale } = useI18n();
  if (runningSubagents.length === 0) return null;

  const descriptions = runningSubagents.map((session) => (
    session.relation?.kind === "subagent"
      ? session.relation.description.trim() || session.relation.profile
      : session.id
  )).join(locale === "en" ? ", " : "、");

  return (
    <div role="status" className="flex items-start gap-2 py-2 text-[13px] text-text-muted">
      <svg
        className="mt-0.5 shrink-0 origin-center animate-spin [animation-duration:2.4s] motion-reduce:animate-none"
        width="16" height="16" viewBox="0 0 24 24" fill="currentColor"
        aria-hidden="true" focusable="false"
      >
        <rect x="4" y="4" width="6" height="6" rx="1" />
        <rect x="14" y="4" width="6" height="6" rx="1" opacity="0.75" />
        <rect x="14" y="14" width="6" height="6" rx="1" opacity="0.5" />
        <rect x="4" y="14" width="6" height="6" rx="1" opacity="0.25" />
      </svg>
      <span className="min-w-0 break-words">
        {t(runningSubagents.length === 1 ? "chat.runningSubagent" : "chat.runningSubagents", {
          count: runningSubagents.length, descriptions,
        })}
      </span>
    </div>
  );
}
