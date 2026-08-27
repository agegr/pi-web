/**
 * Pure URL policy for the built-in browser tab: normalize user input into
 * an http(s) URL, and refuse destinations that would be dangerous to embed
 * in the sidebar iframe. Kept dependency-free so it is unit-testable.
 *
 * The iframe sandbox (opaque origin, no allow-same-origin / top-navigation)
 * is the primary security boundary; this module is the address-bar gate on
 * top of it: only http/https may be navigated, and loopback addresses are
 * refused so a browsed page cannot probe local services by user action.
 * The GUI's OWN origin is explicitly ALLOWED — the user may open the GUI
 * itself in the sidebar (debugging, mirroring); the sandbox still renders
 * it in an opaque origin with no same-origin privileges, exactly like any
 * other site.
 */

/** Why a navigation attempt was refused. */
export type BrowserBlockReason = 'scheme' | 'loopback'

/** Result of normalizing one address-bar input. */
export type BrowserNavigateResult =
  | { kind: 'ok'; url: string }
  | { kind: 'blocked'; reason: BrowserBlockReason }
  | { kind: 'invalid' }

/** One browser.probe wire result (host fetch of the target's headers). */
export interface BrowserProbeResult {
  reachable: boolean
  /** The final (post-redirect) URL; present when reachable. */
  url?: string
  status?: number
  xFrameOptions?: string
  /** The CSP frame-ancestors source list; present when the directive exists. */
  frameAncestors?: string[]
}

/** Embeddability verdict of one probe. */
export type Embeddability = 'embeddable' | 'blocked' | 'unknown'

/**
 * Decide whether a site can render inside the sidebar iframe. The signals
 * are exactly the ones the BROWSER enforces when it refuses an iframe load:
 * X-Frame-Options DENY/SAMEORIGIN, or a frame-ancestors directive that does
 * not allow `*` ('self' here means the SITE's own origin — never ours, so
 * it also blocks the sidebar). A site we could not reach yields 'unknown'
 * and the plain iframe stays.
 */
export function embeddabilityOf(probe: BrowserProbeResult): Embeddability {
  if (probe.reachable !== true) return 'unknown'
  const xfo = probe.xFrameOptions?.trim().toUpperCase()
  if (xfo === 'DENY' || xfo === 'SAMEORIGIN') return 'blocked'
  if (probe.frameAncestors !== undefined && !probe.frameAncestors.some(source => source === '*')) return 'blocked'
  return 'embeddable'
}

/** A loopback hostname (localhost, IPv6 ::1, 127.0.0.0/8, 0.0.0.0). */
export function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (host === 'localhost' || host === '::1' || host === '0.0.0.0') return true
  const parts = host.split('.')
  return parts.length === 4
    && parts[0] === '127'
    && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

/**
 * Normalize one address-bar input against the navigation policy.
 * @param input - raw user text.
 * @param selfOrigin - the GUI's own origin (window.location.origin). The GUI
 * itself may be browsed in the sidebar (the sandbox keeps it opaque), so it
 * is let through BEFORE the loopback check — its host is normally loopback.
 * @param allowedLoopback - comma-separated loopback allowlist from the side
 * card prefs (`browserAllowedLoopback`): bare hosts (`localhost`,
 * `127.0.0.1`) allow every port, `host:port` entries allow exactly that
 * authority. Entries are matched case-insensitively; portless entries match
 * the host on any port. Empty allowlist keeps the default loopback block.
 */
/** Schemes that must never reach the iframe, even without `//` (javascript:,
 *  data:, file:, ...). Host:port lookalikes (example.com:8080) are NOT here —
 *  they parse as hosts below. */
const FORBIDDEN_SCHEMES = new Set([
  'javascript', 'data', 'file', 'about', 'vbscript', 'blob',
  'mailto', 'tel', 'ftp', 'ftps', 'ws', 'wss', 'sftp', 'ssh',
  'chrome', 'chrome-extension', 'moz-extension', 'edge', 'opera', 'resource', 'view-source',
])

/** Parse the loopback allowlist into a matcher predicate over host:port. */
export function parseLoopbackAllowlist(allowlist: string): (host: string, port: string) => boolean {
  const entries = allowlist.split(',').map(entry => entry.trim().toLowerCase()).filter(entry => entry !== '')
  const exact = new Set(entries)
  const hosts = new Set<string>()
  for (const entry of entries) {
    if (!entry.includes(':')) hosts.add(entry.replace(/^\[|\]$/g, ''))
  }
  return (host, port) => {
    const key = `${host}:${port}`
    if (exact.has(key) || exact.has(host)) return true
    return port !== '' && hosts.has(host)
  }
}

/**
 * Whether a loopback URL is explicitly allowlisted by the side card prefs
 * (`browserAllowedLoopback`). Only allowlisted local addresses may run with
 * `allow-same-origin` in the sidebar iframe — needed for local dev servers
 * (Vite etc.) whose module/HMR/fetch pipeline requires a real origin, while
 * the page stays cross-origin to the GUI and to every other site.
 */
export function isAllowedLoopbackUrl(url: string, allowlist: string): boolean {
  if (allowlist.trim() === '') return false
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (!isLoopbackHostname(parsed.hostname)) return false
  return parseLoopbackAllowlist(allowlist)(parsed.hostname, parsed.port)
}

export function normalizeBrowserUrl(input: string, selfOrigin: string, allowedLoopback = ''): BrowserNavigateResult {
  const trimmed = input.trim()
  if (trimmed === '') return { kind: 'invalid' }
  // Distinguish an explicit scheme from a bare host:port. "example.com:8080"
  // would match a naive scheme regex (dots are legal in schemes), so a
  // scheme prefix is only honored when it is http(s) or a known-forbidden
  // scheme; anything else is treated as a host and gets https://.
  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(trimmed)
  let withScheme: string
  if (schemeMatch === null) {
    withScheme = `https://${trimmed}`
  } else {
    const scheme = schemeMatch[1]!.toLowerCase()
    if (scheme === 'http' || scheme === 'https') withScheme = trimmed
    else if (FORBIDDEN_SCHEMES.has(scheme)) return { kind: 'blocked', reason: 'scheme' }
    else withScheme = `https://${trimmed}`
  }
  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    return { kind: 'invalid' }
  }
  // The protocol backstop: any URL that still parses to a non-http(s)
  // scheme (e.g. ftp://, ws:// — which carry `//` and skip the list) is
  // refused here.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { kind: 'blocked', reason: 'scheme' }
  // The GUI's own origin is ALLOWED (the user may browse the GUI itself in
  // the sidebar; the sandbox renders it in an opaque origin like any other
  // site). It must be checked before the loopback gate because its host is
  // normally loopback.
  try {
    if (url.origin === new URL(selfOrigin).origin) return { kind: 'ok', url: url.href }
  } catch {
    // Unparsable selfOrigin (never in practice): fall through to the loopback gate.
  }
  if (isLoopbackHostname(url.hostname)) {
    // An explicit user allowlist (browserAllowedLoopback) can lift the
    // loopback block for trusted local dev servers. The sandbox still
    // renders them in an opaque origin — no GUI access, exactly like any
    // other browsed site.
    if (allowedLoopback.trim() !== '' && parseLoopbackAllowlist(allowedLoopback)(url.hostname, url.port)) {
      return { kind: 'ok', url: url.href }
    }
    return { kind: 'blocked', reason: 'loopback' }
  }
  return { kind: 'ok', url: url.href }
}
