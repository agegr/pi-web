/**
 * A tool call running longer than this is considered stuck-suspicious:
 * the UI highlights its elapsed time in a warning color.
 */
export const LONG_RUNNING_TOOL_MS = 5 * 60_000;

/** Compact live elapsed clock: "42s", "3:42", "1:05:33". */
export function formatToolElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  if (totalSec < 60) return `${totalSec}s`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m < 60) return `${m}:${String(s).padStart(2, "0")}`;
  const h = Math.floor(m / 60);
  return `${h}:${String(m % 60).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
