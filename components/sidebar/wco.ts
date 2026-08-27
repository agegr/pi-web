/**
 * Reactive Window Controls Overlay geometry — the STANDARD web mechanism
 * for frameless Chromium shells that draw the native caption buttons
 * (minimize / maximize / close) OVER the web content (Electron
 * `titleBarOverlay` on Windows; issue #257). Feature-detected: absent in
 * plain browsers, macOS, Tauri etc., where the snapshot stays `NONE` and
 * the sidebar adapts nothing — this is the conservative "auto" signal.
 *
 * The API reports the real titlebar rect (CSS px), which differs between
 * shells and Electron versions (32 / 36 …), and fires `geometrychange`
 * when the window maximizes / restores / moves — so the strip must be
 * reactive, not memoized like the URL stamps.
 *
 * Module-level store so the Sidebar shell can subscribe via
 * `useSyncExternalStore`; `setWcoSourceForTests` swaps the source for unit
 * tests (no real API exists in jsdom/headless).
 */
export interface WcoSource {
  readonly visible: boolean
  getTitlebarAreaRect(): { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
  addEventListener(type: 'geometrychange', listener: () => void): void
  removeEventListener(type: 'geometrychange', listener: () => void): void
}

/** The current overlay geometry (present=false = API unavailable). */
export interface WcoSnapshot {
  readonly present: boolean
  readonly height: number
}

/** Snapshot when the API is unavailable (plain browser / non-overlay shell). */
export const WCO_NONE: WcoSnapshot = Object.freeze({ present: false, height: 0 })

type Listener = () => void

let source: WcoSource | undefined
let snapshot: WcoSnapshot = WCO_NONE
let attached = false
let sourceListener: (() => void) | undefined
const listeners = new Set<Listener>()

function read(): WcoSnapshot {
  if (source === undefined) return WCO_NONE
  try {
    // A present-but-NOT-visible API is a PHANTOM: headless Chromium and
    // macOS builds expose the interface but draw no overlay (empty rect,
    // visible=false). Only a genuinely visible overlay is authoritative —
    // otherwise the resolution chain would trust a zero rect and silently
    // skip the shell's real reserved space.
    if (source.visible !== true) return { present: false, height: 0 }
    const rect = source.getTitlebarAreaRect()
    const height = Math.round(rect.height)
    return Number.isFinite(height) && height > 0
      ? { present: true, height }
      : { present: true, height: 0 }
  } catch {
    // A hostile/racy API must never break the layout — treat as absent.
    return { present: false, height: 0 }
  }
}

function onGeometryChange(): void {
  snapshot = read()
  emit()
}

function emit(): void {
  for (const listener of listeners) listener()
}

/** Attach the native geometrychange listener (once). */
function attach(): void {
  if (attached) return
  attached = true
  // The test hook may have installed a source already; otherwise attach to
  // the real navigator API (absent in plain browsers → stay NONE).
  const candidate = source ?? (navigator as unknown as { windowControlsOverlay?: WcoSource }).windowControlsOverlay
  if (candidate === undefined) return
  source = candidate
  sourceListener = onGeometryChange
  snapshot = read()
  source.addEventListener('geometrychange', sourceListener)
}

/** Detach the native listener (last subscriber left or source swapped). */
function detach(): void {
  if (source !== undefined && sourceListener !== undefined) {
    source.removeEventListener('geometrychange', sourceListener)
  }
  sourceListener = undefined
  attached = false
}

/** Read the current snapshot (returns the frozen NONE when unavailable). */
export function getWcoSnapshot(): WcoSnapshot {
  return snapshot
}

/**
 * Subscribe to overlay geometry changes. Attaches to the real
 * `navigator.windowControlsOverlay` on first subscribe; the disposer
 * detaches the native listener when the last subscriber leaves.
 */
export function subscribeWco(onChange: Listener): () => void {
  listeners.add(onChange)
  attach()
  return () => {
    listeners.delete(onChange)
    if (listeners.size === 0) detach()
  }
}

/** Test hook: swap the geometry source (undefined = API unavailable). */
export function setWcoSourceForTests(next: WcoSource | undefined): void {
  detach()
  source = next
  snapshot = next === undefined ? WCO_NONE : read()
  if (next !== undefined && listeners.size > 0) attach()
  emit()
}
