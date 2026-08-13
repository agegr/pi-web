import type { ContextUsage, SessionStatsInfo } from "./pi-types";

export interface ConversationContextModel {
  percent: number | null;
  usedTokens: number | null;
  contextWindow: number;
  availableTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  cacheWrite: number;
  cacheRate: number;
  totalTokens: number;
  modelLabel: string;
  cost: number;
}

export function buildConversationContextModel({
  stats,
  contextUsage,
  modelLabel,
}: {
  stats: SessionStatsInfo;
  contextUsage: ContextUsage | null;
  modelLabel: string | null;
}): ConversationContextModel {
  const ctx = contextUsage ?? stats.contextUsage ?? null;
  const contextWindow = Math.max(0, ctx?.contextWindow ?? 0);
  const usedTokens = ctx?.tokens == null ? null : Math.max(0, ctx.tokens);
  const percent = ctx?.percent == null ? null : Math.min(100, Math.max(0, ctx.percent));
  const cacheDenominator = stats.tokens.input + stats.tokens.cacheRead + stats.tokens.cacheWrite;
  return {
    percent,
    usedTokens,
    contextWindow,
    availableTokens: Math.max(0, contextWindow - (usedTokens ?? 0)),
    inputTokens: stats.tokens.input,
    outputTokens: stats.tokens.output,
    cacheRead: stats.tokens.cacheRead,
    cacheWrite: stats.tokens.cacheWrite,
    cacheRate: cacheDenominator > 0 ? Number((stats.tokens.cacheRead / cacheDenominator * 100).toFixed(1)) : 0,
    totalTokens: stats.tokens.total,
    modelLabel: modelLabel ?? "",
    cost: stats.cost,
  };
}

export function formatCompact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 100_000) return `${Math.round(value / 1_000)}k`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(value);
}
