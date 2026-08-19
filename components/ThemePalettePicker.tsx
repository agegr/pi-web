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
} from "@/lib/web-themes";

const PICKER_WIDTH = 280;
const PICKER_HEIGHT_ESTIMATE = 420;
const VIEWPORT_MARGIN = 8;

function usePaletteState(): [PaletteId, (id: PaletteId) => void] {
  const [palette, setPaletteState] = useState<PaletteId>("pi");

  useEffect(() => {
    setPaletteState(readStoredPalette());
    applyPaletteToDom(readStoredPalette());
  }, []);

  const setPalette = useCallback((id: PaletteId) => {
    setPaletteState(id);
    persistPalette(id);
    applyPaletteToDom(id);
  }, []);

  return [palette, setPalette];
}

/** Swatch row for a palette preview. */
function PaletteSwatch({ colors }: { colors: [string, string, string, string] }) {
  return (
    <span className="pi-theme-swatch" aria-hidden="true">
      {colors.map((color, i) => (
        <span
          key={i}
          className="pi-theme-swatch-color"
          style={{ background: color }}
        />
      ))}
    </span>
  );
}

function computePickerPosition(buttonRect: DOMRect): { top: number; left: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Default: below the button, right-aligned to button right edge
  let left = buttonRect.right - PICKER_WIDTH;
  let top = buttonRect.bottom + 6;

  // Horizontal: clamp within viewport
  if (left < VIEWPORT_MARGIN) left = VIEWPORT_MARGIN;
  if (left + PICKER_WIDTH > vw - VIEWPORT_MARGIN) left = vw - PICKER_WIDTH - VIEWPORT_MARGIN;

  // Vertical: if it would overflow bottom, show above the button
  if (top + PICKER_HEIGHT_ESTIMATE > vh - VIEWPORT_MARGIN) {
    top = buttonRect.top - PICKER_HEIGHT_ESTIMATE - 6;
  }
  if (top < VIEWPORT_MARGIN) top = VIEWPORT_MARGIN;

  return { top, left };
}

export function ThemePalettePicker() {
  const { preference, toggleTheme } = useTheme();
  const [palette, setPalette] = usePaletteState();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [panelPos, setPanelPos] = useState<{ top: number; left: number } | null>(null);

  // Compute button position for portal placement
  const recomputePosition = useCallback(() => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    setPanelPos(computePickerPosition(rect));
  }, []);

  useLayoutEffect(() => {
    if (!open) { setPanelPos(null); return; }
    recomputePosition();
  }, [open, recomputePosition]);

  // Recompute on scroll/resize while open
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

  // Close on outside click or Escape
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

  const handleAppearanceCycle = useCallback(() => {
    toggleTheme();
  }, [toggleTheme]);

  const appearanceLabel = preference === "light" ? "Light" : preference === "dark" ? "Dark" : "System";
  const activePalette = PALETTES.find((p) => p.id === palette) ?? PALETTES[0];

  const pickerPanel = open && panelPos ? createPortal(
    <div
      ref={panelRef}
      className="pi-theme-picker"
      role="menu"
      aria-label="Theme picker"
      style={{ position: "fixed", top: panelPos.top, left: panelPos.left }}
    >
      {/* Appearance section */}
      <div className="pi-theme-picker-section">
        <div className="pi-theme-picker-section-title">APPEARANCE</div>
        {(["light", "dark", "auto"] as const).map((pref) => {
          const label = pref === "light" ? "Light" : pref === "dark" ? "Dark" : "System";
          const isActive = preference === pref;
          return (
            <button
              key={pref}
              type="button"
              className={`pi-theme-picker-option${isActive ? " is-active" : ""}`}
              role="menuitemradio"
              aria-checked={isActive}
              onClick={() => {
                if (!isActive) handleAppearanceCycle();
              }}
            >
              <span className="pi-theme-picker-check">
                {isActive && (
                  <svg width="12" height="12" viewBox="0 0 10 10" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="1.5 5 4 7.5 8.5 2.5" />
                  </svg>
                )}
              </span>
              <span className="pi-theme-picker-label">{label}</span>
            </button>
          );
        })}
      </div>

      {/* Palette section */}
      <div className="pi-theme-picker-section">
        <div className="pi-theme-picker-section-title">PALETTE</div>
        {PALETTES.map((p) => {
          const isActive = palette === p.id;
          return (
            <button
              key={p.id}
              type="button"
              className={`pi-theme-picker-option${isActive ? " is-active" : ""}`}
              role="menuitemradio"
              aria-checked={isActive}
              onClick={() => {
                if (!isActive) setPalette(p.id);
              }}
            >
              <span className="pi-theme-picker-check">
                {isActive && (
                  <svg width="12" height="12" viewBox="0 0 10 10" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="1.5 5 4 7.5 8.5 2.5" />
                  </svg>
                )}
              </span>
              <PaletteSwatch colors={p.swatch} />
              <span className="pi-theme-picker-label">{p.label}</span>
            </button>
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
        <PaletteSwatch colors={activePalette.swatch} />
      </button>
      {pickerPanel}
    </div>
  );
}
