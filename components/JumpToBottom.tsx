"use client";

import type { CSSProperties } from "react";

interface Props {
  /** Scrolled-up state from the chat scroll handler; false renders nothing. */
  visible: boolean;
  onJump: () => void;
  /** Localized label used for aria-label/title and the visible text. */
  label: string;
  /**
   * Right inset: CHAT_MINIMAP_WIDTH on desktop so the pill sits horizontally
   * clear of the minimap column. Ignored when `centered` is set.
   */
  insetRight?: number;
  /**
   * Distance from the bottom edge of the messages region (the composer is a
   * sibling below it, so the pill floats directly above the composer edge).
   */
  insetBottom?: number;
  /**
   * Horizontally centered placement (pi#22 mobile): left: 50% plus
   * translateX(-50%), so the pill floats centered directly above the
   * composer. Supersedes the right anchor; desktop keeps the right anchor
   * to stay clear of the minimap column.
   */
  centered?: boolean;
}

/**
 * Floating jump-to-bottom pill overlaid at the bottom of the messages region
 * (pi#17). Purely presentational: ChatWindow owns placement policy via
 * `centered`/`insetRight`/`insetBottom` — centered above the composer on
 * mobile, right-anchored clear of the minimap on desktop — and `visible:
 * false` means NOT RENDERED at all
 * — never merely transparent — so it never intercepts pointer events at the
 * tail. Overlay only: it does not participate in layout and cannot push or
 * cover the composer or the minimap.
 */
export default function JumpToBottom({ visible, onJump, label, insetRight, insetBottom = 12, centered = false }: Props) {
  if (!visible) return null;

  const style: CSSProperties = {
    position: "absolute",
    bottom: insetBottom,
    ...(centered ? { left: "50%", transform: "translateX(-50%)" } : { right: insetRight }),
    zIndex: 30,
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 12px",
    border: "1px solid var(--border)",
    borderRadius: 9999,
    background: "var(--bg-panel)",
    color: "var(--text)",
    boxShadow: "0 2px 10px rgba(0,0,0,0.15)",
    cursor: "pointer",
    pointerEvents: "auto",
  };

  return (
    <button type="button" style={style} aria-label={label} title={label} onClick={onJump}>
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
      <span style={{ fontSize: 12, whiteSpace: "nowrap" }}>{label}</span>
    </button>
  );
}
