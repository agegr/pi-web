// Client-safe display of session usage: the toolbar's stats button and
// popover, and the agent switcher's per-agent rows.

import { formatMoneyFromCent } from "./money";
import type { Locale } from "./i18n/types";

/** 950 · 18k · 1.2M */
export function formatCompactCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(0)}k`;
  return String(value);
}

/** $0.12 · <$0.01 (¥ in Simplified Chinese) · null when nothing was billed. */
export function formatCostShort(cost: number, locale: Locale | string | undefined): string | null {
  return formatMoneyFromCent(cost, locale);
}

/** 0s · 42s · 3m 5s · 1h 20m */
export function formatActiveDuration(ms: number): string {
  if (ms <= 0) return "0s";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
