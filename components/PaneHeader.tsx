"use client";

// Embedded pane header (pi#25): each pane column carries its own header row
// instead of the old shared tab strip. The header keeps tab semantics
// (role="tab" + aria-selected, keyboard focus, running dot, completion badge,
// inline close ✕ with unchanged onClosePane wiring) while spanning the full
// pane width, so the pane content region below gains the strip's former height.

const PANE_HEADER_HEIGHT = 30;

interface PaneHeaderProps {
  id: string;
  label: string;
  running: boolean;
  hasBadge: boolean;
  focused: boolean;
  onClick: () => void;
  onClose: () => void;
}

export const PANE_HEADER_HEIGHT_PX = PANE_HEADER_HEIGHT;

export function PaneHeader({ id, label, running, hasBadge, focused, onClick, onClose }: PaneHeaderProps) {
  return (
    <button
      type="button"
      id={id}
      role="tab"
      aria-selected={focused}
      onClick={onClick}
      title={label}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        width: "100%",
        height: PANE_HEADER_HEIGHT,
        padding: "0 10px 0 8px",
        flexShrink: 0,
        border: "none",
        borderTop: focused ? "2px solid var(--accent)" : "2px solid transparent",
        borderBottom: "1px solid var(--border)",
        background: focused ? "var(--bg-selected)" : "var(--bg-panel)",
        color: focused ? "var(--text)" : "var(--text-muted)",
        cursor: "pointer",
        fontSize: 11,
        fontFamily: "inherit",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        transition: "background 0.1s, color 0.1s",
      }}
    >
      {running && (
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "var(--accent)",
            flexShrink: 0,
          }}
          aria-hidden="true"
        />
      )}
      <span
        style={{
          minWidth: 0,
          flex: "1 1 auto",
          overflow: "hidden",
          textOverflow: "ellipsis",
          textAlign: "left",
        }}
      >
        {label}
      </span>
      {hasBadge && (
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "#f59e0b",
            flexShrink: 0,
          }}
          aria-label="completed"
        />
      )}
      <span
        role="button"
        tabIndex={0}
        aria-label="Close tab"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.stopPropagation();
            e.preventDefault();
            onClose();
          }
        }}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 18,
          height: 18,
          borderRadius: 4,
          fontSize: 11,
          lineHeight: 1,
          color: "var(--text-dim)",
          cursor: "pointer",
          flexShrink: 0,
          marginLeft: 2,
        }}
      >
        ×
      </span>
    </button>
  );
}
