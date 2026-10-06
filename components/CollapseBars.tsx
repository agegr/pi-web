import type { CSSProperties, ReactNode } from "react";

/**
 * Shared collapse-bar primitives. Every collapsible section in the chat
 * (thinking blocks, process details, compaction summaries) uses the same
 * pattern: a top bar that toggles expansion and, while expanded, a bottom
 * bar that collapses. The top bar's chevron sits on the right (like the
 * tool-call headers) and rotates with the state; the bottom bar's chevron
 * points up, signalling that it collapses the section upward.
 */

export function CollapseChevron({ expanded, size = 12 }: { expanded: boolean; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0, transform: expanded ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}
    >
      <polyline points="4 2.5 7.5 6 4 9.5" />
    </svg>
  );
}

export function CollapseUpChevron({ size = 12 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0 }}
    >
      <polyline points="3 8 6 4.5 9 8" />
    </svg>
  );
}

export function CollapseTopBar({ expanded, onToggle, label, meta, ariaLabel, title, style }: {
  expanded: boolean;
  /** Omit for sections with nothing to expand — rendered as a static header. */
  onToggle?: () => void;
  label: ReactNode;
  meta?: ReactNode;
  ariaLabel?: string;
  title?: string;
  style?: CSSProperties;
}) {
  const inner = (
    <>
      <span className="collapse-bar-label">{label}</span>
      {meta != null && <span className="collapse-bar-meta">{meta}</span>}
      <CollapseChevron expanded={expanded} />
    </>
  );
  if (!onToggle) {
    return (
      <div className="collapse-bar collapse-bar-static" style={style}>
        {inner}
      </div>
    );
  }
  return (
    <button
      type="button"
      className="collapse-bar"
      aria-expanded={expanded}
      aria-label={ariaLabel}
      title={title}
      onClick={onToggle}
      style={style}
    >
      {inner}
    </button>
  );
}

export function CollapseBottomBar({ onCollapse, label, title, style }: {
  onCollapse: () => void;
  label?: ReactNode;
  title?: string;
  style?: CSSProperties;
}) {
  return (
    <button
      type="button"
      className="collapse-bar collapse-bar-bottom"
      onClick={onCollapse}
      title={title}
      style={style}
    >
      <CollapseUpChevron />
      {label != null && <span className="collapse-bar-label">{label}</span>}
    </button>
  );
}
