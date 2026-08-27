/**
 * Desktop-shell detection for the sidebar. Shells may stamp the render URL
 * with `dsh-desktop-mode` / `dsh-desktop-platform` (the official Electron
 * shell does) and expose `window.__DSH_DESKTOP_FILE_PATH__` through a
 * preload. Parsed once per page and memoized (the URL never changes
 * mid-session); `resetDesktopEnvForTests` clears the memo for unit tests.
 *
 * GEOMETRY POLICY: this module only REPORTS shell facts — it never decides
 * how to adapt. The strip height comes from standard signals first (the
 * Window Controls Overlay API, see wco.ts), then the documented contract
 * parameter `dsh-desktop-titlebar-inset` (a shell may stamp the real pixels
 * it reserves at the top), then the user's chosen scheme (preset / custom).
 * The legacy win32-advanced 32px constant is gone from the core: it lives
 * in the opt-in shell preset (shell-presets.ts) as a fallback for shells
 * without the WCO API.
 */
export interface DesktopEnv {
  /** Running inside a desktop shell (any URL stamp or preload marker). */
  readonly desktop: boolean
  /** `advanced` = frameless/custom-titlebar shell; `compatibility` = native frame. */
  readonly mode: 'compatibility' | 'advanced' | null
  /** Shell platform stamp ('darwin' | 'win32' | …), lowercased, or null. */
  readonly platform: string | null
  /**
   * Contract parameter `dsh-desktop-titlebar-inset`: pixels the shell
   * reserves at the top of the web content for its own chrome (0–120,
   * clamped; 0 when absent). Standard WCO geometry takes precedence over
   * this whenever the API is available.
   */
  readonly titlebarInset: number
}

let cached: DesktopEnv | undefined

/** Read the shell's desktop stamps (memoized per page; SSR-safe). */
export function parseDesktopEnv(): DesktopEnv {
  if (cached !== undefined) return cached
  const hasWindow = typeof window !== 'undefined'
  const hasPreloadMarker = hasWindow
    && typeof (window as { __DSH_DESKTOP_FILE_PATH__?: unknown }).__DSH_DESKTOP_FILE_PATH__ !== 'undefined'
  // location.search includes the leading '?', which URLSearchParams does NOT
  // strip (it would become part of the first key) — drop it explicitly.
  // SSR (no window) resolves the empty environment: nothing desktop.
  const params = hasWindow
    ? new URLSearchParams(window.location.search.replace(/^\?/, ''))
    : new URLSearchParams()
  const modeParam = params.get('dsh-desktop-mode')
  const mode = modeParam === 'compatibility' || modeParam === 'advanced' ? modeParam : null
  const platformParam = params.get('dsh-desktop-platform')
  const platform = platformParam !== null && platformParam !== '' ? platformParam.toLowerCase() : null
  const desktop = mode !== null || hasPreloadMarker
  cached = {
    desktop,
    mode,
    platform,
    titlebarInset: parseTitlebarInset(params.get('dsh-desktop-titlebar-inset')),
  }
  return cached
}

/** Clamp the contract inset parameter into 0–120 (invalid/absent → 0). */
function parseTitlebarInset(raw: string | null): number {
  if (raw === null) return 0
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return 0
  return Math.min(120, Math.max(0, Math.round(parsed)))
}

/** Test hook: drop the memo so the next parse re-reads the URL/globals. */
export function resetDesktopEnvForTests(): void {
  cached = undefined
}
