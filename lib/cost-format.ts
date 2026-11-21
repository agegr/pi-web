// Client-safe cost formatting and currency display configuration.

export type CostCurrency = "USD" | "CNY";

export interface CostDisplaySettings {
  costCurrency: CostCurrency;
  usdToCnyRate: number;
}

export const DEFAULT_USD_TO_CNY_RATE = 7.2;

export const DEFAULT_COST_DISPLAY_SETTINGS: CostDisplaySettings = {
  costCurrency: "USD",
  usdToCnyRate: DEFAULT_USD_TO_CNY_RATE,
};

let activeSettings: CostDisplaySettings = { ...DEFAULT_COST_DISPLAY_SETTINGS };
const listeners = new Set<() => void>();

export function normalizeCostDisplaySettings(raw: unknown): CostDisplaySettings {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_COST_DISPLAY_SETTINGS };
  }
  const obj = raw as Record<string, unknown>;
  const costCurrency: CostCurrency = obj.costCurrency === "CNY" ? "CNY" : "USD";
  const rawRate = obj.usdToCnyRate;
  const usdToCnyRate =
    typeof rawRate === "number" && Number.isFinite(rawRate) && rawRate > 0
      ? rawRate
      : DEFAULT_USD_TO_CNY_RATE;
  return { costCurrency, usdToCnyRate };
}

export function getCostDisplaySettings(): CostDisplaySettings {
  return activeSettings;
}

export function setCostDisplaySettings(settings: CostDisplaySettings): void {
  const next = normalizeCostDisplaySettings(settings);
  if (
    next.costCurrency === activeSettings.costCurrency
    && next.usdToCnyRate === activeSettings.usdToCnyRate
  ) {
    return;
  }
  activeSettings = next;
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeCostDisplaySettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getCostCurrencySymbol(settings: CostDisplaySettings = activeSettings): string {
  return settings.costCurrency === "CNY" ? "¥" : "$";
}

export function convertCost(costUsd: number, settings: CostDisplaySettings = activeSettings): number {
  if (settings.costCurrency === "CNY") {
    return costUsd * settings.usdToCnyRate;
  }
  return costUsd;
}

/** Format a USD cost in the configured currency with fixed decimal places (default 4). */
export function formatCost(
  costUsd: number,
  decimals = 4,
  settings: CostDisplaySettings = activeSettings,
): string {
  const symbol = getCostCurrencySymbol(settings);
  const converted = convertCost(costUsd, settings);
  return `${symbol}${converted.toFixed(decimals)}`;
}

/** $0.12 · <$0.01 · ¥0.86 · <¥0.01 · null when nothing was billed. */
export function formatCostShort(
  costUsd: number,
  settings: CostDisplaySettings = activeSettings,
): string | null {
  if (!(costUsd > 0)) return null;
  const symbol = getCostCurrencySymbol(settings);
  const converted = convertCost(costUsd, settings);
  return converted >= 0.01 ? `${symbol}${converted.toFixed(2)}` : `<${symbol}0.01`;
}
