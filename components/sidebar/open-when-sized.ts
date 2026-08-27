/**
 * Deferred one-shot open for hosts that may not have a real size yet.
 *
 * xterm's `Terminal.open()` must not run in a zero-size container: the
 * renderer creation fails there (the DomRenderer is built from the host's
 * dimensions), leaving the render service's renderer `undefined`, and the
 * next Viewport refresh crashes reading `.dimensions` off it. WebKit-based
 * hosts (WKWebView) reliably report zero while the bottom panel's expand
 * slide is in flight; any `display:none`-hidden ancestor does the same.
 *
 * The caller's `open` callback (open + fit + resize) is invoked exactly
 * once, on the first frame where the host reports a real size. While the
 * host stays zero-sized the polling continues every frame; it stops when
 * the host leaves the document (`isConnected`), so a pending open never
 * fires after unmount. The returned cancel function drops a pending frame
 * immediately (idempotent).
 *
 * `raf`/`caf` are injectable so tests can drive the polling deterministically.
 */
export function openWhenSized(
  host: HTMLElement,
  open: () => void,
  raf: (cb: FrameRequestCallback) => number = requestAnimationFrame,
  caf: (id: number) => void = cancelAnimationFrame,
): () => void {
  let frame: number | null = null
  const step = (): void => {
    frame = null
    if (!host.isConnected) return
    if (host.clientWidth > 0 && host.clientHeight > 0) {
      open()
      return
    }
    frame = raf(step)
  }
  frame = raf(step)
  return () => {
    if (frame !== null) {
      caf(frame)
      frame = null
    }
  }
}
