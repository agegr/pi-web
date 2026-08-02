"use client";

import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";

export interface ContextMenuItem {
  key: string;
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** Render a separator below this item. */
  separatorAfter?: boolean;
}

interface Props {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

/**
 * A lightweight, portal-free context menu positioned at the cursor. Closes on
 * outside click, Escape, scroll, or window blur. Clamps itself inside the
 * viewport so it never overflows the right/bottom edge.
 */
export function FileContextMenu({ x, y, items, onClose }: Props) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x, y });

  // Clamp into the viewport once measured.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const margin = 4;
    let nextX = x;
    let nextY = y;
    if (x + rect.width > window.innerWidth - margin) {
      nextX = Math.max(margin, window.innerWidth - rect.width - margin);
    }
    if (y + rect.height > window.innerHeight - margin) {
      nextY = Math.max(margin, window.innerHeight - rect.height - margin);
    }
    setPosition({ x: nextX, y: nextY });
  }, [x, y]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    // Close on scroll so the menu never detaches from its anchor point.
    const handleScroll = () => onClose();
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", onClose);
    window.addEventListener("blur", onClose);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      role="menu"
      style={{
        position: "fixed",
        left: position.x,
        top: position.y,
        zIndex: 1200,
        minWidth: 168,
        maxWidth: 240,
        padding: 4,
        border: "1px solid var(--border)",
        borderRadius: 6,
        background: "var(--bg-panel)",
        boxShadow: "0 8px 24px rgba(0,0,0,0.22)",
      }}
    >
      {items.map((item) => (
        <Fragment key={item.key}>
          <button
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              if (item.disabled) return;
              item.onClick();
              onClose();
            }}
            style={{
              display: "flex",
              alignItems: "center",
              width: "100%",
              padding: "5px 10px",
              border: "none",
              borderRadius: 4,
              background: "transparent",
              color: item.disabled
                ? "var(--text-dim)"
                : item.danger
                  ? "#f87171"
                  : "var(--text)",
              cursor: item.disabled ? "default" : "pointer",
              fontSize: 12,
              textAlign: "left",
              whiteSpace: "nowrap",
            }}
            onMouseEnter={(event) => {
              if (item.disabled) return;
              event.currentTarget.style.background = "var(--bg-hover)";
            }}
            onMouseLeave={(event) => {
              event.currentTarget.style.background = "transparent";
            }}
          >
            {item.label}
          </button>
          {item.separatorAfter && (
            <div style={{ height: 1, margin: "4px 0", background: "var(--border)" }} />
          )}
        </Fragment>
      ))}
    </div>
  );
}
