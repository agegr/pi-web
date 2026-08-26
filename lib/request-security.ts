import { isIP } from "node:net";

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

function normalizeAuthority(value: string): string | null {
  if (!value || /[\s/@\\]/.test(value)) return null;
  try {
    const parsed = new URL(`http://${value}`);
    if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
      return null;
    }
    const hostname = normalizeHostname(parsed.hostname);
    return parsed.port ? `${hostname}:${parsed.port}` : hostname;
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

function canonicalOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function getRequestOrigin(request: Request): string | null {
  const requestUrl = new URL(request.url);
  const host = request.headers.get("host");
  return host ? canonicalOrigin(`${requestUrl.protocol}//${host}`) : null;
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

/**
 * Only trust local names, IP literals, or the hostname explicitly selected by
 * the operator. IP literals preserve LAN access but cannot be DNS-rebound
 * because the browser keeps the literal address in the Host header.
 */
export function isApiRequestHostAllowed(
  request: Request,
  configuredHostnames = configuredHostnamesFromEnvironment(),
): boolean {
  const host = request.headers.get("host");
  const hostname = host ? hostnameFromAuthority(host) : null;
  if (!hostname) return false;
  if (isLoopbackHostname(hostname) || isIP(hostname)) return true;

  return configuredHostnames.some(
    (configured) => normalizeConfiguredHostname(configured) === hostname,
  );
}

/**
 * A relay can report the external scheme in `x-forwarded-proto` while rewriting
 * `Origin` onto the backend authority, so the two disagree on the scheme alone
 * for a request that really is same-origin (Azure Dev Tunnels does this). Accept
 * that pairing only when the Origin's authority still equals the Host header,
 * a proxy is in front, and Fetch Metadata still reports a same-origin request.
 */
function isProxyRewrittenSameOrigin(request: Request, origin: string): boolean {
  if (
    request.headers.get("sec-fetch-site") !== "same-origin"
    || !request.headers.get("x-forwarded-proto")
  ) return false;

  const host = request.headers.get("host");
  if (!host) return false;

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }

  const originAuthority = normalizeAuthority(originHost);
  return originAuthority !== null && originAuthority === normalizeAuthority(host);
}

/**
 * Chromium 150+ strips the port from the `Origin` header for same-origin
 * requests against non-default-port backends. Verified on Chrome 152.0.0.0:
 * a browser fetch from `http://127.0.0.1:30141` sends
 * `Origin: http://127.0.0.1` (no port) for both GET and POST in cors mode,
 * and `Referer` strips the port the same way. The previous strict
 * canonical-origin comparison therefore rejected every legitimate `/api/*`
 * call against a non-default-port pi-web server.
 *
 * Accept such requests only when the request is genuinely same-origin,
 * scheme + hostname match the request URL, and any port included in Origin
 * matches the request port — the latter blocks cross-port same-site CSRF
 * (e.g. an attacker on `myapp.com:8080` forging a request to
 * `myapp.com:30141` with `Origin: http://myapp.com:8080`). See issue #542.
 *
 * Scheme is taken from `request.url` (via `getRequestOrigin`), not the Host
 * header, so an http→https mismatch is still rejected even though the Host
 * header itself has no scheme.
 */
function isChromePortStrippedSameOrigin(request: Request, origin: string): boolean {
  if (request.headers.get("sec-fetch-site") !== "same-origin") return false;

  const requestOrigin = getRequestOrigin(request);
  if (!requestOrigin) return false;

  let originUrl: URL;
  let requestUrl: URL;
  try {
    originUrl = new URL(origin);
    requestUrl = new URL(requestOrigin);
  } catch {
    return false;
  }

  if (originUrl.protocol !== requestUrl.protocol) return false;
  if (originUrl.hostname !== requestUrl.hostname) return false;
  if (originUrl.port && originUrl.port !== requestUrl.port) return false;

  return true;
}

/**
 * Reject browser cross-site API requests while preserving non-browser clients.
 *
 * Three accept paths:
 *
 * 1. Strict canonical-origin match — covers the common same-origin case.
 * 2. Proxy rewritten Origin onto the backend authority — Azure Dev Tunnels,
 *    Daytona, and similar relays. Requires same-origin Fetch Metadata and
 *    an `x-forwarded-proto` header to prove a proxy is in front.
 * 3. Chromium 150+ stripped the port from Origin — same-origin request
 *    against a non-default-port backend. Scheme + hostname must still match
 *    Host; the port is only checked when Origin carries one.
 */
export function isApiRequestOriginAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") return false;
  if (!origin) return true;

  const requestOrigin = getRequestOrigin(request);
  if (requestOrigin !== null && canonicalOrigin(origin) === requestOrigin) return true;
  if (isProxyRewrittenSameOrigin(request, origin)) return true;
  if (isChromePortStrippedSameOrigin(request, origin)) return true;

  return false;
}

export function shouldCheckApiRequestOrigin(request: Request): boolean {
  return request.headers.has("origin") || request.headers.has("sec-fetch-site");
}

export function isApiRequestAllowed(
  request: Request,
  configuredHostnames = configuredHostnamesFromEnvironment(),
): boolean {
  if (!isApiRequestHostAllowed(request, configuredHostnames)) return false;
  if (isUserInitiatedSessionExportNavigation(request)) return true;
  return !shouldCheckApiRequestOrigin(request) || isApiRequestOriginAllowed(request);
}

export function hasJsonContentType(request: Request): boolean {
  const mediaType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  return mediaType === "application/json"
    || Boolean(mediaType?.startsWith("application/") && mediaType.endsWith("+json"));
}
