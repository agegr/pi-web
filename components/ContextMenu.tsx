"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

export interface ContextMenuItem {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

const MENU_WIDTH = 160;
const MENU_ITEM_HEIGHT = 26;
const MENU_PADDING = 8;
const EDGE_MARGIN = 4;

/**
 * Standard right-click context menu. Rendered through a portal into document.body
 * so ancestors with transform/overflow (e.g. the animating right panel) cannot
 * clip or offset it. Closes on outside click, Escape or window blur; flips near
 * viewport edges. Client-only (rendered on demand).
 */
export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const onBlur = () => onClose();
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", onBlur);
    };
  }, [onClose]);

  // SSR-safe viewport math (only rendered client-side, but tests use
  // renderToStaticMarkup where window/document are absent).
  const viewportW = typeof window === "undefined" ? 0 : window.innerWidth;
  const viewportH = typeof window === "undefined" ? 0 : window.innerHeight;
  const estimatedHeight = items.length * MENU_ITEM_HEIGHT + MENU_PADDING;
  const left = Math.max(EDGE_MARGIN, Math.min(x, viewportW - MENU_WIDTH - EDGE_MARGIN));
  const top = Math.max(EDGE_MARGIN, Math.min(y, viewportH - estimatedHeight - EDGE_MARGIN));

  const menu = (
    <div
      ref={ref}
      role="menu"
      className="context-menu"
      style={{ left, top }}
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          onClick={() => {
            item.onClick();
            onClose();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );

  // Portal to body: ancestors with transform (panel animations) or overflow
  // would otherwise clip/offset a fixed-position menu.
  if (typeof document === "undefined") return menu;
  return createPortal(menu, document.body);
}
