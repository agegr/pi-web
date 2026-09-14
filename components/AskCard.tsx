"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MarkdownBody } from "./MarkdownBody";
import { useI18n } from "@/hooks/useI18n";
import type { StructuredAskAnswer, StructuredAskSpec } from "@/lib/structured-ask";

/**
 * Native question form for a structured ask (see lib/structured-ask.ts).
 *
 * Pointer first: every action is a tap target that works on a phone. Keyboard
 * support is a second layer on top of real buttons and inputs.
 */

const ROW_MIN_HEIGHT = 48;

function rowStyle(selected: boolean, first: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
    width: "100%",
    minHeight: ROW_MIN_HEIGHT,
    padding: "10px 12px",
    textAlign: "left",
    background: selected ? "var(--accent-soft, rgba(99,102,241,0.12))" : "transparent",
    color: "var(--text)",
    border: "none",
    borderTop: first ? "none" : "1px solid var(--border)",
    cursor: "pointer",
    font: "inherit",
  };
}

function badgeStyle(selected: boolean): React.CSSProperties {
  return {
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
    width: 26,
    height: 26,
    borderRadius: 6,
    border: `1px solid ${selected ? "var(--accent)" : "var(--border)"}`,
    background: selected ? "var(--accent)" : "var(--bg-panel)",
    color: selected ? "var(--accent-contrast)" : "var(--text-dim)",
    fontSize: 12,
    fontVariantNumeric: "tabular-nums",
  };
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="2 6.5 4.8 9 10 3" />
    </svg>
  );
}

export function AskCard({
  ask,
  onSubmit,
  onCancel,
  onShowRaw,
}: {
  ask: StructuredAskSpec;
  onSubmit: (answer: StructuredAskAnswer) => void;
  onCancel: () => void;
  onShowRaw?: () => void;
}) {
  const { t } = useI18n();
  const [selected, setSelected] = useState<string[]>([]);
  const [freeform, setFreeform] = useState("");
  const [comment, setComment] = useState("");
  const [contextOpen, setContextOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  // Minimized, not dismissed: the question stays open while the user reads the
  // conversation behind it. Only Skip cancels.
  const [minimized, setMinimized] = useState(false);
  const rowsRef = useRef<HTMLDivElement>(null);
  const commentRef = useRef<HTMLTextAreaElement>(null);

  const needsFooter = ask.allowMultiple || ask.allowComment;
  const freeformText = freeform.trim();
  const canSubmit = freeformText.length > 0 || selected.length > 0;

  const answer = useMemo<StructuredAskAnswer | null>(() => {
    // Multi-select treats typed text as one more answer, so a custom entry and
    // checked options travel together. Single-select allows one answer only, so
    // the two clear each other.
    const selections = ask.allowMultiple && freeformText
      ? [...selected, freeformText]
      : selected;
    if (selections.length === 0) {
      return freeformText ? { kind: "freeform", text: freeformText } : null;
    }
    const trimmedComment = comment.trim();
    return trimmedComment && ask.allowComment
      ? { kind: "selection", selections, comment: trimmedComment }
      : { kind: "selection", selections };
  }, [ask.allowComment, ask.allowMultiple, comment, freeformText, selected]);

  const submit = (value: StructuredAskAnswer | null) => {
    if (!value || submitted) return;
    setSubmitted(true);
    onSubmit(value);
  };

  const chooseOption = (title: string) => {
    if (ask.allowMultiple) {
      setSelected((current) =>
        current.includes(title) ? current.filter((entry) => entry !== title) : [...current, title],
      );
      return;
    }
    setSelected([title]);
    setFreeform("");
    // A single choice with nothing left to add is the answer itself.
    if (!ask.allowComment) submit({ kind: "selection", selections: [title] });
  };

  useEffect(() => {
    if (ask.allowComment && selected.length > 0) commentRef.current?.focus();
  }, [ask.allowComment, selected.length]);


  /** Arrow keys walk the option rows; digits pick one; Escape dismisses. */
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setMinimized(true);
      return;
    }
    const target = event.target as HTMLElement;
    const typing = target.tagName === "INPUT" || target.tagName === "TEXTAREA";

    if (!typing && /^[1-9]$/.test(event.key)) {
      const option = ask.options[Number(event.key) - 1];
      if (option) {
        event.preventDefault();
        chooseOption(option.title);
      }
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const rows = Array.from(rowsRef.current?.querySelectorAll<HTMLButtonElement>("[data-ask-option]") ?? []);
    if (rows.length === 0) return;
    event.preventDefault();
    const current = rows.indexOf(document.activeElement as HTMLButtonElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    const next = current === -1 ? 0 : (current + step + rows.length) % rows.length;
    rows[next]?.focus();
  };

  return (
    <div
      style={{
        position: "absolute",
        insetInline: 0,
        bottom: 0,
        zIndex: 95,
        display: "flex",
        justifyContent: "center",
        padding: 12,
        pointerEvents: "none",
      }}
    >
      {minimized ? (
        <button
          type="button"
          onClick={() => setMinimized(false)}
          aria-expanded={false}
          style={{
            pointerEvents: "auto",
            display: "flex",
            alignItems: "center",
            gap: 10,
            width: "min(820px, 100%)",
            minHeight: 44,
            padding: "8px 12px",
            border: "1px solid var(--border)",
            borderRadius: 10,
            background: "var(--bg)",
            boxShadow: "0 12px 32px rgba(0,0,0,0.18)",
            color: "var(--text)",
            cursor: "pointer",
            textAlign: "left",
            font: "inherit",
          }}
        >
          <span style={{ fontSize: 11, fontWeight: 650, color: "var(--accent)", flexShrink: 0 }}>
            {t("chat.askTitle")}
          </span>
          <span style={{ flex: 1, minWidth: 0, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {ask.question}
          </span>
          <span style={{ fontSize: 12, color: "var(--text-muted)", flexShrink: 0 }}>
            {t("chat.askExpand")}
          </span>
        </button>
      ) : (
      <div
        role="dialog"
        aria-label={t("chat.askTitle")}
        onKeyDown={handleKeyDown}
        style={{
          pointerEvents: "auto",
          width: "min(820px, 100%)",
          maxHeight: "min(70vh, 620px)",
          display: "flex",
          flexDirection: "column",
          border: "1px solid var(--border)",
          borderRadius: 12,
          background: "var(--bg)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.28)",
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "12px 12px 8px 14px" }}>
          <div style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 600, color: "var(--text)" }}>
            <MarkdownBody>{ask.question}</MarkdownBody>
          </div>
          {onShowRaw && (
            <button
              type="button"
              onClick={onShowRaw}
              title={t("chat.askShowRaw")}
              aria-label={t("chat.askShowRaw")}
              style={{
                display: "grid",
                placeItems: "center",
                width: 32,
                height: 32,
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "var(--bg-panel)",
                color: "var(--text-dim)",
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
              </svg>
            </button>
          )}
          <button
            type="button"
            onClick={() => setMinimized(true)}
            aria-expanded={true}
            title={t("chat.askMinimize")}
            aria-label={t("chat.askMinimize")}
            style={{
              display: "grid",
              placeItems: "center",
              width: 32,
              height: 32,
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "var(--bg-panel)",
              color: "var(--text-dim)",
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="2 4 6 8 10 4" />
            </svg>
          </button>
        </div>

        {ask.context && (
          <div style={{ padding: "0 14px 8px" }}>
            <button
              type="button"
              onClick={() => setContextOpen((open) => !open)}
              aria-expanded={contextOpen}
              style={{
                padding: "4px 0",
                border: "none",
                background: "none",
                color: "var(--text-dim)",
                cursor: "pointer",
                fontSize: 12,
              }}
            >
              {contextOpen ? t("chat.askHideContext") : t("chat.askShowContext")}
            </button>
            {contextOpen && (
              <div style={{ fontSize: 13, color: "var(--text-muted)", maxHeight: 200, overflow: "auto" }}>
                <MarkdownBody>{ask.context}</MarkdownBody>
              </div>
            )}
          </div>
        )}

        <div ref={rowsRef} style={{ minHeight: 0, overflow: "auto", borderTop: "1px solid var(--border)" }}>
          {ask.options.map((option, index) => {
            const isSelected = selected.includes(option.title);
            return (
              <button
                key={option.title}
                type="button"
                data-ask-option
                aria-pressed={isSelected}
                onClick={() => chooseOption(option.title)}
                style={rowStyle(isSelected, index === 0)}
              >
                <span aria-hidden="true" style={badgeStyle(isSelected)}>
                  {ask.allowMultiple ? (isSelected ? <CheckIcon /> : "") : index + 1}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 14, color: "var(--text)" }}>{option.title}</span>
                  {option.description && (
                    <span style={{ display: "block", marginTop: 2, fontSize: 12, color: "var(--text-dim)" }}>
                      {option.description}
                    </span>
                  )}
                </span>
              </button>
            );
          })}

          {ask.allowFreeform && (
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 12px", borderTop: "1px solid var(--border)", minHeight: ROW_MIN_HEIGHT }}>
              <span aria-hidden="true" style={badgeStyle(false)}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                </svg>
              </span>
              <input
                value={freeform}
                onChange={(event) => {
                  setFreeform(event.target.value);
                  if (!ask.allowMultiple && event.target.value.trim()) setSelected([]);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
                  event.preventDefault();
                  submit(answer);
                }}
                placeholder={t("chat.askFreeformPlaceholder")}
                aria-label={t("chat.askFreeformPlaceholder")}
                style={{
                  flex: 1,
                  minWidth: 0,
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "var(--bg-panel)",
                  color: "var(--text)",
                  fontSize: 14,
                  outline: "none",
                }}
              />
            </div>
          )}
        </div>

        {ask.allowComment && answer !== null && (
          <div style={{ padding: "10px 12px 0", borderTop: "1px solid var(--border)" }}>
            <textarea
              ref={commentRef}
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              placeholder={t("chat.askCommentPlaceholder")}
              aria-label={t("chat.askCommentPlaceholder")}
              rows={2}
              style={{
                width: "100%",
                padding: "8px 10px",
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "var(--bg-panel)",
                color: "var(--text)",
                fontSize: 14,
                resize: "vertical",
                outline: "none",
              }}
            />
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, padding: "10px 12px" }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              padding: "8px 12px",
              minHeight: 38,
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "var(--bg-panel)",
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            {t("chat.askSkip")}
          </button>
          {(needsFooter || freeformText.length > 0) && (
            <button
              type="button"
              onClick={() => submit(answer)}
              disabled={!canSubmit}
              style={{
                padding: "8px 14px",
                minHeight: 38,
                borderRadius: 8,
                border: `1px solid ${canSubmit ? "var(--accent)" : "var(--border)"}`,
                background: canSubmit ? "var(--accent)" : "var(--bg-panel)",
                color: canSubmit ? "var(--accent-contrast)" : "var(--text-dim)",
                cursor: canSubmit ? "pointer" : "default",
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              {ask.allowMultiple && answer?.kind === "selection"
                ? t("chat.askSubmitCount", { count: answer.selections.length })
                : t("chat.askSubmit")}
            </button>
          )}
        </div>
      </div>
      )}
    </div>
  );
}
