"use client";

export function Slider({
  label,
  min,
  max,
  step = 1,
  value,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ fontSize: 12, color: "var(--text)", width: 84, flexShrink: 0 }}>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ flex: 1, accentColor: "var(--accent)" }}
      />
      <span style={{ fontSize: 11, color: "var(--text-muted)", width: 36, textAlign: "right" }}>
        {value}
      </span>
    </div>
  );
}
