import { isIP } from "node:net";
import { readRemoteAccessAllowedHosts } from "./remote-access-config";

function normalizeHostname(value: string): string {
  const unbracketed = value.startsWith("[") && value.endsWith("]")
    ? value.slice(1, -1)
    : value;
  return unbracketed.toLowerCase().replace(/\.$/, "");
}

function hostnameFromAuthority(value: string): string | null {
  if (!value || /[\s/@\\]/.test(value)) return null;
  try {
    const parsed = new URL(`http://${value}`);
    if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
      return null;
    }
    return normalizeHostname(parsed.hostname);
  } catch {
    return null;
  }
}

function normalizeConfiguredHostname(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return isIP(trimmed) ? normalizeHostname(trimmed) : hostnameFromAuthority(trimmed);
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname.endsWith(".localhost");
}

function configuredHostnamesFromEnvironment(): string[] {
  return [
    process.env.PI_WEB_HOSTNAME,
    ...(process.env.PI_WEB_ALLOWED_HOSTS?.split(",") ?? []),
  ].filter((value): value is string => Boolean(value?.trim()));
}

function configuredHostnames(): string[] {
  return [
    ...configuredHostnamesFromEnvironment(),
    ...readRemoteAccessAllowedHosts(),
  ];
}

function requestHostname(request: Request): string | null {
  const host = request.headers.get("host");
  return host ? hostnameFromAuthority(host) : null;
}

function isUserInitiatedSessionExportNavigation(request: Request): boolean {
  if (
    request.method !== "GET"
    || request.headers.get("sec-fetch-mode") !== "navigate"
    || request.headers.get("sec-fetch-dest") !== "document"
    || request.headers.get("sec-fetch-user") !== "?1"
  ) {
    return false;
  }

  try {
    return /^\/api\/sessions\/[^/]+\/export$/.test(new URL(request.url).pathname);
  } catch {
    return false;
  }
}

export function isLoopbackApiRequest(request: Request): boolean {
  const hostname = requestHostname(request);
  if (!hostname) return false;
  return isLoopbackHostname(hostname) || hostname === "127.0.0.1" || hostname === "::1";
}

/**
 * Only trust local names, IP literals, or the hostname explicitly selected by
 * the operator. IP literals preserve LAN access but cannot be DNS-rebound
 * because the browser keeps the literal address in the Host header.
 */
export function isApiRequestHostAllowed(
  request: Request,
  configured = configuredHostnames(),
): boolean {
  const hostname = requestHostname(request);
  if (!hostname) return false;
  if (isLoopbackHostname(hostname) || isIP(hostname)) return true;

  return configured.some(
    (value) => normalizeConfiguredHostname(value) === hostname,
  );
}

function defaultPortForProtocol(protocol: string): string {
  return protocol === "https:" ? "443" : "80";
}

function isConfiguredHostname(hostname: string, configured: string[]): boolean {
  return configured.some((value) => normalizeConfiguredHostname(value) === hostname);
}

function originHostMatchesRequestHost(
  origin: string,
  host: string,
  configured: string[],
): boolean {
  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return false;
  }

  const originHostname = normalizeHostname(originUrl.hostname);
  const requestHostname = hostnameFromAuthority(host);
  if (!originHostname || !requestHostname || originHostname !== requestHostname) {
    return false;
  }

  // Operator-configured public names: reverse proxies often disagree on port
  // (Lucky :8096 vs browser https default, or Host with :443). Hostname match
  // is enough; Host was already allow-listed.
  if (isConfiguredHostname(requestHostname, configured)) return true;

  const originPort = originUrl.port || defaultPortForProtocol(originUrl.protocol);
  let hostPort: string;
  try {
    hostPort = new URL(`http://${host}`).port;
  } catch {
    return false;
  }
  // Omitted Host port matches an Origin that uses a scheme default (80/443).
  // Explicit Host :443 still matches https://example.com (no port in Origin).
  if (!hostPort) return originPort === "80" || originPort === "443";
  return hostPort === originPort;
}

/** Reject browser cross-site API requests while preserving non-browser clients. */
export function isApiRequestOriginAllowed(
  request: Request,
  configured = configuredHostnames(),
): boolean {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") return false;
  if (!origin) return true;

  const host = request.headers.get("host");
  if (!host) return false;
  return originHostMatchesRequestHost(origin, host, configured);
}

export function shouldCheckApiRequestOrigin(request: Request): boolean {
  return request.headers.has("origin") || request.headers.has("sec-fetch-site");
}

export function isApiRequestAllowed(
  request: Request,
  configured = configuredHostnames(),
): boolean {
  if (!isApiRequestHostAllowed(request, configured)) return false;
  if (isUserInitiatedSessionExportNavigation(request)) return true;
  return !shouldCheckApiRequestOrigin(request) || isApiRequestOriginAllowed(request, configured);
}

export function hasJsonContentType(request: Request): boolean {
  const mediaType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  return mediaType === "application/json"
    || Boolean(mediaType?.startsWith("application/") && mediaType.endsWith("+json"));
}
