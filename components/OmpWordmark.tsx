import { useId, type CSSProperties, type ReactNode } from "react";

type OmpWordmarkProps = {
  label?: ReactNode;
  markSize?: number;
  gap?: number;
  style?: CSSProperties;
  labelStyle?: CSSProperties;
};

export function OmpWordmark({
  label = "omp",
  markSize = 22,
  gap = 10,
  style,
  labelStyle,
}: OmpWordmarkProps) {
  const gradientId = `omp-pi-gradient-${useId().replaceAll(":", "")}`;

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap,
        minWidth: 0,
        color: "var(--text)",
        ...style,
      }}
    >
      <svg
        viewBox="0 0 64 64"
        width={markSize}
        height={markSize}
        aria-hidden="true"
        style={{ flexShrink: 0 }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="oklch(0.7 0.24 340)" />
            <stop offset=".5" stopColor="oklch(0.62 0.21 295)" />
            <stop offset="1" stopColor="oklch(0.81 0.14 200)" />
          </linearGradient>
        </defs>
        <path fill={`url(#${gradientId})`} d="M10 14h44v9H43v33h-9V23h-9v22h-9V23H10z" />
      </svg>
      <span
        style={{
          minWidth: 0,
          overflow: "hidden",
          color: "inherit",
          fontFamily: '"Plus Jakarta Sans", Geist, ui-sans-serif, system-ui, sans-serif',
          fontSize: 15,
          fontWeight: 700,
          letterSpacing: "-0.025em",
          whiteSpace: "nowrap",
          ...labelStyle,
        }}
      >
        {label}
      </span>
    </span>
  );
}
