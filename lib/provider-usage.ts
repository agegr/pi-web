import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { ProviderUsageId } from "./provider-usage-ids";

export { PROVIDER_USAGE_IDS, isProviderUsageId, type ProviderUsageId } from "./provider-usage-ids";

// Query formats follow @narumitw/pi-usage (MIT, Copyright (c) 2026 narumiruna),
// but this module deliberately has no runtime dependency on that extension.

export type UsageUnit = "percent" | "currency" | "count";

export interface UsageBucket {
  id: string;
  label: string;
  groupLabel?: string;
  used?: number;
  remaining?: number;
  limit?: number;
  unit: UsageUnit;
  currency?: string;
  windowMinutes?: number;
  resetsAt?: number;
  period?: string;
}

export interface UsageMetric {
  id: string;
  label: string;
  value: number | string;
  unit?: UsageUnit;
  currency?: string;
}

export interface UsageReport {
  providerId: ProviderUsageId;
  providerName: string;
  capturedAt: number;
  buckets: UsageBucket[];
  metrics: UsageMetric[];
  notes?: string[];
}

export type ProviderUsageResult =
  | { providerId: ProviderUsageId; status: "ready"; report: UsageReport }
  | { providerId: ProviderUsageId; status: "auth-unavailable" | "query-failed"; message: string };

const ENDPOINTS: Record<ProviderUsageId, string> = {
  "openai-codex": "https://chatgpt.com/backend-api/wham/usage",
  deepseek: "https://api.deepseek.com/user/balance",
  openrouter: "https://openrouter.ai/api/v1/key",
  moonshotai: "https://api.moonshot.ai/v1/users/me/balance",
  "moonshotai-cn": "https://api.moonshot.cn/v1/users/me/balance",
  minimax: "https://api.minimax.io",
  "minimax-cn": "https://api.minimaxi.com",
  "vercel-ai-gateway": "https://ai-gateway.vercel.sh/v1/credits",
};

const PROVIDER_NAMES: Record<ProviderUsageId, string> = {
  "openai-codex": "OpenAI Codex",
  deepseek: "DeepSeek",
  openrouter: "OpenRouter",
  moonshotai: "Moonshot AI",
  "moonshotai-cn": "Moonshot AI CN",
  minimax: "MiniMax",
  "minimax-cn": "MiniMax CN",
  "vercel-ai-gateway": "Vercel AI Gateway",
};

const CURRENCY: Record<"moonshotai" | "moonshotai-cn" | "minimax" | "minimax-cn", string> = {
  moonshotai: "USD",
  "moonshotai-cn": "CNY",
  minimax: "USD",
  "minimax-cn": "CNY",
};

export async function queryProviderUsage(providerId: ProviderUsageId): Promise<ProviderUsageResult> {
  const runtime = await ModelRuntime.create({ refreshOnCreate: false });
  const provider = runtime.getProvider(providerId);
  if (!provider || !isOfficialProviderUsageOrigin(providerId, provider.baseUrl)) {
    return { providerId, status: "query-failed", message: "The provider usage query failed." };
  }
  let resolved;
  try {
    resolved = await runtime.getAuth(providerId);
  } catch {
    return { providerId, status: "auth-unavailable", message: "Provider authentication is unavailable." };
  }
  if (!resolved) {
    return { providerId, status: "auth-unavailable", message: "Connect this provider before querying usage." };
  }

  try {
    const payload = await fetchJson(providerId, resolved.auth);
    const capturedAt = Date.now();
    return {
      providerId,
      status: "ready",
      report: normalize(providerId, payload, capturedAt),
    };
  } catch {
    return { providerId, status: "query-failed", message: "The provider usage query failed." };
  }
}

async function fetchJson(providerId: ProviderUsageId, auth: {
  apiKey?: string;
  headers?: Record<string, string | null>;
  baseUrl?: string;
}): Promise<Record<string, unknown>> {
  if (auth.baseUrl && !isOfficialProviderUsageOrigin(providerId, auth.baseUrl)) {
    throw new Error("A custom provider origin cannot be used for official usage queries.");
  }
  const headers = new Headers();
  for (const [name, value] of Object.entries(auth.headers ?? {})) {
    if (typeof value === "string") headers.set(name, value);
  }
  if (!headers.has("authorization") && auth.apiKey) headers.set("Authorization", `Bearer ${auth.apiKey}`);

  let endpoint = ENDPOINTS[providerId];
  if (providerId === "minimax" || providerId === "minimax-cn") {
    const token = bearerToken(headers.get("authorization")) ?? auth.apiKey;
    endpoint += token?.startsWith("sk-api-") ? "/account/query_balance" : "/v1/token_plan/remains";
  }
  const response = await fetch(endpoint, {
    headers,
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.text();
  if (body.length > 65_536) throw new Error("Usage response was too large.");
  if (!response.ok) throw new Error(`Usage endpoint returned ${response.status}.`);
  const parsed: unknown = JSON.parse(body);
  if (!isRecord(parsed)) throw new Error("Usage response was not an object.");
  return parsed;
}

export function isOfficialProviderUsageOrigin(providerId: ProviderUsageId, baseUrl: string | undefined): boolean {
  if (!baseUrl) return false;
  try {
    return new URL(baseUrl).origin === new URL(ENDPOINTS[providerId]).origin;
  } catch {
    return false;
  }
}

function normalize(providerId: ProviderUsageId, payload: Record<string, unknown>, capturedAt: number): UsageReport {
  switch (providerId) {
    case "openai-codex": return normalizeCodex(payload, capturedAt);
    case "deepseek": return normalizeDeepSeek(payload, capturedAt);
    case "openrouter": return normalizeOpenRouter(payload, capturedAt);
    case "vercel-ai-gateway": return normalizeVercel(payload, capturedAt);
    case "moonshotai":
    case "moonshotai-cn": return normalizeMoonshot(providerId, payload, capturedAt);
    case "minimax":
    case "minimax-cn": return normalizeMiniMax(providerId, payload, capturedAt);
  }
}

export function normalizeProviderUsagePayload(
  providerId: ProviderUsageId,
  payload: Record<string, unknown>,
  capturedAt = Date.now(),
): UsageReport {
  return normalize(providerId, payload, capturedAt);
}

function normalizeCodex(payload: Record<string, unknown>, capturedAt: number): UsageReport {
  const buckets: UsageBucket[] = [];
  const addGroup = (group: Record<string, unknown>, groupLabel: string, groupId: string) => {
    for (const [position, raw] of [["primary", group.primary_window], ["secondary", group.secondary_window]] as const) {
      const window = record(raw);
      const used = number(window?.used_percent);
      if (used === undefined) continue;
      const seconds = number(window?.limit_window_seconds);
      buckets.push({
        id: `${groupId}:${position}`,
        label: windowLabel(seconds),
        ...(groupId === "codex" ? {} : { groupLabel }),
        used: clamp(used),
        remaining: 100 - clamp(used),
        limit: 100,
        unit: "percent",
        ...(seconds && seconds > 0 ? { windowMinutes: Math.ceil(seconds / 60) } : {}),
        ...(number(window?.reset_at) !== undefined ? { resetsAt: number(window?.reset_at) } : {}),
      });
    }
  };
  const rateLimit = record(payload.rate_limit);
  if (rateLimit) addGroup(rateLimit, "Codex", "codex");
  const additional = Array.isArray(payload.additional_rate_limits) ? payload.additional_rate_limits : [];
  additional.forEach((item, index) => {
    const value = record(item);
    const rate = record(value?.rate_limit);
    if (rate) addGroup(rate, stringValue(value?.limit_name) ?? `Limit ${index + 1}`, stringValue(value?.metered_feature) ?? `additional-${index}`);
  });
  const metrics: UsageMetric[] = [];
  const credits = record(payload.credits);
  if (credits?.unlimited === true) metrics.push({ id: "credits", label: "Credits", value: "Unlimited" });
  else if (number(credits?.balance) !== undefined) metrics.push({ id: "credits", label: "Credits", value: number(credits?.balance)!, unit: "count" });
  if (!buckets.length && !metrics.length) throw new Error("Codex returned no usage data.");
  return { providerId: "openai-codex", providerName: PROVIDER_NAMES["openai-codex"], capturedAt, buckets, metrics };
}

function normalizeDeepSeek(payload: Record<string, unknown>, capturedAt: number): UsageReport {
  const metrics: UsageMetric[] = [{ id: "availability", label: "API calls", value: payload.is_available === true ? "Available" : "Unavailable" }];
  const rows = Array.isArray(payload.balance_infos) ? payload.balance_infos : [];
  for (const row of rows) {
    const value = record(row);
    const currency = value?.currency === "CNY" || value?.currency === "USD" ? value.currency : undefined;
    if (!currency) continue;
    for (const [id, label, field] of [["total", "Total balance", "total_balance"], ["granted", "Granted balance", "granted_balance"], ["topped-up", "Topped-up balance", "topped_up_balance"]] as const) {
      const amount = decimal(value?.[field]);
      if (amount !== undefined) metrics.push({ id: `${currency.toLowerCase()}-${id}`, label, value: amount, unit: "currency", currency });
    }
  }
  if (rows.length === 0) throw new Error("DeepSeek returned no balance data.");
  return { providerId: "deepseek", providerName: PROVIDER_NAMES.deepseek, capturedAt, buckets: [], metrics };
}

function normalizeOpenRouter(payload: Record<string, unknown>, capturedAt: number): UsageReport {
  const data = record(payload.data);
  if (!data) throw new Error("OpenRouter returned no key data.");
  const buckets: UsageBucket[] = [];
  const limit = nonnegative(data.limit);
  const remaining = nonnegative(data.limit_remaining);
  if (limit !== undefined) buckets.push({ id: "key-limit", label: "Key limit", limit, ...(remaining !== undefined ? { remaining, used: Math.max(0, limit - remaining) } : {}), unit: "currency", currency: "USD", ...(stringValue(data.limit_reset) ? { period: stringValue(data.limit_reset) } : {}) });
  const metrics: UsageMetric[] = [];
  for (const [id, label, field] of [["daily", "Usage today", "usage_daily"], ["weekly", "Usage this week", "usage_weekly"], ["monthly", "Usage this month", "usage_monthly"], ["total", "All-time usage", "usage"]] as const) {
    const amount = nonnegative(data[field]);
    if (amount !== undefined) metrics.push({ id, label, value: amount, unit: "currency", currency: "USD" });
  }
  if (!buckets.length && !metrics.length) throw new Error("OpenRouter returned no usage data.");
  return { providerId: "openrouter", providerName: PROVIDER_NAMES.openrouter, capturedAt, buckets, metrics };
}

function normalizeVercel(payload: Record<string, unknown>, capturedAt: number): UsageReport {
  const balance = decimal(payload.balance);
  const used = decimal(payload.total_used);
  if (balance === undefined && used === undefined) throw new Error("Vercel returned no credit data.");
  return {
    providerId: "vercel-ai-gateway",
    providerName: PROVIDER_NAMES["vercel-ai-gateway"],
    capturedAt,
    buckets: [],
    metrics: [
      ...(balance !== undefined ? [{ id: "balance", label: "Credit balance", value: balance, unit: "currency" as const, currency: "USD" }] : []),
      ...(used !== undefined ? [{ id: "spent", label: "Lifetime spend", value: used, unit: "currency" as const, currency: "USD" }] : []),
    ],
  };
}

function normalizeMoonshot(providerId: "moonshotai" | "moonshotai-cn", payload: Record<string, unknown>, capturedAt: number): UsageReport {
  const data = record(payload.data);
  if (payload.code !== 0 || payload.status !== true || !data) throw new Error("Moonshot returned an unsuccessful response.");
  const metrics = [
    ["available", "Available balance", data.available_balance],
    ["voucher", "Voucher balance", data.voucher_balance],
    ["cash", "Cash balance", data.cash_balance],
  ].flatMap(([id, label, value]) => {
    const amount = number(value);
    return amount === undefined ? [] : [{ id: String(id), label: String(label), value: String(amount), unit: "currency" as const, currency: CURRENCY[providerId] }];
  });
  if (!metrics.length) throw new Error("Moonshot returned no balance data.");
  return { providerId, providerName: PROVIDER_NAMES[providerId], capturedAt, buckets: [], metrics };
}

function normalizeMiniMax(providerId: "minimax" | "minimax-cn", payload: Record<string, unknown>, capturedAt: number): UsageReport {
  const base = record(payload.base_resp);
  if (base && base.status_code !== 0) throw new Error("MiniMax returned an unsuccessful response.");
  if (Array.isArray(payload.model_remains)) {
    const buckets: UsageBucket[] = [];
    for (const [index, rowValue] of payload.model_remains.entries()) {
      const row = record(rowValue);
      if (!row) continue;
      const groupLabel = stringValue(row.model_name) ?? `Quota ${index + 1}`;
      addMiniMaxWindow(buckets, row, groupLabel, "interval", "current_interval_remaining_percent", "current_interval_usage_count", "current_interval_total_count", "end_time", "start_time");
      addMiniMaxWindow(buckets, row, groupLabel, "weekly", "current_weekly_remaining_percent", "current_weekly_usage_count", "current_weekly_total_count", "weekly_end_time", "weekly_start_time");
    }
    if (!buckets.length) throw new Error("MiniMax returned no quota data.");
    return { providerId, providerName: PROVIDER_NAMES[providerId], capturedAt, buckets, metrics: [] };
  }
  const metrics = [
    ["available", "Available balance", payload.available_amount],
    ["cash", "Cash balance", payload.cash_balance],
    ["voucher", "Voucher balance", payload.voucher_balance],
    ["credit", "Credit balance", payload.credit_balance],
  ].flatMap(([id, label, value]) => {
    const amount = decimal(value);
    return amount === undefined ? [] : [{ id: String(id), label: String(label), value: amount, unit: "currency" as const, currency: CURRENCY[providerId] }];
  });
  if (!metrics.length) throw new Error("MiniMax returned no balance data.");
  return { providerId, providerName: PROVIDER_NAMES[providerId], capturedAt, buckets: [], metrics };
}

function addMiniMaxWindow(buckets: UsageBucket[], row: Record<string, unknown>, groupLabel: string, suffix: string, percentField: string, countField: string, totalField: string, endField: string, startField: string): void {
  const status = number(row[`${suffix === "interval" ? "current_interval" : "current_weekly"}_status`]);
  const end = number(row[endField]);
  const start = number(row[startField]);
  const percent = nonnegative(row[percentField]);
  if (status === 3) {
    buckets.push({ id: `${groupLabel}:${suffix}`, label: suffix === "weekly" ? "Weekly" : "Rolling", groupLabel, remaining: 100, unit: "percent", period: "Unlimited" });
    return;
  }
  const total = nonnegativeInteger(row[totalField]);
  const count = nonnegativeInteger(row[countField]);
  if (total === undefined && percent === undefined) return;
  const windowMinutes = end !== undefined && start !== undefined ? Math.max(1, Math.round((end - start) / 60_000)) : undefined;
  const resetsAt = end !== undefined ? Math.floor(end / 1_000) : undefined;
  if (total && count !== undefined) {
    let remaining = count;
    if (percent !== undefined) {
      const asRemaining = count / total * 100;
      const asUsed = (total - count) / total * 100;
      if (Math.abs(asUsed - percent) < Math.abs(asRemaining - percent)) remaining = total - count;
    }
    buckets.push({ id: `${groupLabel}:${suffix}`, label: suffix === "weekly" ? "Weekly" : "Rolling", groupLabel, used: total - remaining, remaining, limit: total, unit: "count", ...(windowMinutes ? { windowMinutes } : {}), ...(resetsAt ? { resetsAt } : {}) });
    return;
  }
  buckets.push({ id: `${groupLabel}:${suffix}`, label: suffix === "weekly" ? "Weekly" : "Rolling", groupLabel, used: 100 - clamp(percent!), remaining: clamp(percent!), limit: 100, unit: "percent", ...(windowMinutes ? { windowMinutes } : {}), ...(resetsAt ? { resetsAt } : {}) });
}

function windowLabel(seconds: number | undefined): string {
  if (!seconds || seconds <= 0) return "Limit";
  const minutes = Math.ceil(seconds / 60);
  if (minutes >= 10_080) return "Weekly";
  if (minutes >= 60) return `${Math.round(minutes / 60)}h`;
  return `${minutes}m`;
}

function bearerToken(value: string | null): string | undefined {
  const match = value?.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/gu, "").trim().slice(0, 80);
  return cleaned || undefined;
}

function number(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function nonnegative(value: unknown): number | undefined {
  const result = number(value);
  return result !== undefined && result >= 0 ? result : undefined;
}

function nonnegativeInteger(value: unknown): number | undefined {
  const result = nonnegative(value);
  return result !== undefined && Number.isSafeInteger(result) ? result : undefined;
}

function decimal(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(value) && value.length <= 64) return value;
  return undefined;
}

function clamp(value: number): number {
  return Math.min(100, Math.max(0, value));
}
