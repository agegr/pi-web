"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTheme, type ColorTheme } from "@/hooks/useTheme";
import { useI18n } from "@/hooks/useI18n";

const THEMES: { id: ColorTheme; swatchClass: string }[] = [
  { id: "default", swatchClass: "swatch-default" },
  { id: "sky", swatchClass: "swatch-sky" },
  { id: "lavender", swatchClass: "swatch-lavender" },
  { id: "mint", swatchClass: "swatch-mint" },
  { id: "coral", swatchClass: "swatch-coral" },
];

export interface ColorThemePaletteHandle {
  show: () => void;
  hide: () => void;
}

interface ColorThemePaletteProps {
  anchorRef: React.RefObject<HTMLElement | null>;
}

export const ColorThemePalette = forwardRef<ColorThemePaletteHandle, ColorThemePaletteProps>(function ColorThemePalette({ anchorRef }, ref) {
  const { colorTheme, setColorTheme } = useTheme();
  const { t: translate } = useI18n();
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const paletteRef = useRef<HTMLDivElement>(null);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearHideTimeout = useCallback(() => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
  }, []);

  const updatePosition = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    setPosition({
      top: rect.bottom,
      left: rect.left,
    });
  }, [anchorRef]);

  const show = useCallback(() => {
    clearHideTimeout();
    updatePosition();
    setVisible(true);
  }, [clearHideTimeout, updatePosition]);

  const hide = useCallback(() => {
    hideTimeoutRef.current = setTimeout(() => {
      setVisible(false);
    }, 600);
  }, []);

  useImperativeHandle(ref, () => ({ show, hide }), [show, hide]);

  useEffect(() => {
    return () => clearHideTimeout();
  }, [clearHideTimeout]);

  if (!visible) return null;

  return createPortal(
    <div
      ref={paletteRef}
      className="color-theme-palette"
      role="group"
      aria-label={translate("theme.appearance")}
      onMouseEnter={show}
      onMouseLeave={hide}
      style={{
        position: "fixed",
        top: position.top,
        left: position.left,
      }}
    >
      <span className="color-theme-palette-label">{translate("theme.appearance")}</span>
      {THEMES.map((theme) => (
        <button
          key={theme.id}
          type="button"
          className={`color-theme-swatch ${theme.swatchClass}${colorTheme === theme.id ? " is-active" : ""}`}
          aria-label={translate(`theme.${theme.id}`)}
          title={translate(`theme.${theme.id}`)}
          aria-pressed={colorTheme === theme.id}
          onClick={() => setColorTheme(theme.id)}
        />
      ))}
    </div>,
    document.body,
  );
});
