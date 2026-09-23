export function ThinkingIcon({ active, size = 14 }: { active: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path
        d="M9.5 2A5.5 5.5 0 0 0 4 7.5c0 1.7.78 3.21 2 4.21V14a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1v-2.29c1.22-1 2-2.51 2-4.21A5.5 5.5 0 0 0 9.5 2z"
        stroke={active ? "#d4a017" : undefined}
        fill={active ? "rgba(250, 204, 21, 0.18)" : "none"}
        style={{ filter: active ? "drop-shadow(0 0 2px rgba(250, 204, 21, 0.35))" : "none" }}
      />
      <line x1="7" y1="18" x2="12" y2="18" />
      <line x1="8" y1="21" x2="11" y2="21" />
    </svg>
  );
}
