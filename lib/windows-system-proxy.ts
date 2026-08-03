import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const INTERNET_SETTINGS_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings";

export interface WindowsSystemProxyStatus {
  available: boolean;
  proxyEnabled: boolean;
  httpProxy?: string;
  httpsProxy?: string;
  noProxy?: string;
  autoConfigUrl?: string;
  autoDetect: boolean;
  error?: string;
}

function registryValue(output: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = output.match(new RegExp(`^\\s*${escaped}\\s+REG_\\w+\\s+(.*?)\\s*$`, "mi"));
  return match?.[1]?.trim() || undefined;
}

function registryBoolean(value: string | undefined): boolean {
  if (!value) return false;
  const numeric = value.toLowerCase().startsWith("0x")
    ? Number.parseInt(value.slice(2), 16)
    : Number.parseInt(value, 10);
  return Number.isFinite(numeric) && numeric !== 0;
}

function proxyUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

export function normalizeWindowsProxyOverride(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const entries = value
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => entry.toLowerCase() === "<local>" ? "<local>" : entry);
  return entries.length > 0 ? entries.join(",") : undefined;
}

export function parseWindowsProxyServer(value: string | undefined): Pick<WindowsSystemProxyStatus, "httpProxy" | "httpsProxy"> {
  const trimmed = value?.trim();
  if (!trimmed) return {};

  if (!trimmed.includes("=")) {
    const shared = proxyUrl(trimmed);
    return { httpProxy: shared, httpsProxy: shared };
  }

  const protocols = new Map<string, string>();
  for (const part of trimmed.split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    const protocol = part.slice(0, separator).trim().toLowerCase();
    const endpoint = part.slice(separator + 1).trim();
    if (protocol && endpoint) protocols.set(protocol, endpoint);
  }

  return {
    httpProxy: proxyUrl(protocols.get("http") ?? protocols.get("https")),
    httpsProxy: proxyUrl(protocols.get("https") ?? protocols.get("http")),
  };
}

export function parseWindowsInternetSettings(output: string): WindowsSystemProxyStatus {
  const proxyEnabled = registryBoolean(registryValue(output, "ProxyEnable"));
  const autoDetect = registryBoolean(registryValue(output, "AutoDetect"));
  const autoConfigUrl = registryValue(output, "AutoConfigURL");
  const proxies = proxyEnabled
    ? parseWindowsProxyServer(registryValue(output, "ProxyServer"))
    : {};

  return {
    available: true,
    proxyEnabled,
    ...proxies,
    noProxy: normalizeWindowsProxyOverride(registryValue(output, "ProxyOverride")),
    autoConfigUrl,
    autoDetect,
  };
}

export async function detectWindowsSystemProxy(): Promise<WindowsSystemProxyStatus> {
  if (process.platform !== "win32") {
    return {
      available: false,
      proxyEnabled: false,
      autoDetect: false,
      error: "Windows system proxy detection is only available on Windows",
    };
  }

  try {
    const { stdout } = await execFileAsync("reg.exe", ["query", INTERNET_SETTINGS_KEY], {
      windowsHide: true,
      timeout: 3_000,
      maxBuffer: 256 * 1024,
      encoding: "utf8",
    });
    return parseWindowsInternetSettings(stdout);
  } catch (error) {
    return {
      available: false,
      proxyEnabled: false,
      autoDetect: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
