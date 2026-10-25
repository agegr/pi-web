"use client";

import { useI18n } from "@/hooks/useI18n";
import type { SessionInfo } from "@/lib/types";

interface Props {
  label: string | null;
  commandRunning: boolean;
  runningSubagents?: readonly SessionInfo[];
}

/** Chat-tail activity; background subagents stay visible after the main turn settles. */
export function ChatActivityStatus({ label, commandRunning, runningSubagents = [] }: Props) {
  const { t, locale } = useI18n();
  const descriptions = runningSubagents.map((session) => (
    session.relation?.kind === "subagent"
      ? session.relation.description.trim() || session.relation.profile
      : session.id
  )).join(locale === "en" ? ", " : "、");

  return (
    <>
      {label && (
        <div className="break-words py-2 text-[13px] text-text-muted">
          <span className="animate-[pulse_1.5s_infinite]">{label}</span>
        </div>
      )}
      {runningSubagents.length > 0 && (
        <div role="status" className="break-words py-2 text-[13px] text-text-muted">
          {t(runningSubagents.length === 1 ? "chat.runningSubagent" : "chat.runningSubagents", {
            count: runningSubagents.length, descriptions,
          })}
        </div>
      )}
      {commandRunning && (
        <div className="py-2 text-[13px] text-text-muted">
          <span className="animate-[pulse_1.5s_infinite]">{t("chat.runningCommand")}</span>
        </div>
      )}
    </>
  );
}
