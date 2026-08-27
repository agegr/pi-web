/**
 * Pure helpers for the `browser.probe` route (sidebar browser): the host
 * fetches the response HEADERS of a URL the user is browsing and the client
 * decides whether the target site forbids being embedded (X-Frame-Options /
 * CSP frame-ancestors are exactly the signals the browser enforces when it
 * refuses an iframe load). Kept dependency-free so the parser is
 * unit-testable.
 */

/**
 * Extract the `frame-ancestors` source list of a Content-Security-Policy
 * header, or undefined when the directive is absent (or empty). The
 * directive is the only one with a source list; sources are space-separated
 * tokens (`'none'`, `'self'`, `*`, or origins).
 */
export function extractFrameAncestors(csp: string | null): string[] | undefined {
  if (csp === null) return undefined
  for (const directive of csp.split(';')) {
    const parts = directive.trim().split(/\s+/)
    if (parts[0] === 'frame-ancestors') {
      const sources = parts.slice(1).filter(source => source !== '')
      return sources.length === 0 ? undefined : sources
    }
  }
  return undefined
}
