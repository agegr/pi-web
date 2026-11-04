"use client";

import { useEffect, useImperativeHandle, useRef, useState, type CSSProperties, type Ref } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import { listenForPanelEscape } from "@/lib/stacked-dialog";
import { SelectorRow } from "./SelectorRow";

export interface ModelSelectorOption {
  provider: string;
  /** The provider's display name; falls back to `provider` in the group heading. */
  providerName?: string;
  modelId: string;
  name: string;
}

/** Opens the picker from elsewhere: the composer's `/model` with no exact match. */
export interface ModelSelectorHandle {
  /** False while the trigger is not laid out (a phone keyboard hides its row) or locked. */
  open: (filter?: string) => boolean;
  /** Closes an open picker; false when it was not open. The composer's Esc, where focus stays after `/model`. */
  close: () => boolean;
}

/**
 * The option a `/model <reference>` names, as pi's `findExactModelReferenceMatch()`
 * reads it without fuzzy matching: `provider/id` on that provider, else an id
 * (case-insensitive) that only one provider has. Anything else opens the
 * picker filtered by the text, as pi's `/model` does.
 */
export function findExactModelOption(reference: string, options: ModelSelectorOption[]): ModelSelectorOption | undefined {
  const text = reference.trim().toLowerCase();
  if (!text) return undefined;
  const slash = text.indexOf("/");
  if (slash > 0) {
    const provider = text.slice(0, slash);
    const id = text.slice(slash + 1);
    const named = options.find((option) => option.provider.toLowerCase() === provider && option.modelId.toLowerCase() === id);
    if (named) return named;
  }
  const raw = options.filter((option) => option.modelId.toLowerCase() === text);
  return raw.length > 0 && new Set(raw.map((option) => option.provider)).size === 1 ? raw[0] : undefined;
}

export interface ModelSelectorGroup {
  provider: string;
  providerName: string;
  options: ModelSelectorOption[];
}

interface ModelSelectorProps {
  options: ModelSelectorOption[];
  value?: { provider: string; modelId: string } | null;
  onChange: (provider: string, modelId: string) => void;
  /** Live sessions can reapply saved metadata by choosing their current model again. */
  onReselect?: (provider: string, modelId: string) => void;
  onClear?: () => void;
  emptyLabel?: string;
  selectedLabel?: string;
  disabled?: boolean;
  busy?: boolean;
  isAutoSelection?: boolean;
  ariaLabel?: string;
  variant?: "toolbar" | "field";
  placement?: "up" | "auto";
  /** The model new sessions start with; its row gets a filled star. */
  defaultValue?: { provider: string; modelId: string } | null;
  /** Shows a star on every row that saves it as the default. */
  onSetDefault?: (provider: string, modelId: string) => void;
  /** Every available model, once loaded; listed under "all". */
  allOptions?: ModelSelectorOption[] | null;
  /** Set only while `enabledModels` narrows `options`: shows pi's `/model` "scoped | all" row and loads `allOptions`. */
  onShowAll?: () => void;
  handleRef?: Ref<ModelSelectorHandle>;
}

const MODEL_FILTER_THRESHOLD = 8;

export function filterModelOptions(options: ModelSelectorOption[], query: string): ModelSelectorOption[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return options;

  return options.filter((option) => (
    `${option.name} ${option.providerName ?? ""} ${option.modelId} ${option.provider}/${option.modelId}`
      .toLocaleLowerCase()
      .includes(normalizedQuery)
  ));
}

/** Groups in first-appearance order; never re-sorts, so a models.json provider keeps its file's order (#783). */
export function groupModelOptions(options: ModelSelectorOption[]): ModelSelectorGroup[] {
  const groups: ModelSelectorGroup[] = [];
  for (const option of options) {
    const existing = groups.find((group) => group.provider === option.provider);
    if (existing) {
      existing.options.push(option);
      if (existing.providerName === existing.provider && option.providerName?.trim()) {
        existing.providerName = option.providerName.trim();
      }
    } else {
      groups.push({
        provider: option.provider,
        providerName: option.providerName?.trim() || option.provider,
        options: [option],
      });
    }
  }
  return groups;
}

export function ModelSelector({
  options,
  value,
  onChange,
  onReselect,
  onClear,
  emptyLabel,
  selectedLabel,
  disabled = false,
  busy = false,
  isAutoSelection = false,
  ariaLabel,
  variant = "toolbar",
  placement = "up",
  defaultValue,
  onSetDefault,
  allOptions,
  onShowAll,
  handleRef,
}: ModelSelectorProps) {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<{ top: number; right: number; bottom: number; left: number; width: number } | null>(null);
  const [filter, setFilter] = useState("");
  // pi's /model starts on the scope; Tab on the filter or a tap switches.
  const [showAll, setShowAll] = useState(false);
  // Opened by `/model <text>`: its filter field shows even in a short list, and
  // stays while that text is cleared. Each way of opening sets it.
  const [filterGiven, setFilterGiven] = useState(false);
  const locked = disabled || busy;
  const listed = showAll ? allOptions : options;
  // Options arrive in pi's /model order (orderSelectorModels()); never re-sort
  // them, or a models.json provider loses the order its file gives (#783).
  const filteredOptions = filterModelOptions(listed ?? [], filter);
  const showFilter = Boolean(onShowAll) || options.length > MODEL_FILTER_THRESHOLD || filterGiven;
  const isListed = (list: ModelSelectorOption[] | null | undefined, ref: { provider: string; modelId: string }) => (
    list?.find((option) => option.modelId === ref.modelId && option.provider === ref.provider)
  );
  const switchScope = () => {
    if (!showAll) onShowAll?.();
    setShowAll(!showAll);
  };
  const modelsByProvider = groupModelOptions(filteredOptions);

  useImperativeHandle(handleRef, () => ({
    open(initialFilter = "") {
      if (locked) return false;
      const rect = rootRef.current?.querySelector("button")?.getBoundingClientRect();
      if (!rect?.height) return false;
      setAnchorRect({ top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left, width: rect.width });
      setShowAll(false);
      setFilter(initialFilter);
      setFilterGiven(initialFilter !== "");
      setOpen(true);
      return true;
    },
    close() {
      if (!open) return false;
      setOpen(false);
      setFilter("");
      return true;
    },
  }), [locked, open]);

  const currentName = selectedLabel ?? (value
    ? (isListed(options, value) ?? isListed(allOptions, value))?.name ?? value.modelId
    : emptyLabel ?? (options.length > 0 ? t("chat.selectModel") : t("chat.noModels")));

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

  // Esc closes the picker wherever the focus is, not only inside it (the root's
  // onKeyDown): a phone's `/model` blurs the composer first, so its Esc reaches
  // only `document`, and unhandled there it would stop the run.
  useEffect(() => {
    if (!open) return;
    return listenForPanelEscape(document, () => {
      setOpen(false);
      setFilter("");
    });
  }, [open]);

  // While the picker is open, a phone keyboard shrinks the app height
  // (useViewportHeight writes the root's style, sometimes with no viewport
  // event) and moves the trigger; follow it instead of the rect from the tap.
  useEffect(() => {
    if (!open) return;
    const remeasure = () => {
      const rect = rootRef.current?.querySelector("button")?.getBoundingClientRect();
      // A new object even for an unmoved trigger: the panel also reads the
      // visual viewport, which may have changed alone.
      if (rect?.height) setAnchorRect({ top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left, width: rect.width });
    };
    const viewport = window.visualViewport;
    const rootObserver = new MutationObserver(remeasure);
    rootObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "data-keyboard-open"] });
    window.addEventListener("resize", remeasure);
    viewport?.addEventListener("resize", remeasure);
    viewport?.addEventListener("scroll", remeasure);
    return () => {
      rootObserver.disconnect();
      window.removeEventListener("resize", remeasure);
      viewport?.removeEventListener("resize", remeasure);
      viewport?.removeEventListener("scroll", remeasure);
    };
  }, [open]);

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
        // As tall as ChatInput's other controls: 44px on a phone.
        height: isMobile ? 44 : 32,
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
    else onReselect?.(option.provider, option.modelId);
  };

  const saveDefault = (option: ModelSelectorOption) => {
    setOpen(false);
    setFilter("");
    onSetDefault?.(option.provider, option.modelId);
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
        title={busy ? t("chat.switchingModel") : locked ? currentName : options.length > 0 || onClear ? t("chat.changeModel") : t("chat.noAvailableModels")}
        style={buttonStyle}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setAnchorRect({ top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left, width: rect.width });
          setOpen((current) => {
            if (current) {
              setFilter("");
            } else {
              setShowAll(false);
              setFilterGiven(false);
            }
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
        // Fixed coordinates belong to the layout viewport, which a phone
        // keyboard does not shrink: measure from the visible part's top and
        // hang an upward panel from `top` rather than from `bottom`.
        const viewportTop = window.visualViewport?.offsetTop ?? 0;
        const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
        const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
        // A trigger the keyboard covers (a Settings field) still gets a
        // panel ending above the keyboard.
        const aboveEnd = Math.min(anchorRect.top - 6, viewportTop + viewportHeight - 8);
        const spaceAbove = aboveEnd - viewportTop - 8;
        const spaceBelow = viewportTop + viewportHeight - anchorRect.bottom - 6 - 8;
        const openAbove = placement === "up" || spaceAbove > spaceBelow;
        const maxHeight = Math.max(120, Math.min(openAbove ? spaceAbove : spaceBelow, viewportHeight * 0.6));
        const verticalPosition: CSSProperties = openAbove
          ? { top: aboveEnd, transform: "translateY(-100%)" }
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
            {onShowAll && (
              <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 8px 0", fontSize: 11 }}>
                {[false, true].map((all) => (
                  <button
                    key={String(all)}
                    type="button"
                    aria-pressed={showAll === all}
                    onClick={() => { if (showAll !== all) switchScope(); }}
                    style={{
                      padding: "2px 7px",
                      border: "1px solid",
                      borderColor: showAll === all ? "var(--border)" : "transparent",
                      borderRadius: 4,
                      background: showAll === all ? "var(--bg-hover)" : "none",
                      color: showAll === all ? "var(--text)" : "var(--text-muted)",
                      cursor: "pointer",
                      fontSize: 11,
                    }}
                  >
                    {t(all ? "chat.modelScopeAll" : "chat.modelScopeScoped")}
                  </button>
                ))}
                {!isMobile && <span style={{ marginLeft: "auto", color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: 10 }}>Tab</span>}
              </div>
            )}
            {showFilter && (
              <div style={{ flexShrink: 0, padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>
                <input
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                  onKeyDown={(event) => {
                    if (!onShowAll || event.key !== "Tab") return;
                    event.preventDefault();
                    switchScope();
                  }}
                  placeholder={t("chat.filterModels")}
                  aria-label={t("chat.filterModels")}
                  // On phones, focusing the filter opens the on-screen keyboard,
                  // which shrinks the viewport and pushes the list off-screen
                  // before the user has decided to filter. Tap to filter instead.
                  autoFocus={!isMobile}
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
                <SelectorRow active={!value} gutter={Boolean(onSetDefault)} onSelect={() => {
                  setOpen(false);
                  setFilter("");
                  onClear();
                }}>
                  <OptionLabel label={emptyLabel ?? t("i18n.default")} />
                </SelectorRow>
              )}
              {modelsByProvider.length === 0 ? (
                <div style={{ padding: "8px 12px", color: "var(--text-dim)", fontSize: 12, whiteSpace: "nowrap" }}>
                  {!listed ? t("agents.modelsLoading") : filter.trim() ? t("chat.noMatchingModels") : t("chat.noAvailableModels")}
                </div>
              ) : modelsByProvider.map((group, index) => (
                <div key={group.provider}>
                  {modelsByProvider.length > 1 && (
                    <div
                      title={group.providerName === group.provider ? undefined : group.provider}
                      style={{ padding: "6px 12px 4px", borderTop: index > 0 || onClear ? "1px solid var(--border)" : "none", color: "var(--text-dim)", fontSize: 10, fontWeight: 600, letterSpacing: 0, textTransform: group.providerName === group.provider ? "uppercase" : "none" }}
                    >
                      {group.providerName}
                    </div>
                  )}
                  {group.options.map((option) => {
                    return (
                      <SelectorRow
                        key={`${option.provider}:${option.modelId}`}
                        active={option.modelId === value?.modelId && option.provider === value?.provider}
                        onSelect={() => choose(option)}
                        // The default is saved only from the scope: PUT /api/models/default refuses others.
                        star={onSetDefault && (!showAll || isListed(options, option)) ? {
                          isDefault: option.modelId === defaultValue?.modelId && option.provider === defaultValue?.provider,
                          saveLabel: t("chat.saveDefaultModel"),
                          defaultLabel: t("chat.defaultModel"),
                          onSave: () => saveDefault(option),
                        } : undefined}
                      >
                        <OptionLabel label={option.name} />
                      </SelectorRow>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function OptionLabel({ label }: { label: string }) {
  return <span title={label} style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>;
}
