"use client";

interface PaneHeaderProps {
  label: string;
  running: boolean;
  hasBadge: boolean;
  focused: boolean;
  onClick: () => void;
  onClose: () => void;
}

export function PaneHeader({ label, running, hasBadge, focused, onClick, onClose }: PaneHeaderProps) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={focused}
      onClick={onClick}
      title={label}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 5,
        height: "100%",
        padding: "0 8px",
        border: "none",
        borderTop: focused ? "2px solid var(--accent)" : "2px solid transparent",
        background: focused ? "var(--bg-selected)" : "transparent",
        color: focused ? "var(--text)" : "var(--text-muted)",
        cursor: "pointer",
        fontSize: 11,
        fontFamily: "inherit",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        flexShrink: 0,
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
          overflow: "hidden",
          textOverflow: "ellipsis",
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
          width: 16,
          height: 16,
          borderRadius: 4,
          fontSize: 10,
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
