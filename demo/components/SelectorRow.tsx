"use client";

import { useState, type ReactNode } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";

function StarIcon({ filled, size }: { filled: boolean; size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
      <polygon points="12 2.5 14.9 8.6 21.5 9.4 16.6 13.9 17.9 20.5 12 17.2 6.1 20.5 7.4 13.9 2.5 9.4 9.1 8.6" />
    </svg>
  );
}

export interface SelectorRowStar {
  /** This row is the default new sessions start with. */
  isDefault: boolean;
  /** Title and accessible name of the save button on the other rows. */
  saveLabel: string;
  /** Title and accessible name of the default row's marker. */
  defaultLabel: string;
  onSave: () => void;
}

/**
 * A selector menu row styled like a session-list row: the whole row selects
 * and highlights on hover. With `star`, the right gutter holds the default
 * marker: a small static star on the default row, and on every other row a
 * "save as default" button that floats in on hover or keyboard focus. Touch
 * screens have no hover, so there the button stays visible.
 */
export function SelectorRow({
  active,
  onSelect,
  star,
  gutter = Boolean(star),
  children,
}: {
  active: boolean;
  onSelect: () => void;
  star?: SelectorRowStar;
  /** Keep room for the star so it never covers the row's text; pass it to every row of a menu that has stars so they line up. */
  gutter?: boolean;
  children: ReactNode;
}) {
  const isMobile = useIsMobile();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const canSave = Boolean(star && !star.isDefault);
  const showSave = canSave && (hovered || focused || isMobile);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      }}
      style={{
        position: "relative",
        background: active ? "var(--bg-selected)" : hovered ? "var(--bg-hover)" : "transparent",
        transition: "background 0.1s",
      }}
    >
      <button
        type="button"
        role="option"
        aria-selected={active}
        onClick={onSelect}
        style={{
          display: "flex", alignItems: "center", gap: 8,
          width: "100%", minWidth: 0, padding: gutter ? "7px 36px 7px 12px" : "7px 12px",
          border: "none", background: "none",
          color: active ? "var(--text)" : "var(--text-muted)",
          cursor: "pointer", fontSize: 12, fontWeight: active ? 600 : 400,
          textAlign: "left", whiteSpace: "nowrap",
        }}
      >
        {active
          ? <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }} aria-hidden="true"><polyline points="1.5 5 4 7.5 8.5 2.5" /></svg>
          : <span style={{ width: 10, flexShrink: 0 }} />}
        {children}
      </button>
      {star?.isDefault && (
        <span
          role="img"
          aria-label={star.defaultLabel}
          title={star.defaultLabel}
          style={{
            position: "absolute", top: "50%", right: 6, transform: "translateY(-50%)",
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 24, height: 24,
            color: "var(--text-dim)",
          }}
        >
          <StarIcon filled size={10} />
        </span>
      )}
      {star && canSave && (
        <button
          type="button"
          title={star.saveLabel}
          aria-label={star.saveLabel}
          tabIndex={showSave ? 0 : -1}
          onClick={(event) => {
            event.stopPropagation();
            star.onSave();
          }}
          style={{
            position: "absolute", top: "50%", right: 6, transform: "translateY(-50%)",
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 24, height: 24, padding: 0,
            background: "var(--bg-hover)", border: "1px solid var(--border)",
            borderRadius: 6, color: "var(--text-muted)",
            cursor: "pointer",
            opacity: showSave ? 1 : 0,
            pointerEvents: showSave ? "auto" : "none",
            transition: "opacity 0.1s, background 0.12s, color 0.12s, border-color 0.12s",
          }}
          onMouseEnter={(event) => {
            event.currentTarget.style.background = "var(--bg-selected)";
            event.currentTarget.style.color = "var(--accent)";
            event.currentTarget.style.borderColor = "rgba(37,99,235,0.35)";
          }}
          onMouseLeave={(event) => {
            event.currentTarget.style.background = "var(--bg-hover)";
            event.currentTarget.style.color = "var(--text-muted)";
            event.currentTarget.style.borderColor = "var(--border)";
          }}
        >
          <StarIcon filled={false} size={12} />
        </button>
      )}
    </div>
  );
}
