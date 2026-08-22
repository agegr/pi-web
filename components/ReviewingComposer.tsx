"use client";

import { useI18n } from "@/hooks/useI18n";
import type { AttachConflict, AttachState } from "@/hooks/useAgentSession";

interface Props {
  attachState: AttachState;
  conflict: AttachConflict | null;
  error: string | null;
  onAttach: () => void;
}

/**
 * Stands in for the message editor while a session is only being reviewed.
 *
 * Continuing a session runs the extension hooks that reconcile the working
 * directory, so it must be a deliberate act rather than a side effect of
 * focusing a text box. This is a real button: it is reachable with Tab and
 * activates with Enter or Space.
 */
export function ReviewingComposer({ attachState, conflict, error, onAttach }: Props) {
  const { t } = useI18n();
  const attaching = attachState === "attaching";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
      {conflict && (
        <div
          role="alert"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 12px",
            border: "1px solid rgba(234,179,8,0.4)",
            borderRadius: 10,
            background: "color-mix(in srgb, #eab308 8%, transparent)",
            color: "var(--text)",
            fontSize: 12,
            lineHeight: 1.5,
          }}
        >
          <span style={{ flexShrink: 0 }} aria-hidden="true">⚠</span>
          <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>
            {t("attach.conflictBusy").replace(
              "{session}",
              conflict.sessionName ?? conflict.sessionId,
            )}
          </span>
        </div>
      )}

      {error && !conflict && (
        <div
          role="alert"
          style={{
            padding: "8px 12px",
            border: "1px solid rgba(248,113,113,0.4)",
            borderRadius: 10,
            background: "color-mix(in srgb, #f87171 8%, transparent)",
            color: "var(--text)",
            fontSize: 12,
            lineHeight: 1.5,
            overflowWrap: "anywhere",
          }}
        >
          {t("attach.failed").replace("{error}", error)}
        </div>
      )}

      <button
        type="button"
        onClick={onAttach}
        disabled={attaching}
        title={t("attach.reviewingHint")}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          width: "100%",
          minWidth: 0,
          padding: "12px 14px",
          border: "1px dashed color-mix(in srgb, var(--border) 90%, transparent)",
          borderRadius: 14,
          background: "var(--bg)",
          color: "var(--text-muted)",
          font: "inherit",
          fontSize: 14,
          textAlign: "left",
          cursor: attaching ? "progress" : "pointer",
          opacity: attaching ? 0.7 : 1,
          transition: "border-color 0.15s, background 0.15s, color 0.15s",
        }}
      >
        <span aria-hidden="true" style={{ flexShrink: 0, fontSize: 12 }}>
          {attaching ? "◌" : "👁"}
        </span>
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {attaching ? t("attach.attaching") : t("attach.reviewing")}
        </span>
      </button>
    </div>
  );
}
