"use client";

import { useState } from "react";
import type { SelectionContext, SessionReference } from "@/lib/composer-context";
import { useI18n } from "@/hooks/useI18n";

interface Props {
  contexts: SelectionContext[];
  sessionReferences?: SessionReference[];
  disabled?: boolean;
  onLocate?: (context: SelectionContext) => void;
  onOpenSessionReference?: (reference: SessionReference) => void;
  onRemove: (id: string) => void;
  onRemoveSessionReference?: (id: string) => void;
}

function contextSummary(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > 36 ? `${compact.slice(0, 33)}...` : compact;
}

function sessionSummary(reference: SessionReference): string {
  return [
    reference.title?.trim() || reference.id.slice(0, 12),
    reference.cwd,
    `ID: ${reference.id}`,
  ].filter(Boolean).join("\n");
}

export function ComposerContextStrip({
  contexts,
  sessionReferences = [],
  disabled = false,
  onLocate,
  onOpenSessionReference,
  onRemove,
  onRemoveSessionReference,
}: Props) {
  const { t } = useI18n();
  const [activeContextId, setActiveContextId] = useState<string | null>(null);

  if (contexts.length === 0 && sessionReferences.length === 0) return null;

  const handleContextClick = (context: SelectionContext) => {
    if (disabled) return;
    if ((context.sourceEntryId || context.sourceFilePath) && onLocate) {
      onLocate(context);
    }
  };

  return (
    <div
      role="group"
      aria-label={t("chat.quotedContext")}
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 4,
        marginBottom: 8,
        minWidth: 0,
      }}
    >
      {contexts.map((context, index) => {
        const itemId = `selection:${context.id}`;
        return (
        <div
          key={itemId}
          onMouseEnter={() => setActiveContextId(itemId)}
          onMouseLeave={() => setActiveContextId((current) => current === itemId ? null : current)}
          onFocusCapture={() => setActiveContextId(itemId)}
          onBlurCapture={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) {
              setActiveContextId((current) => current === itemId ? null : current);
            }
          }}
          style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            minWidth: 0,
            maxWidth: "min(100%, 190px)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              minWidth: 0,
              height: 26,
              border: "1px solid color-mix(in srgb, var(--accent) 30%, var(--border))",
              borderRadius: 14,
              background: "color-mix(in srgb, var(--accent) 6%, var(--bg-panel))",
              overflow: "hidden",
            }}
          >
            <button
              type="button"
              disabled={disabled}
              onPointerDown={() => window.getSelection()?.removeAllRanges()}
              onClick={() => handleContextClick(context)}
              title={`${t("chat.quotedContext")}: ${contextSummary(context.text)}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                minWidth: 0,
                flex: 1,
                padding: "0 6px 0 8px",
                border: "none",
                background: "transparent",
                color: "var(--text)",
                textAlign: "left",
                cursor: disabled ? "default" : "pointer",
                whiteSpace: "nowrap",
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ color: "var(--accent)", flexShrink: 0 }}>
                <path d="M9 7H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-2" />
                <path d="M14 3h7v7" />
                <path d="m21 3-9 9" />
              </svg>
              <span style={{ fontSize: 11.5, lineHeight: 1, fontWeight: 600 }}>
                {t("chat.quotedContextLabel", { count: index + 1 })}
              </span>
            </button>
          </div>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onRemove(context.id)}
            title={t("chat.removeQuotedContext")}
            aria-label={t("chat.removeQuotedContext")}
            style={{
              position: "absolute",
              top: -7,
              right: -7,
              zIndex: 1,
              display: "grid",
              width: 18,
              height: 18,
              padding: 0,
              placeItems: "center",
              border: "1px solid var(--border)",
              borderRadius: 999,
              background: "var(--bg-panel)",
              color: "var(--text-muted)",
              boxShadow: "0 1px 3px rgba(0, 0, 0, 0.2)",
              cursor: disabled ? "default" : "pointer",
              fontSize: 14,
              lineHeight: 1,
              opacity: activeContextId === itemId ? 1 : 0,
              pointerEvents: activeContextId === itemId ? "auto" : "none",
              transition: "opacity 120ms ease",
            }}
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
        );
      })}

      {sessionReferences.map((reference, index) => {
        const itemId = `session:${reference.id}`;
        return (
          <div
            key={itemId}
            onMouseEnter={() => setActiveContextId(itemId)}
            onMouseLeave={() => setActiveContextId((current) => current === itemId ? null : current)}
            onFocusCapture={() => setActiveContextId(itemId)}
            onBlurCapture={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) {
                setActiveContextId((current) => current === itemId ? null : current);
              }
            }}
            style={{
              position: "relative",
              display: "flex",
              alignItems: "center",
              minWidth: 0,
              maxWidth: "min(100%, 190px)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                minWidth: 0,
                height: 26,
                border: "1px solid color-mix(in srgb, var(--accent) 30%, var(--border))",
                borderRadius: 14,
                background: "color-mix(in srgb, var(--accent) 6%, var(--bg-panel))",
                overflow: "hidden",
              }}
            >
              <button
                type="button"
                disabled={disabled}
                onPointerDown={() => window.getSelection()?.removeAllRanges()}
                onClick={() => onOpenSessionReference?.(reference)}
                title={sessionSummary(reference)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  minWidth: 0,
                  flex: 1,
                  padding: "0 6px 0 8px",
                  border: "none",
                  background: "transparent",
                  color: "var(--text)",
                  textAlign: "left",
                  cursor: disabled || !onOpenSessionReference ? "default" : "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ color: "var(--accent)", flexShrink: 0 }}>
                  <path d="M9 7H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-2" />
                  <path d="M14 3h7v7" />
                  <path d="m21 3-9 9" />
                </svg>
                <span style={{ fontSize: 11.5, lineHeight: 1, fontWeight: 600 }}>
                  {t("chat.sessionReferenceLabel", { count: index + 1 })}
                </span>
              </button>
            </div>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onRemoveSessionReference?.(reference.id)}
              title={t("chat.removeSessionReference")}
              aria-label={t("chat.removeSessionReference")}
              style={{
                position: "absolute",
                top: -7,
                right: -7,
                zIndex: 1,
                display: "grid",
                width: 18,
                height: 18,
                padding: 0,
                placeItems: "center",
                border: "1px solid var(--border)",
                borderRadius: 999,
                background: "var(--bg-panel)",
                color: "var(--text-muted)",
                boxShadow: "0 1px 3px rgba(0, 0, 0, 0.2)",
                cursor: disabled ? "default" : "pointer",
                fontSize: 14,
                lineHeight: 1,
                opacity: activeContextId === itemId ? 1 : 0,
                pointerEvents: activeContextId === itemId ? "auto" : "none",
                transition: "opacity 120ms ease",
              }}
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
        );
      })}

    </div>
  );
}
