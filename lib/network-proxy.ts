import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "./atomic-file";
import { detectWindowsSystemProxy, type WindowsSystemProxyStatus } from "./windows-system-proxy";

const LOOPBACK_NO_PROXY = ["localhost", "127.0.0.1", "::1"];
const PROXY_ENV_KEYS = [
  "HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy",
  "ALL_PROXY", "all_proxy", "NO_PROXY", "no_proxy",
] as const;

export type NetworkProxySource = "environment" | "saved" | "windows-system" | "direct";

export interface ProxySettings {
  enabled: boolean;
  httpProxy?: string;
  httpsProxy?: string;
  noProxy: string;
}

export interface SavedNetworkProxyConfig extends ProxySettings {
  version: 1;
}

export interface EffectiveNetworkProxyConfig extends ProxySettings {
  source: NetworkProxySource;
  environmentLocked: boolean;
}

export interface PublicProxyValue {
  value?: string;
  hasCredentials: boolean;
}

export interface NetworkProxyStatus {
  effective: {
    source: NetworkProxySource;
    enabled: boolean;
    httpProxy: PublicProxyValue;
    httpsProxy: PublicProxyValue;
    noProxy: string;
    environmentLocked: boolean;
  };
  saved: SavedNetworkProxyConfig | null;
  windows: WindowsSystemProxyStatus;
}

function firstEnvironmentValue(...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

function normalizeProxyUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const withProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  const parsed = new URL(withProtocol);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Proxy URL must use http:// or https://");
  }
  if (!parsed.hostname) throw new Error("Proxy URL must include a hostname");
  return parsed.toString().replace(/\/$/, "");
}

export function normalizeNoProxy(value: string | undefined): string {
  const seen = new Set<string>();
  const entries: string[] = [];
  const rawEntries = (value ?? "").split(/[;,]/);
  const bypassesAll = rawEntries.some((entry) => entry.trim() === "*");
  for (const entry of [...(bypassesAll ? [] : LOOPBACK_NO_PROXY), ...rawEntries]) {
    const normalized = entry.trim();
    if (!normalized || seen.has(normalized.toLowerCase())) continue;
    seen.add(normalized.toLowerCase());
    entries.push(normalized);
  }
  return entries.join(",");
}

export function normalizeProxySettings(input: Partial<ProxySettings>): ProxySettings {
  const enabled = input.enabled !== false;
  const httpProxy = normalizeProxyUrl(input.httpProxy);
  const httpsProxy = normalizeProxyUrl(input.httpsProxy);
  if (enabled && !httpProxy && !httpsProxy) {
    throw new Error("At least one HTTP or HTTPS proxy URL is required when proxying is enabled");
  }
  return {
    enabled,
    httpProxy: enabled ? httpProxy : undefined,
    httpsProxy: enabled ? httpsProxy : undefined,
    noProxy: normalizeNoProxy(input.noProxy),
  };
}

export function getNetworkConfigPath(agentDir = getAgentDir()): string {
  return join(agentDir, "pi-web-network.json");
}

export function readSavedNetworkProxyConfig(path = getNetworkConfigPath()): SavedNetworkProxyConfig | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<SavedNetworkProxyConfig>;
    if (parsed.version !== 1 || typeof parsed.enabled !== "boolean") return null;
    return { version: 1, ...normalizeProxySettings(parsed) };
  } catch {
    return null;
  }
}

export function writeSavedNetworkProxyConfig(
  input: Partial<ProxySettings>,
  path = getNetworkConfigPath(),
): SavedNetworkProxyConfig {
  const config: SavedNetworkProxyConfig = { version: 1, ...normalizeProxySettings(input) };
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writePrivateFileAtomicSync(path, `${JSON.stringify(config, null, 2)}\n`);
  return config;
}

export function clearSavedNetworkProxyConfig(path = getNetworkConfigPath()): void {
  rmSync(path, { force: true });
}

function environmentProxySettings(): EffectiveNetworkProxyConfig | null {
  const allProxy = firstEnvironmentValue("ALL_PROXY", "all_proxy");
  const httpProxy = firstEnvironmentValue("HTTP_PROXY", "http_proxy") ?? allProxy;
  const httpsProxy = firstEnvironmentValue("HTTPS_PROXY", "https_proxy") ?? allProxy;
  if (!httpProxy && !httpsProxy) return null;
  return {
    source: "environment",
    environmentLocked: true,
    ...normalizeProxySettings({
      enabled: true,
      httpProxy,
      httpsProxy,
      noProxy: firstEnvironmentValue("NO_PROXY", "no_proxy"),
    }),
  };
}

export async function resolveEffectiveNetworkProxy(
  options: { configPath?: string; windows?: WindowsSystemProxyStatus } = {},
): Promise<{ effective: EffectiveNetworkProxyConfig; saved: SavedNetworkProxyConfig | null; windows: WindowsSystemProxyStatus }> {
  const windows = options.windows ?? await detectWindowsSystemProxy();
  const saved = readSavedNetworkProxyConfig(options.configPath);
  const environment = environmentProxySettings();
  if (environment) return { effective: environment, saved, windows };

  if (saved) {
    return {
      effective: { source: "saved", environmentLocked: false, ...saved },
      saved,
      windows,
    };
  }

  if (windows.proxyEnabled && (windows.httpProxy || windows.httpsProxy)) {
    return {
      effective: {
        source: "windows-system",
        environmentLocked: false,
        ...normalizeProxySettings({
          enabled: true,
          httpProxy: windows.httpProxy,
          httpsProxy: windows.httpsProxy,
          noProxy: windows.noProxy,
        }),
      },
      saved,
      windows,
    };
  }

  return {
    effective: {
      source: "direct",
      environmentLocked: false,
      enabled: false,
      noProxy: normalizeNoProxy(windows.noProxy),
    },
    saved,
    windows,
  };
}

function publicProxyValue(value: string | undefined): PublicProxyValue {
  if (!value) return { hasCredentials: false };
  try {
    const parsed = new URL(value);
    const hasCredentials = Boolean(parsed.username || parsed.password);
    if (hasCredentials) {
      if (parsed.username) parsed.username = "***";
      if (parsed.password) parsed.password = "***";
    }
    return { value: parsed.toString().replace(/\/$/, ""), hasCredentials };
  } catch {
    return { value: "(invalid proxy URL)", hasCredentials: false };
  }
}

export function toPublicNetworkProxyStatus(
  resolved: Awaited<ReturnType<typeof resolveEffectiveNetworkProxy>>,
): NetworkProxyStatus {
  const { effective, saved, windows } = resolved;
  const publicSaved = saved ? {
    ...saved,
    httpProxy: publicProxyValue(saved.httpProxy).value,
    httpsProxy: publicProxyValue(saved.httpsProxy).value,
  } : null;
  return {
    effective: {
      source: effective.source,
      enabled: effective.enabled,
      httpProxy: publicProxyValue(effective.httpProxy),
      httpsProxy: publicProxyValue(effective.httpsProxy),
      noProxy: effective.noProxy,
      environmentLocked: effective.environmentLocked,
    },
    saved: publicSaved,
    windows: {
      ...windows,
      httpProxy: publicProxyValue(windows.httpProxy).value,
      httpsProxy: publicProxyValue(windows.httpsProxy).value,
    },
  };
}

export function proxyEnvironmentSnapshot(): Record<string, string | undefined> {
  return Object.fromEntries(PROXY_ENV_KEYS.map((key) => [key, process.env[key]]));
}
