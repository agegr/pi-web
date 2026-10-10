/**
 * Links that open one session of this Pi Web, and the click rule that keeps
 * an ordinary click inside the page.
 *
 * `?session=<id>` alone, resolved against the page the link sits on: the
 * origin and path stay (a sub-path deployment keeps its prefix), and every
 * other query parameter and the hash go. A stale `?cwd=` must go: it wins
 * over `session` in getInitialNavigation() and would open a fresh composer
 * instead. The explicit `session` also wins over a tab's remembered session
 * (withTabOpen()), so a new tab opens the linked session whatever it inherits.
 */

/** A same-instance link to one session; the id is encoded, never a URL of its own. */
export function sessionDeepLink(sessionId: string): string {
  return `?session=${encodeURIComponent(sessionId)}`;
}

export interface ActivationEvent {
  button: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
}

/**
 * A primary-button click (or Enter on a focused link) without modifiers:
 * the page handles it in place. Anything else (Ctrl/Cmd, Shift, Alt, another
 * button) is the browser's: a new tab, a new window, a download, as the user
 * and the browser decide.
 */
export function isPlainActivation(event: ActivationEvent): boolean {
  return !event.defaultPrevented
    && event.button === 0
    && !event.ctrlKey
    && !event.metaKey
    && !event.shiftKey
    && !event.altKey;
}
