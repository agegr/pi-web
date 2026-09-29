"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";

export interface ModelSelectorOption {
  provider: string;
  modelId: string;
  name: string;
}

interface ModelSelectorProps {
  options: ModelSelectorOption[];
  value?: { provider: string; modelId: string } | null;
  onChange: (provider: string, modelId: string) => void;
  onClear?: () => void;
  emptyLabel?: string;
  selectedLabel?: string;
  disabled?: boolean;
  busy?: boolean;
  isAutoSelection?: boolean;
  ariaLabel?: string;
  variant?: "toolbar" | "field";
  placement?: "up" | "auto";
}

const MODEL_FILTER_THRESHOLD = 8;
const MODEL_OPTION_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function compareModelOptions(a: ModelSelectorOption, b: ModelSelectorOption): number {
  return MODEL_OPTION_COLLATOR.compare(a.name || a.modelId, b.name || b.modelId)
    || MODEL_OPTION_COLLATOR.compare(a.provider, b.provider)
    || MODEL_OPTION_COLLATOR.compare(a.modelId, b.modelId);
}

export function filterModelOptions(options: ModelSelectorOption[], query: string): ModelSelectorOption[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return options;

  return options.filter((option) => (
    `${option.name} ${option.modelId}`
      .toLocaleLowerCase()
      .includes(normalizedQuery)
  ));
}

export function ModelSelector({
  options,
  value,
  onChange,
  onClear,
  emptyLabel,
  selectedLabel,
  disabled = false,
  busy = false,
  isAutoSelection = false,
  ariaLabel,
  variant = "toolbar",
  placement = "up",
}: ModelSelectorProps) {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<{ top: number; right: number; bottom: number; left: number; width: number } | null>(null);
  const [filter, setFilter] = useState("");
  const locked = disabled || busy;
  const sortedOptions = useMemo(() => [...options].sort(compareModelOptions), [options]);
  const filteredOptions = filterModelOptions(sortedOptions, filter);
  const showFilter = sortedOptions.length > MODEL_FILTER_THRESHOLD;
  const modelsByProvider: { provider: string; options: ModelSelectorOption[] }[] = [];

  for (const option of filteredOptions) {
    const group = modelsByProvider.find((item) => item.provider === option.provider);
    if (group) group.options.push(option);
    else modelsByProvider.push({ provider: option.provider, options: [option] });
  }

  const currentName = selectedLabel ?? (value
    ? sortedOptions.find((option) => option.modelId === value.modelId && option.provider === value.provider)?.name ?? value.modelId
    : emptyLabel ?? (sortedOptions.length > 0 ? "Select model" : "No models"));

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (
        rootRef.current && !rootRef.current.contains(event.target as Node)
        && panelRef.current && !panelRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
        setFilter("");
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  useEffect(() => {
    if (!locked) return;
    setOpen(false);
    setFilter("");
  }, [locked]);

  const buttonStyle: CSSProperties = variant === "field"
    ? {
        display: "flex",
        alignItems: "center",
        gap: 7,
        width: "100%",
        minWidth: 0,
        height: 34,
        padding: "0 9px",
        overflow: "hidden",
        border: "1px solid var(--border)",
        borderRadius: 5,
        background: locked ? "var(--bg-panel)" : "var(--bg)",
        color: locked ? "var(--text-dim)" : "var(--text)",
        cursor: locked ? "default" : "pointer",
        fontSize: 12,
        textAlign: "left",
      }
    : {
        display: "flex",
        alignItems: "center",
        justifyContent: isMobile ? "flex-start" : undefined,
        gap: 6,
        width: isMobile ? "100%" : undefined,
        maxWidth: isMobile ? "100%" : 220,
        height: 32,
        padding: isMobile ? "8px 10px" : "8px 12px",
        overflow: "hidden",
        border: "none",
        borderRadius: 9,
        background: open ? "var(--bg-hover)" : "none",
        color: "var(--text-muted)",
        cursor: locked ? "not-allowed" : "pointer",
        fontSize: 12,
        opacity: locked ? 0.5 : 1,
        transition: "background 0.12s, color 0.12s",
      };

  const choose = (option: ModelSelectorOption) => {
    const active = option.modelId === value?.modelId && option.provider === value?.provider;
    setOpen(false);
    setFilter("");
    if (!active || isAutoSelection) onChange(option.provider, option.modelId);
  };

  return (
    <div
      ref={rootRef}
      className={`model-selector is-${variant}${locked ? " is-disabled" : ""}`}
      style={{ position: "relative", width: variant === "field" || isMobile ? "100%" : undefined, minWidth: 0, flex: variant === "toolbar" && isMobile ? "1 1 auto" : undefined }}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !open) return;
        event.preventDefault();
        event.stopPropagation();
        setFilter("");
        setOpen(false);
      }}
    >
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-busy={busy || undefined}
        disabled={locked}
        title={busy ? "Switching model" : locked ? currentName : sortedOptions.length > 0 || onClear ? "Change model" : "No available models"}
        style={buttonStyle}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setAnchorRect({ top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left, width: rect.width });
          setOpen((current) => {
            if (current) setFilter("");
            return !current;
          });
        }}
        onMouseEnter={(event) => {
          if (locked) return;
          event.currentTarget.style.background = "var(--bg-hover)";
          event.currentTarget.style.color = "var(--text)";
        }}
        onMouseLeave={(event) => {
          if (locked) {
            event.currentTarget.style.background = variant === "field" ? "var(--bg-panel)" : "none";
            event.currentTarget.style.color = variant === "field" ? "var(--text-dim)" : "var(--text-muted)";
            return;
          }
          event.currentTarget.style.background = open ? "var(--bg-hover)" : variant === "field" ? "var(--bg)" : "none";
          event.currentTarget.style.color = variant === "field" ? "var(--text)" : "var(--text-muted)";
        }}
      >
        {busy ? (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" style={{ animation: "spin 0.8s linear infinite", flexShrink: 0 }} aria-hidden="true">
            <path d="M21 12a9 9 0 1 1-2.64-6.36" />
          </svg>
        ) : (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
            <rect x="4" y="4" width="16" height="16" rx="2" />
            <rect x="9" y="9" width="6" height="6" />
            <line x1="9" y1="1" x2="9" y2="4" /><line x1="15" y1="1" x2="15" y2="4" />
            <line x1="9" y1="20" x2="9" y2="23" /><line x1="15" y1="20" x2="15" y2="23" />
            <line x1="20" y1="9" x2="23" y2="9" /><line x1="20" y1="14" x2="23" y2="14" />
            <line x1="1" y1="9" x2="4" y2="9" /><line x1="1" y1="14" x2="4" y2="14" />
          </svg>
        )}
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{currentName}</span>
        {variant === "field" && (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, color: "var(--text-dim)" }}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        )}
      </button>

      {open && anchorRect && (() => {
        const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
        const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
        const spaceAbove = anchorRect.top - 8;
        const spaceBelow = viewportHeight - anchorRect.bottom - 8;
        const openAbove = placement === "up" || spaceAbove > spaceBelow;
        const maxHeight = Math.max(120, Math.min(openAbove ? spaceAbove : spaceBelow, viewportHeight * 0.6));
        const verticalPosition = openAbove
          ? { bottom: viewportHeight - anchorRect.top + 6 }
          : { top: anchorRect.bottom + 6 };
        const horizontalPosition: CSSProperties = isMobile
          ? { left: 8, right: 8, maxWidth: "calc(100vw - 16px)" }
          : { left: anchorRect.left, width: "max-content", minWidth: anchorRect.width, maxWidth: Math.max(anchorRect.width, viewportWidth - anchorRect.left - 8) };

        return (
          <div
            ref={panelRef}
            role="listbox"
            aria-label={ariaLabel}
            style={{
              position: "fixed",
              ...verticalPosition,
              ...horizontalPosition,
              zIndex: 500,
              display: "flex",
              flexDirection: "column",
              maxHeight,
              overflow: "hidden",
              border: "1px solid var(--border)",
              borderRadius: 8,
              background: "var(--bg)",
              boxShadow: openAbove ? "0 -4px 16px rgba(0,0,0,0.10)" : "0 4px 16px rgba(0,0,0,0.10)",
            }}
          >
            {showFilter && (
              <div style={{ flexShrink: 0, padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>
                <input
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                  placeholder={t("chat.filterModels")}
                  aria-label={t("chat.filterModels")}
                  autoFocus
                  autoComplete="off"
                  spellCheck={false}
                  style={{
                    boxSizing: "border-box",
                    width: "100%",
                    minWidth: isMobile ? 0 : 220,
                    padding: "5px 8px",
                    border: "1px solid var(--border)",
                    borderRadius: 5,
                    outline: "none",
                    background: "var(--bg)",
                    color: "var(--text)",
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                  }}
                />
              </div>
            )}
            <div style={{ minHeight: 0, overflowY: "auto" }}>
              {onClear && !filter.trim() && (
                <ModelOptionButton active={!value} label={emptyLabel ?? "Default"} onClick={() => {
                  setOpen(false);
                  setFilter("");
                  onClear();
                }} />
              )}
              {modelsByProvider.length === 0 ? (
                <div style={{ padding: "8px 12px", color: "var(--text-dim)", fontSize: 12, whiteSpace: "nowrap" }}>
                  {filter.trim() ? t("chat.noMatchingModels") : "No available models"}
                </div>
              ) : modelsByProvider.map((group, index) => (
                <div key={group.provider}>
                  {modelsByProvider.length > 1 && (
                    <div style={{ padding: "6px 12px 4px", borderTop: index > 0 || onClear ? "1px solid var(--border)" : "none", color: "var(--text-dim)", fontSize: 10, fontWeight: 600, letterSpacing: 0, textTransform: "uppercase" }}>
                      {group.provider}
                    </div>
                  )}
                  {group.options.map((option) => (
                    <ModelOptionButton
                      key={`${option.provider}:${option.modelId}`}
                      active={option.modelId === value?.modelId && option.provider === value?.provider}
                      label={option.name}
                      onClick={() => choose(option)}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function ModelOptionButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onClick={onClick}
      style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "7px 12px", border: "none", background: active ? "var(--bg-selected)" : "none", color: active ? "var(--text)" : "var(--text-muted)", cursor: "pointer", fontSize: 12, fontWeight: active ? 600 : 400, textAlign: "left", whiteSpace: "nowrap" }}
      onMouseEnter={(event) => { if (!active) event.currentTarget.style.background = "var(--bg-hover)"; }}
      onMouseLeave={(event) => { if (!active) event.currentTarget.style.background = "none"; }}
    >
      {active
        ? <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }} aria-hidden="true"><polyline points="1.5 5 4 7.5 8.5 2.5" /></svg>
        : <span style={{ width: 10, flexShrink: 0 }} />}
      <span title={label} style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
    </button>
  );
}
