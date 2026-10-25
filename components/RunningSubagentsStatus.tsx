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
      {/* Native SVG: its three blocks light up in sequence without rotating the silhouette. */}
      <picture className="mt-0.5 block h-4 w-4 shrink-0">
        <source media="(prefers-reduced-motion: reduce)" srcSet="/icons/pi-blocks-still.svg" />
        <img
          className="block"
          src="/icons/pi-blocks-running.svg"
          width="16" height="16" alt="" aria-hidden="true"
        />
      </picture>
      <span className="min-w-0 break-words">
        {t(runningSubagents.length === 1 ? "chat.runningSubagent" : "chat.runningSubagents", {
          count: runningSubagents.length, descriptions,
        })}
      </span>
    </div>
  );
}
