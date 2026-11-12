// Whether someone is actually looking at this page (#1559): the page is
// visible, its window has focus, and it took a key press, a click, a tap or a
// wheel turn within ATTENTION_WINDOW_MS. Pointer moves do not count: a page a
// mouse merely drifts across has not been read. Only such a page records a
// session as read on the server (`readAt`), so a tab left open on a session
// never clears the unread markers other browsers set for it.
//
// Page memory only, one tracker per tab: a reload starts unattended until the
// first input, so a tab the browser restores on startup reads nothing.
// Client-safe; the listeners go on only while something subscribes.

export const ATTENTION_WINDOW_MS = 2 * 60_000;

/** The DOM events that count as someone at the page. No pointermove. */
export const ATTENTION_INPUT_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart"] as const;

export interface AttentionTracker {
  /** A key press, click, tap or wheel turn. */
  noteInput(): void;
  /** Focus, blur or a visibility change. */
  notePageChange(): void;
  isAttended(): boolean;
  /** Called each time the page turns attended: the first input, a return after the window lapsed, focus back with a recent input. */
  onAttended(listener: () => void): () => void;
}

/** The pure tracker; `pageActive` says whether the page is visible and focused, `now` is a monotonic clock. */
export function createAttentionTracker(
  pageActive: () => boolean,
  now: () => number,
  windowMs = ATTENTION_WINDOW_MS,
): AttentionTracker {
  let lastInputAt: number | null = null;
  // As of the last event; it lapses silently when the window passes, so each event checks the time again.
  let attended = false;
  const listeners = new Set<() => void>();

  const recent = (at: number) => lastInputAt !== null && at - lastInputAt < windowMs;

  const update = (at: number) => {
    const next = pageActive() && recent(at);
    const turned = next && !attended;
    attended = next;
    if (!turned) return;
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch (error) {
        console.error(error);
      }
    }
  };

  return {
    noteInput() {
      const at = now();
      if (!recent(at)) attended = false;
      lastInputAt = at;
      update(at);
    },
    notePageChange() {
      const at = now();
      if (!recent(at)) attended = false;
      update(at);
    },
    isAttended() {
      return pageActive() && recent(now());
    },
    onAttended(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

let pageTracker: AttentionTracker | null = null;
let subscribers = 0;
let detach: (() => void) | null = null;

function documentActive(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "visible" && document.hasFocus();
}

function tracker(): AttentionTracker {
  pageTracker ??= createAttentionTracker(documentActive, () => performance.now());
  return pageTracker;
}

function attach(): () => void {
  const current = tracker();
  const onInput = () => current.noteInput();
  const onPageChange = () => current.notePageChange();
  const options: AddEventListenerOptions = { capture: true, passive: true };
  for (const type of ATTENTION_INPUT_EVENTS) window.addEventListener(type, onInput, options);
  window.addEventListener("focus", onPageChange);
  window.addEventListener("blur", onPageChange);
  document.addEventListener("visibilitychange", onPageChange);
  return () => {
    for (const type of ATTENTION_INPUT_EVENTS) window.removeEventListener(type, onInput, options);
    window.removeEventListener("focus", onPageChange);
    window.removeEventListener("blur", onPageChange);
    document.removeEventListener("visibilitychange", onPageChange);
  };
}

/** Whether someone is looking at this page now. False on the server and before any input. */
export function isPageAttended(): boolean {
  if (typeof window === "undefined" || subscribers === 0) return false;
  return tracker().isAttended();
}

/**
 * Listens for input while subscribed and calls `listener` each time the page
 * turns attended. Returns the unsubscribe. `isPageAttended()` is false while
 * nothing subscribes: no input was watched.
 */
export function subscribePageAttention(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const off = tracker().onAttended(listener);
  if (subscribers++ === 0) detach = attach();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    off();
    if (--subscribers === 0) {
      detach?.();
      detach = null;
    }
  };
}
