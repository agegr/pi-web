"use client";

import { useCallback, useEffect, useRef, useState, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { useTheme } from "@/hooks/useTheme";
import {
  PALETTES,
  readStoredPalette,
  persistPalette,
  applyPaletteToDom,
  type PaletteId,
  type PaletteGroup,
} from "@/lib/web-themes";

const PICKER_WIDTH = 320;
const PICKER_HEIGHT_ESTIMATE = 560;
const VIEWPORT_MARGIN = 8;

const GROUP_ORDER: PaletteGroup[] = ["signature", "dark", "light", "special"];
const GROUP_LABELS: Record<PaletteGroup, string> = {
  signature: "SIGNATURE",
  dark: "DARK",
  light: "LIGHT",
  special: "SPECIAL",
};

function usePaletteState(): [PaletteId, (id: PaletteId) => void] {
  const [palette, setPaletteState] = useState<PaletteId>("pi");

  useEffect(() => {
    const stored = readStoredPalette();
    setPaletteState(stored);
    applyPaletteToDom(stored);
  }, []);

  const setPalette = useCallback((id: PaletteId) => {
    setPaletteState(id);
    persistPalette(id);
    applyPaletteToDom(id);
  }, []);

  return [palette, setPalette];
}

/** A real preview swatch: app bg + surface chip + accent bar + text tick. */
function ThemeSwatch({ bg, surface, accent, text }: { bg: string; surface: string; accent: string; text: string }) {
  return (
    <span className="pi-theme-swatch" aria-hidden="true" style={{ "--pr-bg": bg, "--pr-surface": surface, "--pr-accent": accent, "--pr-text": text } as React.CSSProperties}>
      <span className="pi-theme-swatch-chip" />
      <span className="pi-theme-swatch-accent" />
    </span>
  );
}

function computePickerPosition(buttonRect: DOMRect): { top: number; left: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let left = buttonRect.right - PICKER_WIDTH;
  let top = buttonRect.bottom + 6;

  if (left < VIEWPORT_MARGIN) left = VIEWPORT_MARGIN;
  if (left + PICKER_WIDTH > vw - VIEWPORT_MARGIN) left = vw - PICKER_WIDTH - VIEWPORT_MARGIN;

  if (top + PICKER_HEIGHT_ESTIMATE > vh - VIEWPORT_MARGIN) {
    top = buttonRect.top - PICKER_HEIGHT_ESTIMATE - 6;
  }
  if (top < VIEWPORT_MARGIN) top = VIEWPORT_MARGIN;

  return { top, left };
}

function Check() {
  return (
    <svg width="12" height="12" viewBox="0 0 10 10" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="1.5 5 4 7.5 8.5 2.5" />
    </svg>
  );
}

export function ThemePalettePicker() {
  const { preference, toggleTheme } = useTheme();
  const [palette, setPalette] = usePaletteState();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [panelPos, setPanelPos] = useState<{ top: number; left: number } | null>(null);

  const recomputePosition = useCallback(() => {
    if (!buttonRef.current) return;
    setPanelPos(computePickerPosition(buttonRef.current.getBoundingClientRect()));
  }, []);

  useLayoutEffect(() => {
    if (!open) { setPanelPos(null); return; }
    recomputePosition();
  }, [open, recomputePosition]);

  useEffect(() => {
    if (!open) return;
    const recompute = () => recomputePosition();
    window.addEventListener("scroll", recompute, true);
    window.addEventListener("resize", recompute);
    return () => {
      window.removeEventListener("scroll", recompute, true);
      window.removeEventListener("resize", recompute);
    };
  }, [open, recomputePosition]);

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent && e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
        return;
      }
      if (e instanceof MouseEvent) {
        if (buttonRef.current?.contains(e.target as Node)) return;
        if (panelRef.current?.contains(e.target as Node)) return;
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handle);
    document.addEventListener("keydown", handle);
    return () => {
      document.removeEventListener("mousedown", handle);
      document.removeEventListener("keydown", handle);
    };
  }, [open]);

  const handleAppearance = useCallback((pref: string) => {
    if (pref === preference) return;
    // Cycle the toggle until it reaches the requested preference.
    // toggleTheme cycles light -> dark -> auto.
    const order: string[] = ["light", "dark", "auto"];
    const targetIdx = order.indexOf(pref);
    const curIdx = order.indexOf(preference);
    const hops = (targetIdx - curIdx + order.length) % order.length;
    for (let i = 0; i < hops; i++) toggleTheme();
  }, [preference, toggleTheme]);

  const appearanceLabel = preference === "light" ? "Light" : preference === "dark" ? "Dark" : "System";
  const activePalette = PALETTES.find((p) => p.id === palette) ?? PALETTES[0];

  const pickerPanel = open && panelPos ? createPortal(
    <div
      ref={panelRef}
      className="pi-theme-picker"
      role="dialog"
      aria-label="Theme picker"
      style={{ position: "fixed", top: panelPos.top, left: panelPos.left, width: PICKER_WIDTH }}
    >
      {/* Appearance section */}
      <div className="pi-theme-picker-section">
        <div className="pi-theme-picker-section-title">Appearance</div>
        <div className="pi-theme-appearance-row">
          {(["light", "dark", "auto"] as const).map((pref) => {
            const label = pref === "light" ? "Light" : pref === "dark" ? "Dark" : "System";
            const isActive = preference === pref;
            return (
              <button
                key={pref}
                type="button"
                className={`pi-theme-picker-option seg${isActive ? " is-active" : ""}`}
                role="menuitemradio"
                aria-checked={isActive}
                onClick={() => handleAppearance(pref)}
              >
                <span className="pi-theme-appearance-label">{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Palette section, grouped */}
      <div className="pi-theme-picker-section">
        <div className="pi-theme-picker-section-title">Palette</div>
        {GROUP_ORDER.map((group) => {
          const items = PALETTES.filter((p) => p.group === group);
          if (items.length === 0) return null;
          return (
            <div key={group} className="pi-theme-picker-group">
              <div className="pi-theme-picker-group-label">{GROUP_LABELS[group]}</div>
              {items.map((p) => {
                const isActive = palette === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={`pi-theme-picker-option${isActive ? " is-active" : ""}`}
                    role="menuitemradio"
                    aria-checked={isActive}
                    title={p.descriptor}
                    onClick={() => {
                      if (!isActive) setPalette(p.id);
                    }}
                  >
                    <span className="pi-theme-picker-check">
                      {isActive && <Check />}
                    </span>
                    <ThemeSwatch bg={p.swatch[0]} surface={p.swatch[1]} accent={p.swatch[2]} text={p.swatch[3]} />
                    <span className="pi-theme-picker-meta">
                      <span className="pi-theme-picker-label">{p.label}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>,
    document.body,
  ) : null;

  return (
    <div style={{ position: "relative" }}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label="Theme settings"
        title={`Theme: ${activePalette.label} · ${appearanceLabel}`}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 36,
          height: 36,
          padding: 0,
          background: open ? "var(--bg-selected)" : "none",
          border: "none",
          borderLeft: "1px solid var(--border)",
          color: open ? "var(--text)" : "var(--text-muted)",
          cursor: "pointer",
          transition: "color 0.12s, background 0.12s",
        }}
        onMouseEnter={(e) => { if (!open) e.currentTarget.style.color = "var(--text)"; }}
        onMouseLeave={(e) => { if (!open) e.currentTarget.style.color = "var(--text-muted)"; }}
      >
        <ThemeSwatch bg={activePalette.swatch[0]} surface={activePalette.swatch[1]} accent={activePalette.swatch[2]} text={activePalette.swatch[3]} />
      </button>
      {pickerPanel}
    </div>
  );
}
