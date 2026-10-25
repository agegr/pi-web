import type { AgentMessage, AgentUsage } from "./types";

export interface MessageUsageSummary {
  usage: AgentUsage;
  durationMs?: number;
  scope: "response" | "turn";
  /** False if any model response in the range has no recorded usage. */
  complete: boolean;
}

/** Decimal K/M, at most one decimal place; promote a rounded 1000K to 1M. */
export function formatUsageTokens(value: number): string {
  if (value < 1_000) return String(value);
  const divisor = value >= 999_950 ? 1_000_000 : 1_000;
  return `${Number((value / divisor).toFixed(1))}${divisor === 1_000 ? "K" : "M"}`;
}

/** Display-only truncation to at most four decimals; never change stored costs. */
export function formatUsageCost(value: number): string {
  if (!Number.isFinite(value) || Math.abs(value) < 0.0001) return "0";
  const [whole, fraction = ""] = value.toLocaleString("en-US", {
    useGrouping: false, maximumFractionDigits: 20,
  }).split(".");
  const digits = fraction.slice(0, 4).replace(/0+$/, "");
  return digits ? `${whole}.${digits}` : whole;
}

/** Output and time must describe the same response or the same whole turn. */
export function averageOutputRate(summary: MessageUsageSummary): number | undefined {
  const { output } = summary.usage;
  const ms = summary.durationMs;
  if (!summary.complete || !Number.isFinite(output) || output < 0
    || ms === undefined || !Number.isFinite(ms) || ms <= 0) return undefined;
  const rate = output / (ms / 1_000);
  return Number.isFinite(rate) ? rate : undefined;
}

/** Sum the original messages, not the answer/process display copies. */
export function summarizeTurnUsage(
  messages: AgentMessage[],
  start: number,
  end: number,
  durationMs?: number,
): MessageUsageSummary | undefined {
  const usage: AgentUsage = {
    input: 0, output: 0, cacheRead: 0, cacheWrite: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
  let found = false;
  let complete = true;
  for (let index = start; index < end; index++) {
    const message = messages[index];
    if (message.role !== "assistant") continue;
    if (!message.usage) {
      complete = false;
      continue;
    }
    found = true;
    for (const key of ["input", "output", "cacheRead", "cacheWrite"] as const) {
      usage[key] += message.usage[key];
      usage.cost[key] += message.usage.cost?.[key] ?? 0;
    }
    usage.cost.total += message.usage.cost?.total ?? 0;
  }
  return found ? { usage, durationMs, scope: "turn", complete } : undefined;
}

/** Equal derived values keep the memoized message body from rendering again. */
export function sameUsageSummary(a?: MessageUsageSummary, b?: MessageUsageSummary): boolean {
  if (a === b) return true;
  if (!a || !b || a.scope !== b.scope || a.complete !== b.complete || a.durationMs !== b.durationMs) return false;
  return a.usage.input === b.usage.input && a.usage.output === b.usage.output
    && a.usage.cacheRead === b.usage.cacheRead && a.usage.cacheWrite === b.usage.cacheWrite
    && a.usage.cost?.total === b.usage.cost?.total
    && (["input", "output", "cacheRead", "cacheWrite"] as const)
      .every((key) => a.usage.cost?.[key] === b.usage.cost?.[key]);
}
