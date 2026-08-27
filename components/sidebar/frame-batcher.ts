/**
 * Per-frame task coalescing for pointer-driven interactions.
 *
 * Pointer streams fire several times faster than the display refresh, and
 * applying every event (a React setState, a store reduce) re-renders whole
 * trees at event cadence — the visible drag lag on slower CPUs (#315). This
 * batcher keeps the LATEST scheduled task, runs it at most once per
 * animation frame, and lets the caller flush synchronously on release (so
 * the final pointer position is never lost to a cancelled frame).
 *
 * Callers compose the pending value in a ref before scheduling; the
 * scheduled task reads that ref, so replacing the task on every event is
 * cheap (one ref write + one rAF check).
 */
export interface FrameBatcher {
  /** Schedule (or replace) the per-frame task. Safe to call on every event. */
  schedule(task: () => void): void
  /** Cancel any pending frame and run the scheduled task synchronously
   *  (no-op when nothing is scheduled). */
  flushNow(): void
  /** Cancel any pending frame and drop the task without running it. */
  dispose(): void
}

export function createFrameBatcher(): FrameBatcher {
  let frame: number | null = null
  let task: (() => void) | null = null

  const run = (): void => {
    frame = null
    const current = task
    task = null
    current?.()
  }

  return {
    schedule(next) {
      task = next
      if (frame === null) frame = requestAnimationFrame(run)
    },
    flushNow() {
      if (frame !== null) {
        cancelAnimationFrame(frame)
        frame = null
      }
      run()
    },
    dispose() {
      if (frame !== null) {
        cancelAnimationFrame(frame)
        frame = null
      }
      task = null
    },
  }
}
