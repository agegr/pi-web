import type { CSSProperties } from "react";

export type UsageIconKind = "input" | "output" | "cacheRead" | "cacheWrite";

/** Match the session toolbar: input is sent up, output received down. */
export function UsageIcon({ kind, size = 12, style }: { kind: UsageIconKind; size?: number; style?: CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, ...style }}>
      {kind === "input" ? (
        <><line x1="5" y1="8.5" x2="5" y2="1.5" /><polyline points="2 4 5 1.5 8 4" /></>
      ) : kind === "output" ? (
        <><line x1="5" y1="1.5" x2="5" y2="8.5" /><polyline points="2 6 5 8.5 8 6" /></>
      ) : kind === "cacheRead" ? (
        <><path d="M8.5 5a3.5 3.5 0 1 1-1-2.45" /><polyline points="6.5 1.5 8.5 2.5 7.5 4.5" /></>
      ) : (
        <><path d="M1.5 5a3.5 3.5 0 1 0 1-2.45" /><polyline points="3.5 1.5 1.5 2.5 2.5 4.5" /></>
      )}
    </svg>
  );
}
