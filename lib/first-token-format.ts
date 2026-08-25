export function formatFirstTokenDuration(seconds: number): string {
  if (seconds < 0.1) return `${Math.max(0, Math.round(seconds * 1000))}ms`;
  return `${seconds.toFixed(1)}s`;
}
