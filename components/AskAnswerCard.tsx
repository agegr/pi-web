"use client";

import { MarkdownBody } from "./MarkdownBody";
import { useI18n } from "@/hooks/useI18n";
import type { StructuredAskRecord } from "@/lib/structured-ask";

/**
 * Transcript view of a finished structured ask: the question, the options that
 * were offered, and what the user answered. Keeps a decision visible in history
 * instead of collapsing it into a generic tool call.
 */
export function AskAnswerCard({ record, pending }: { record: StructuredAskRecord; pending?: boolean }) {
  const { t } = useI18n();
  const answer = record.answer;
  const selections = answer?.kind === "selection" ? answer.selections : [];
  const freeform = answer?.kind === "freeform" ? answer.text : null;

  const status = pending
    ? t("chat.askPending")
    : record.cancelled || !answer
      ? t("chat.askCancelled")
      : t("chat.askAnswered");

  return (
    <div
      style={{
        borderRadius: 8,
        border: "1px solid var(--border)",
        background: "var(--bg-panel)",
        overflow: "hidden",
        fontSize: 13,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderBottom: "1px solid var(--border)" }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: "var(--accent)", fontFamily: "var(--font-mono)" }}>
          {t("chat.askTitle")}
        </span>
        <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{status}</span>
      </div>

      <div style={{ padding: "8px 10px", color: "var(--text)" }}>
        <MarkdownBody>{record.question}</MarkdownBody>
      </div>

      {record.options.length > 0 && (
        <ul style={{ listStyle: "none", margin: 0, padding: "0 10px 8px", display: "flex", flexDirection: "column", gap: 4 }}>
          {record.options.map((option) => {
            const chosen = selections.includes(option.title);
            return (
              <li
                key={option.title}
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 8,
                  padding: "4px 8px",
                  borderRadius: 6,
                  border: `1px solid ${chosen ? "var(--accent)" : "transparent"}`,
                  color: chosen ? "var(--text)" : "var(--text-dim)",
                }}
              >
                <span aria-hidden="true" style={{ fontSize: 11, color: chosen ? "var(--accent)" : "var(--text-dim)" }}>
                  {chosen ? "\u2713" : "\u00b7"}
                </span>
                <span>{option.title}</span>
              </li>
            );
          })}
        </ul>
      )}

      {freeform && (
        <div style={{ padding: "0 10px 8px", color: "var(--text)" }}>
          <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{t("chat.askFreeformAnswer")}</span>
          <div>{freeform}</div>
        </div>
      )}

      {answer?.kind === "selection" && answer.comment && (
        <div style={{ padding: "0 10px 8px", color: "var(--text-muted)" }}>
          <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{t("chat.askComment")}</span>
          <div>{answer.comment}</div>
        </div>
      )}
    </div>
  );
}
