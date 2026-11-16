"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useInstalledFonts } from "@/hooks/useInstalledFonts";
import { useIsMobile } from "@/hooks/useIsMobile";
import type { InstalledFontInfo } from "@/lib/api-types";
import { FONT_FAMILY_MAX_LENGTH, type FontKind } from "@/lib/font-preferences";
import { filterInstalledFonts, isFontFamilySelected } from "@/lib/font-picker";

interface AnchorRect {
  top: number;
  bottom: number;
  left: number;
  width: number;
}

/**
 * A font-family field with a picker: the text stays editable, so a family
 * name that is missing from the list (or a comma-separated stack) still works,
 * and the picks come from the fonts installed on the machine running pi-web.
 */
export function FontFamilyField({
  kind,
  value,
  placeholder,
  describedBy,
  onChange,
}: {
  kind: FontKind;
  value: string;
  placeholder: string;
  describedBy?: string;
  onChange: (value: string) => void;
}) {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<AnchorRect | null>(null);
  const [filter, setFilter] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const { fonts, failed } = useInstalledFonts(open);
  const options = fonts ? filterInstalledFonts(fonts, filter, kind) : [];
  const listId = `settings-font-${kind}-options`;
  const optionId = (index: number) => `settings-font-${kind}-option-${index}`;

  const measure = () => {
    const rect = inputRef.current?.closest<HTMLElement>(".settings-font-field")?.getBoundingClientRect();
    if (rect?.height) setAnchor({ top: rect.top, bottom: rect.bottom, left: rect.left, width: rect.width });
  };

  useEffect(() => {
    if (!open) return;
    measure();
    // A phone has no filter focus (that would open its keyboard), so the panel
    // takes focus and a hardware keyboard still walks the list.
    if (isMobile) panelRef.current?.focus();
    const onOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!fieldRef.current?.contains(target) && !panelRef.current?.contains(target)) setOpen(false);
    };
    // The settings pane scrolls, and a phone keyboard moves the field: follow
    // the field rather than leaving the panel where the click found it.
    const follow = () => measure();
    document.addEventListener("mousedown", onOutside);
    document.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    window.visualViewport?.addEventListener("resize", follow);
    return () => {
      document.removeEventListener("mousedown", onOutside);
      document.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", follow);
      window.visualViewport?.removeEventListener("resize", follow);
    };
  }, [open, isMobile]);

  useEffect(() => {
    setActiveIndex(0);
  }, [filter, open]);

  const close = (focusInput = true) => {
    setOpen(false);
    setFilter("");
    if (focusInput) inputRef.current?.focus();
  };

  const choose = (font: InstalledFontInfo) => {
    onChange(font.family);
    close();
  };

  const onPanelKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const picked = options[activeIndex];
      if (picked) choose(picked);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!options.length) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((current) => (current + step + options.length) % options.length);
      return;
    }
    if (event.key === "Tab") close(false);
  };

  const panelStyle: CSSProperties | null = anchor && (() => {
    // Measure against the visible viewport: a phone keyboard shrinks it.
    const viewportTop = window.visualViewport?.offsetTop ?? 0;
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
    const spaceBelow = viewportTop + viewportHeight - anchor.bottom - 14;
    const spaceAbove = anchor.top - viewportTop - 14;
    const openAbove = spaceAbove > spaceBelow;
    const maxHeight = Math.max(120, Math.min(openAbove ? spaceAbove : spaceBelow, viewportHeight * 0.55));
    return {
      position: "fixed",
      ...(openAbove ? { top: Math.min(anchor.top - 6, viewportTop + viewportHeight - 8), transform: "translateY(-100%)" } : { top: anchor.bottom + 6 }),
      ...(isMobile
        ? { left: 8, right: 8, maxWidth: "calc(100vw - 16px)" }
        : { left: anchor.left, width: "max-content", minWidth: Math.max(anchor.width, 240), maxWidth: Math.max(anchor.width, window.innerWidth - anchor.left - 8) }),
      zIndex: 500,
      display: "flex",
      flexDirection: "column",
      maxHeight,
      overflow: "hidden",
      border: "1px solid var(--border)",
      borderRadius: 8,
      background: "var(--bg)",
      boxShadow: openAbove ? "0 -4px 16px rgba(0,0,0,0.10)" : "0 4px 16px rgba(0,0,0,0.10)",
    } satisfies CSSProperties;
  })();

  return (
    <div
      ref={fieldRef}
      className="settings-font-field"
      // Escape and the arrow keys also work from the trigger or the name field,
      // and a handled key never reaches the panel that would close Settings.
      onKeyDown={open ? onPanelKeyDown : undefined}
    >
      <input
        ref={inputRef}
        id={`settings-font-${kind}`}
        className={`settings-font-input${kind === "mono" ? " is-mono" : ""}`}
        type="text"
        value={value}
        placeholder={placeholder}
        maxLength={FONT_FAMILY_MAX_LENGTH}
        aria-describedby={describedBy}
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
      />
      <button
        type="button"
        className="settings-font-toggle"
        aria-label={t("settings.chooseFont")}
        title={t("settings.chooseFont")}
        aria-haspopup="listbox"
        aria-controls={listId}
        aria-expanded={open}
        onClick={() => {
          if (open) close(false);
          else setOpen(true);
        }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && panelStyle && (
        <div ref={panelRef} className="settings-font-panel" tabIndex={-1} style={panelStyle}>
          <div style={{ flexShrink: 0, padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>
            <input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder={t("settings.filterFonts")}
              aria-label={t("settings.filterFonts")}
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-activedescendant={options[activeIndex] ? optionId(activeIndex) : undefined}
              aria-autocomplete="list"
              // A phone keyboard shrinks the viewport before the user has
              // decided to filter, which would push the list off-screen.
              autoFocus={!isMobile}
              autoComplete="off"
              spellCheck={false}
              className="settings-font-filter"
            />
          </div>
          <div id={listId} role="listbox" aria-label={t("settings.installedFonts")} style={{ minHeight: 0, overflowY: "auto" }}>
            {failed ? (
              <p className="settings-font-note">{t("settings.fontsUnavailable")}</p>
            ) : !fonts ? (
              <p className="settings-font-note">{t("settings.fontsLoading")}</p>
            ) : options.length === 0 ? (
              <p className="settings-font-note">{t("settings.noMatchingFonts")}</p>
            ) : options.map((font, index) => {
              const selected = isFontFamilySelected(value, font.family);
              return (
                <button
                  key={font.family}
                  id={optionId(index)}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  title={[font.family, ...font.aliases].join(" / ")}
                  className="settings-font-option"
                  data-active={index === activeIndex || undefined}
                  // The row is drawn in the font it names: the preview is the pick.
                  style={{ fontFamily: JSON.stringify(font.family) }}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => choose(font)}
                >
                  <span className="settings-font-option-name">{font.family}</span>
                  {font.aliases.length > 0 && <span className="settings-font-option-alias">{font.aliases.join(" / ")}</span>}
                  {font.monospace && <span className="settings-font-option-tag">{t("settings.fontMonospaceTag")}</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
