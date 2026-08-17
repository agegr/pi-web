/**
 * Read-only subscription quota checks for the Robin assistant.
 *
 * OAuth access is resolved by Pi's model registry, which refreshes expiring
 * credentials. Tokens stay in request headers and are never returned, logged,
 * or stored by Robin. The provider endpoints are not a stable cross-provider
 * standard, so parsing is deliberately defensive and failures stay isolated.
 */

export type SubscriptionProvider = "openai-codex" | "anthropic";

export interface UsageWindow {
  label: string;
  usedPercent: number;
  resetAt?: number;
}

export interface ProviderUsage {
  provider: SubscriptionProvider;
  displayName: string;
  windows: UsageWindow[];
  plan?: string;
  creditBalance?: number;
  extraUsageEnabled?: boolean;
  error?: string;
}

export interface ResolvedSubscriptionAuth {
  token?: string;
  source?: string;
}

export type ResolveSubscriptionAuth = (
  provider: SubscriptionProvider,
) => Promise<ResolvedSubscriptionAuth | undefined>;

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
type UnknownRecord = Record<string, unknown>;

const REQUEST_TIMEOUT_MS = 10_000;

function record(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function percent(value: unknown): number | undefined {
  const parsed = finiteNumber(value);
  return parsed === undefined ? undefined : Math.min(100, Math.max(0, parsed));
}

function resetTime(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 10_000_000_000 ? value * 1000 : value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function durationLabel(seconds: unknown): string {
  const value = finiteNumber(seconds);
  if (!value || value <= 0) return "Usage window";
  if (value % 86_400 === 0) {
    const days = value / 86_400;
    return `${days} day${days === 1 ? "" : "s"}`;
  }
  const hours = Math.round(value / 3600);
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

function parseOpenAIWindow(value: unknown, prefix = "", now = Date.now()): UsageWindow | null {
  const window = record(value);
  if (!window) return null;
  const usedPercent = percent(window.used_percent);
  if (usedPercent === undefined) return null;
  const resetAt = resetTime(window.reset_at)
    ?? (finiteNumber(window.reset_after_seconds) !== undefined
      ? now + finiteNumber(window.reset_after_seconds)! * 1000
      : undefined);
  return {
    label: `${prefix}${durationLabel(window.limit_window_seconds)}`,
    usedPercent,
    ...(resetAt !== undefined ? { resetAt } : {}),
  };
}

export function parseOpenAIUsage(value: unknown, now = Date.now()): ProviderUsage {
  const data = record(value) ?? {};
  const windows: UsageWindow[] = [];
  const rateLimit = record(data.rate_limit);
  const codeReview = record(data.code_review_rate_limit);
  for (const [source, prefix] of [[rateLimit, ""], [codeReview, "Code review · "]] as const) {
    const primary = parseOpenAIWindow(source?.primary_window, prefix, now);
    const secondary = parseOpenAIWindow(source?.secondary_window, prefix, now);
    if (primary) windows.push(primary);
    if (secondary) windows.push(secondary);
  }

  const plan = typeof data.plan_type === "string" && data.plan_type.trim()
    ? data.plan_type.trim()
    : undefined;
  const credits = record(data.credits);
  const balance = finiteNumber(credits?.balance);
  const hasCredits = credits?.has_credits === true || (balance ?? 0) > 0;

  return {
    provider: "openai-codex",
    displayName: "OpenAI Codex",
    windows,
    ...(plan ? { plan } : {}),
    ...(hasCredits && balance !== undefined ? { creditBalance: balance } : {}),
  };
}

const ANTHROPIC_WINDOWS: Array<[string, string]> = [
  ["five_hour", "5 hours"],
  ["seven_day", "7 days"],
  ["seven_day_oauth_apps", "OAuth apps · 7 days"],
  ["seven_day_sonnet", "Sonnet · 7 days"],
  ["seven_day_opus", "Opus · 7 days"],
  ["seven_day_cowork", "Cowork · 7 days"],
];

export function parseAnthropicUsage(value: unknown): ProviderUsage {
  const data = record(value) ?? {};
  const windows = ANTHROPIC_WINDOWS.flatMap(([key, label]) => {
    const window = record(data[key]);
    const usedPercent = percent(window?.utilization);
    if (usedPercent === undefined) return [];
    const resetAt = resetTime(window?.resets_at);
    return [{ label, usedPercent, ...(resetAt !== undefined ? { resetAt } : {}) }];
  });
  const extraUsage = record(data.extra_usage);

  return {
    provider: "anthropic",
    displayName: "Anthropic Claude",
    windows,
    ...(typeof extraUsage?.is_enabled === "boolean"
      ? { extraUsageEnabled: extraUsage.is_enabled }
      : {}),
  };
}

function requestSignal(parent?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return parent ? AbortSignal.any([parent, timeout]) : timeout;
}

async function fetchOne(
  provider: SubscriptionProvider,
  resolveAuth: ResolveSubscriptionAuth,
  fetchFn: FetchLike,
  signal?: AbortSignal,
): Promise<ProviderUsage> {
  const displayName = provider === "openai-codex" ? "OpenAI Codex" : "Anthropic Claude";
  try {
    const resolved = await resolveAuth(provider);
    if (!resolved?.token || resolved.source !== "OAuth") {
      return {
        provider,
        displayName,
        windows: [],
        error: `Subscription OAuth is not active; run /login ${provider}`,
      };
    }

    const response = provider === "openai-codex"
      ? await fetchFn("https://chatgpt.com/backend-api/wham/usage", {
        headers: {
          Authorization: `Bearer ${resolved.token}`,
          Accept: "application/json",
        },
        cache: "no-store",
        signal: requestSignal(signal),
      })
      : await fetchFn("https://api.anthropic.com/api/oauth/usage", {
        headers: {
          Authorization: `Bearer ${resolved.token}`,
          Accept: "application/json",
          "anthropic-version": "2023-06-01",
          "anthropic-beta": "oauth-2025-04-20",
        },
        cache: "no-store",
        signal: requestSignal(signal),
      });

    if (!response.ok) {
      const error = response.status === 401 || response.status === 403
        ? "OAuth access was rejected; sign in again with /login"
        : `Provider usage endpoint returned HTTP ${response.status}`;
      return { provider, displayName, windows: [], error };
    }

    const data: unknown = await response.json();
    const usage = provider === "openai-codex"
      ? parseOpenAIUsage(data)
      : parseAnthropicUsage(data);
    if (usage.windows.length === 0) usage.error = "Provider returned no recognizable quota windows";
    return usage;
  } catch (error) {
    const cancelled = signal?.aborted || (error instanceof Error && error.name === "AbortError");
    return {
      provider,
      displayName,
      windows: [],
      error: cancelled ? "Usage check cancelled" : "Could not reach the provider usage endpoint",
    };
  }
}

export async function fetchSubscriptionUsage(
  resolveAuth: ResolveSubscriptionAuth,
  options: { fetchFn?: FetchLike; signal?: AbortSignal } = {},
): Promise<ProviderUsage[]> {
  const fetchFn = options.fetchFn ?? fetch;
  return Promise.all([
    fetchOne("openai-codex", resolveAuth, fetchFn, options.signal),
    fetchOne("anthropic", resolveAuth, fetchFn, options.signal),
  ]);
}

function remainingTime(resetAt: number, now: number): string {
  const remainingMs = resetAt - now;
  if (remainingMs <= 0) return "reset time has passed";
  const minutes = Math.max(1, Math.ceil(remainingMs / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return `in ${days}d ${hours}h`;
  if (hours > 0) return `in ${hours}h ${mins}m`;
  return `in ${mins}m`;
}

export function formatSubscriptionUsage(results: ProviderUsage[], now = Date.now()): string {
  const lines = [`Provider-reported subscription usage as of ${new Date(now).toISOString()}:`];
  for (const usage of results) {
    lines.push(`\n${usage.displayName}${usage.plan ? ` (${usage.plan})` : ""}:`);
    for (const window of usage.windows) {
      const remaining = Math.max(0, 100 - window.usedPercent);
      const reset = window.resetAt === undefined
        ? "reset time unavailable"
        : `resets ${new Date(window.resetAt).toISOString()} (${remainingTime(window.resetAt, now)})`;
      lines.push(`- ${window.label}: ${window.usedPercent}% used, ${remaining}% remaining; ${reset}`);
    }
    if (usage.creditBalance !== undefined) {
      lines.push(`- Extra credit balance: $${usage.creditBalance.toFixed(2)}`);
    }
    if (usage.extraUsageEnabled !== undefined) {
      lines.push(`- Extra usage: ${usage.extraUsageEnabled ? "enabled" : "disabled"}`);
    }
    if (usage.error) lines.push(`- Unavailable: ${usage.error}`);
  }
  lines.push("\nThese are account quota windows, not this conversation's context-token count. Provider endpoints may change without notice.");
  return lines.join("\n");
}
