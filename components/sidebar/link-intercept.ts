/**
 * Chat/GUI external-link interception: clicking an http(s) link that points
 * OUTSIDE the GUI (chat messages, tool rows, prose mentions) opens the
 * sidebar instead of a new browser tab. Gated by the caller through
 * `takeoverEnabled(url)` — the `browserInterceptLinks` master, the URL's
 * protocol flag (`browserInterceptHttp` / `browserInterceptHttps`) and the
 * target tab's enable switch — and a Ctrl/Cmd/Shift/Alt-modified click
 * always bypasses the takeover so the user can still force a real browser
 * tab.
 *
 * Only the GUI's OWN document is watched — links inside the browser tab's
 * sandboxed iframe live in another document and never bubble here (and
 * their clicks must keep working inside the sidebar).
 */

/** The pure decision: the URL to open in the sidebar, or null to let the
 *  click fall through. Extracted so the policy is unit-testable without a
 *  DOM. `anchorHref` must be the ABSOLUTE href (`<a>.href` already is).
 *  The protocol/same-origin policy lives HERE; the prefs gates (master +
 *  protocol flags + target enablement) live in the caller's
 *  `takeoverEnabled(url)` callback. */
export function shouldInterceptLink(anchorHref: string, selfOrigin: string): string | null {
  let url: URL
  try {
    url = new URL(anchorHref)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  // Same-origin links are GUI-internal navigation (settings pages, tool
  // docs) — never routed into the sidebar.
  try {
    if (url.origin === new URL(selfOrigin).origin) return null
  } catch {
    // Unparsable selfOrigin (never in practice): intercept defensively.
  }
  return url.href
}

/** Whether a left-click may be taken over (unmodified left click only). */
export function isPlainLeftClick(event: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
}

/**
 * Register the document-level click capture that funnels external links
 * into the sidebar. Returns the disposer (HMR-safe).
 */
export function registerLinkInterception(opts: {
  /** Whether the takeover may happen for THIS url (the caller's prefs
   *  gates: master switch, protocol flag, target enablement). */
  takeoverEnabled: (url: URL) => boolean
  /** Open the sidebar tab at `url` (the caller resolves the target type). */
  openInSidebar: (url: string) => void
  /** The GUI's own origin (window.location.origin at registration). */
  selfOrigin: string
}): () => void {
  const onClick = (event: MouseEvent): void => {
    if (!isPlainLeftClick(event)) return
    if (event.defaultPrevented) return
    const target = event.target
    if (target === null || typeof (target as Element).closest !== 'function') return
    const anchor = (target as Element).closest('a[href]') as HTMLAnchorElement | null
    if (anchor === null) return
    const url = shouldInterceptLink(anchor.href, opts.selfOrigin)
    if (url === null) return
    if (!opts.takeoverEnabled(new URL(url))) return
    event.preventDefault()
    opts.openInSidebar(url)
  }
  document.addEventListener('click', onClick, true)
  return () => { document.removeEventListener('click', onClick, true) }
}
