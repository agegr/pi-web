import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import type { ExtensionUiRequest, SelectOptionLike } from "../lib/types";

type ExtensionDialogRequest = Extract<
  ExtensionUiRequest,
  { method: "select" | "confirm" | "input" | "editor" }
>;

/** Response submitted to the parent: value is an array when multi-select. */
export type ExtensionDialogResponse =
  | { value: string | string[] }
  | { confirmed: boolean }
  | { cancelled: true };

/**
 * Normalize protocol options into the structured shape (accepts plain string arrays).
 * @param raw Protocol option list
 * @returns Structured option list
 */
function toOptions(
  raw: string[] | SelectOptionLike[] | undefined,
): SelectOptionLike[] {
  if (!raw || raw.length === 0) return [];
  return raw.map((option) =>
    typeof option === "string"
      ? { label: option }
      : { label: option.label, description: option.description },
  );
}

const radioMark = (checked: boolean, multi: boolean) => (
  <span
    style={{
      width: 16,
      height: 16,
      borderRadius: multi ? 4 : 8,
      border: `1.5px solid ${checked ? "var(--accent)" : "var(--border)"}`,
      background: checked ? "var(--accent)" : "transparent",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      flexShrink: 0,
      transition: "background 0.12s ease, border-color 0.12s ease",
    }}
  >
    {checked && (
      <svg
        width="10"
        height="10"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#fff"
        strokeWidth="3.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M20 6L9 17l-5-5" />
      </svg>
    )}
  </span>
);

/**
 * Codex-style inline prompt card rendered at the bottom of the message stream
 * (does not overlay history).
 *
 * Supports four shapes:
 * - select: option cards (single radio / multi checkbox) + search filter
 *   (shown when more than 6 options) + "Other" freeform entry + submit/cancel;
 * - confirm: confirmation card (yes/no buttons);
 * - input: single-line input (Enter submits);
 * - editor: multi-line input (Ctrl/Cmd+Enter submits).
 *
 * Interactions follow the agreed design: single and multi select both require
 * the "Submit" button or the Enter shortcut; "Other" is a fixed entry that
 * expands to an input; in multi-select its content is appended to the result.
 *
 * @param request Extension UI request (select/confirm/input/editor)
 * @param onRespond Submit/cancel callback
 */
export function ExtensionPromptCard({
  request,
  onRespond,
}: {
  request: ExtensionDialogRequest;
  onRespond: (
    request: ExtensionDialogRequest,
    response: ExtensionDialogResponse,
  ) => void;
}) {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const isSelect = request.method === "select";
  const multiSelect = isSelect && request.multiSelect === true;
  const allowFreeform = !isSelect || request.allowFreeform !== false;
  const options = useMemo(
    () => (isSelect ? toOptions(request.options) : []),
    [request, isSelect],
  );
  const showSearch = options.length > 6;

  // Option-related state
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [single, setSingle] = useState<string | null>(null);
  const [freeformOpen, setFreeformOpen] = useState(false);
  const [freeformText, setFreeformText] = useState("");
  const [searchText, setSearchText] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const [textValue, setTextValue] = useState(
    request.method === "editor" ? (request.prefill ?? "") : "",
  );

  const freeformRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Reset all state when the request (id) changes
  useEffect(() => {
    setSelected(new Set());
    setSingle(null);
    setFreeformOpen(false);
    setFreeformText("");
    setSearchText("");
    setActiveIndex(-1);
    setTextValue(request.method === "editor" ? (request.prefill ?? "") : "");
  }, [request]);

  // Search filter (select only, enabled when options are plentiful)
  const filtered = useMemo(() => {
    if (!searchText.trim()) return options;
    const query = searchText.trim().toLowerCase();
    return options.filter(
      (option) =>
        option.label.toLowerCase().includes(query) ||
        (option.description ?? "").toLowerCase().includes(query),
    );
  }, [options, searchText]);

  const freeformTextTrimmed = freeformText.trim();
  const hasSelection = multiSelect ? selected.size > 0 : single !== null;
  const canSubmit = isSelect
    ? hasSelection || (freeformOpen && freeformTextTrimmed.length > 0)
    : textValue.trim().length > 0;

  /** Build the submitted value: array for multi-select (Other text appended), string for single/input. */
  const buildValue = (): string | string[] => {
    if (!isSelect) return textValue;
    if (multiSelect) {
      const picked = [...selected];
      if (freeformOpen && freeformTextTrimmed) picked.push(freeformTextTrimmed);
      return picked;
    }
    if (freeformOpen && freeformTextTrimmed) return freeformTextTrimmed;
    return single ?? "";
  };

  const submit = () => {
    if (!canSubmit) return;
    if (request.method === "confirm") onRespond(request, { confirmed: true });
    else onRespond(request, { value: buildValue() });
  };

  const cancel = () => onRespond(request, { cancelled: true });

  const toggleOption = (label: string) => {
    if (multiSelect) {
      const next = new Set(selected);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      setSelected(next);
    } else {
      // Single-select: option and Other are mutually exclusive - picking an option closes the Other input and clears it
      setSingle(label);
      setFreeformOpen(false);
      setFreeformText("");
    }
  };

  const openFreeform = () => {
    if (!multiSelect) setSingle(null);
    setFreeformOpen(true);
    // Focus the input once it has rendered
    requestAnimationFrame(() => freeformRef.current?.focus());
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      cancel();
      return;
    }

    // Non-select shapes: handle Enter submission
    if (!isSelect) {
      if (event.key === "Enter") {
        if (request.method === "input") {
          event.preventDefault();
          submit();
        } else if (
          request.method === "editor" &&
          (event.metaKey || event.ctrlKey)
        ) {
          submit();
        }
      }
      return;
    }

    // Select shape
    const tag = (event.target as HTMLElement).tagName;
    if (tag === "INPUT" && freeformOpen) {
      // Inside the Other input: Enter submits, arrow keys stay with text editing
      if (event.key === "Enter") {
        event.preventDefault();
        submit();
      }
      return;
    }
    if (tag === "INPUT" && showSearch) return; // do not hijack arrow keys inside the search box

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((prev) => {
        const count = filtered.length + (allowFreeform ? 1 : 0);
        if (count === 0) return -1;
        const next =
          prev < 0
            ? delta > 0
              ? 0
              : count - 1
            : (prev + delta + count) % count;
        return next;
      });
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      // Expanding the Other entry opens the input; otherwise submit
      if (allowFreeform && activeIndex === filtered.length) {
        openFreeform();
      } else {
        submit();
      }
    }
  };

  const isFreeformActive = allowFreeform && activeIndex === filtered.length;

  return (
    <div
      role={request.method === "confirm" ? "alertdialog" : "dialog"}
      aria-modal="false"
      onKeyDown={handleKeyDown}
      style={{
        width: "100%",
        maxWidth: 560,
        margin: "10px 0 4px",
        borderRadius: 12,
        border: "1px solid var(--border)",
        background: "var(--bg)",
        boxShadow: "0 6px 24px rgba(0,0,0,0.10)",
        overflow: "hidden",
        outline: "none",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "12px 16px 10px",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 4,
          }}
        >
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--accent)",
            }}
          >
            {t("chat.promptCardLabel")}
          </span>
        </div>
        <div
          style={{
            color: "var(--text)",
            fontSize: 14,
            fontWeight: 600,
            lineHeight: 1.5,
          }}
        >
          {request.title}
        </div>
        {isSelect && request.context && (
          <div
            style={{
              marginTop: 4,
              color: "var(--text-muted)",
              fontSize: 12,
              lineHeight: 1.6,
              whiteSpace: "pre-wrap",
            }}
          >
            {request.context}
          </div>
        )}
      </div>

      {/* Body */}
      <div style={{ padding: "12px 16px" }}>
        {request.method === "confirm" && (
          <div
            style={{
              color: "var(--text-muted)",
              fontSize: 13,
              lineHeight: 1.7,
              whiteSpace: "pre-wrap",
            }}
          >
            {request.message}
          </div>
        )}

        {isSelect && (
          <div style={{ display: "grid", gap: 6 }}>
            {showSearch && (
              <input
                ref={searchRef}
                value={searchText}
                onChange={(event) => {
                  setSearchText(event.target.value);
                  setActiveIndex(-1);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setSearchText("");
                }}
                placeholder={t("chat.promptCardSearch")}
                style={{
                  width: "100%",
                  padding: isMobile ? "10px 12px" : "7px 10px",
                  marginBottom: 2,
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "var(--bg-panel)",
                  color: "var(--text)",
                  outline: "none",
                  fontSize: 13,
                }}
              />
            )}

            {filtered.length === 0 && (
              <div
                style={{
                  padding: "8px 2px",
                  color: "var(--text-dim)",
                  fontSize: 12,
                }}
              >
                {t("chat.promptCardNoMatch")}
              </div>
            )}

            {filtered.map((option, index) => {
              const checked = multiSelect
                ? selected.has(option.label)
                : single === option.label;
              const active = activeIndex === index;
              return (
                <button
                  key={option.label}
                  type="button"
                  onClick={() => toggleOption(option.label)}
                  onMouseEnter={() => setActiveIndex(index)}
                  aria-pressed={checked}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 10,
                    width: "100%",
                    padding: isMobile ? "11px 12px" : "9px 11px",
                    borderRadius: 8,
                    border: `1px solid ${checked ? "var(--accent)" : "var(--border)"}`,
                    background: checked
                      ? "color-mix(in srgb, var(--accent) 8%, var(--bg-panel))"
                      : "var(--bg-panel)",
                    color: "var(--text)",
                    cursor: "pointer",
                    textAlign: "left",
                    fontSize: 13,
                    outline: active
                      ? "2px solid color-mix(in srgb, var(--accent) 40%, transparent)"
                      : "none",
                    transition:
                      "border-color 0.12s ease, background 0.12s ease",
                  }}
                >
                  {radioMark(checked, multiSelect)}
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ display: "block", lineHeight: 1.45 }}>
                      {option.label}
                    </span>
                    {option.description && (
                      <span
                        style={{
                          display: "block",
                          marginTop: 2,
                          color: "var(--text-muted)",
                          fontSize: 12,
                          lineHeight: 1.5,
                        }}
                      >
                        {option.description}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}

            {/* Other entry */}
            {allowFreeform && (
              <>
                {!freeformOpen ? (
                  <button
                    type="button"
                    onClick={openFreeform}
                    onMouseEnter={() => setActiveIndex(filtered.length)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      width: "100%",
                      padding: isMobile ? "10px 12px" : "7px 11px",
                      marginTop: 2,
                      borderRadius: 8,
                      border: `1px dashed ${isFreeformActive ? "var(--accent)" : "var(--border)"}`,
                      background: "transparent",
                      color: "var(--text-muted)",
                      cursor: "pointer",
                      textAlign: "left",
                      fontSize: 13,
                      outline: "none",
                    }}
                  >
                    <span style={{ fontSize: 14, lineHeight: 1 }}>＋</span>
                    {t("chat.promptCardOther")}
                  </button>
                ) : (
                  <input
                    ref={freeformRef}
                    value={freeformText}
                    onChange={(event) => setFreeformText(event.target.value)}
                    placeholder={t("chat.promptCardOtherPlaceholder")}
                    style={{
                      width: "100%",
                      padding: isMobile ? "10px 12px" : "8px 10px",
                      marginTop: 2,
                      borderRadius: 8,
                      border: "1px solid var(--accent)",
                      background: "var(--bg-panel)",
                      color: "var(--text)",
                      outline: "none",
                      fontSize: 13,
                    }}
                  />
                )}
              </>
            )}

            {multiSelect &&
              (selected.size > 0 || (freeformOpen && freeformTextTrimmed)) && (
                <div
                  style={{
                    padding: "6px 2px 0",
                    color: "var(--text-muted)",
                    fontSize: 12,
                  }}
                >
                  {t("chat.promptCardSelected", {
                    count:
                      selected.size +
                      (freeformOpen && freeformTextTrimmed ? 1 : 0),
                  })}
                </div>
              )}
          </div>
        )}

        {request.method === "input" && (
          <input
            autoFocus
            value={textValue}
            placeholder={request.placeholder}
            onChange={(event) => setTextValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") submit();
            }}
            style={{
              width: "100%",
              padding: isMobile ? "11px 12px" : "9px 10px",
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "var(--bg-panel)",
              color: "var(--text)",
              outline: "none",
              fontSize: 13,
            }}
          />
        )}

        {request.method === "editor" && (
          <textarea
            autoFocus
            value={textValue}
            onChange={(event) => setTextValue(event.target.value)}
            style={{
              width: "100%",
              minHeight: 220,
              padding: 10,
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "var(--bg-panel)",
              color: "var(--text)",
              outline: "none",
              resize: "vertical",
              fontSize: 13,
              lineHeight: 1.55,
              fontFamily: "var(--font-mono)",
            }}
          />
        )}
      </div>

      {/* Footer actions */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          padding: "10px 16px",
          borderTop: "1px solid var(--border)",
          background: "var(--bg-panel)",
        }}
      >
        {!isMobile && (
          <span
            style={{
              color: "var(--text-dim)",
              fontSize: 11,
              fontFamily: "var(--font-mono)",
            }}
          >
            {t("chat.promptCardHint")}
          </span>
        )}
        <div style={{ display: "flex", gap: 8, ...(isMobile ? { marginLeft: "auto" } : {}) }}>
          <button
            type="button"
            onClick={cancel}
            style={{
              padding: isMobile ? "9px 14px" : "6px 12px",
              borderRadius: 7,
              border: "1px solid var(--border)",
              background: "var(--bg)",
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            {t("chat.cancel")}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            style={{
              padding: isMobile ? "9px 16px" : "6px 14px",
              borderRadius: 7,
              border: "none",
              background: "var(--accent)",
              color: "#fff",
              cursor: canSubmit ? "pointer" : "not-allowed",
              opacity: canSubmit ? 1 : 0.45,
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {request.method === "confirm"
              ? t("chat.confirm")
              : t("chat.submit")}
          </button>
        </div>
      </div>
    </div>
  );
}
