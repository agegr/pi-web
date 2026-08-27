/**
 * IME-composition key guard.
 *
 * While a Chinese/Japanese/Korean input method is composing (the user is
 * picking a candidate from the IME window), every pressed key BELONGS to the
 * input method: arrows move the candidate highlight, Enter/Space confirm the
 * composition, Escape cancels it. Page code must not process those keys —
 * a component that does (a number stepper calling preventDefault() on
 * ArrowUp/ArrowDown, a submit handler reacting to Enter, ...) silently
 * breaks the IME: candidates stop responding, the composition gets torn
 * apart, and only bare letters come out.
 *
 * This guard enforces that rule at the document boundary: a capture-phase
 * keydown/keyup listener that stops the event from propagating further
 * whenever a composition is in progress. Because it runs in the capture
 * phase on `document` — the outermost node — it fires BEFORE React's
 * delegated handlers (attached at the root container) and before any native
 * target/bubble listener, so an inlined third-party component (e.g. the
 * Univer office UI bundled into this plugin) can never intercept
 * composition keys. The browser's native IME processing is untouched:
 * stopPropagation only silences page JS, not the default action.
 *
 * The composition signal follows the DSH core convention (InputBar's IME
 * guard, issue #535): `isComposing` for modern engines, keyCode 229 as the
 * legacy signal engines emit without isComposing.
 */

/** The pure decision: is this keyboard event part of an IME composition? */
export function isImeComposition(event: { isComposing: boolean; keyCode: number }): boolean {
  return event.isComposing || event.keyCode === 229
}

/**
 * Register the document-level capture guard. Returns the disposer
 * (HMR-safe; call through `ctx.effect`).
 */
export function registerImeGuard(): () => void {
  const onKey = (event: KeyboardEvent): void => {
    if (isImeComposition(event)) event.stopPropagation()
  }
  document.addEventListener('keydown', onKey, true)
  document.addEventListener('keyup', onKey, true)
  return () => {
    document.removeEventListener('keydown', onKey, true)
    document.removeEventListener('keyup', onKey, true)
  }
}
