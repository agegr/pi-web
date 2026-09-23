/**
 * In-page stand-in for EventSource. Every stream the UI opens goes to a
 * Pi Web /api route, so the demo replaces the global constructor and lets the
 * mock handlers push events into the returned object.
 */

type Listener = (event: Event) => void;

export type StreamHandler = (source: MockEventSource) => (() => void) | void;

let resolveStream: (url: URL) => StreamHandler | null = () => null;

export function setStreamResolver(resolver: typeof resolveStream): void {
  resolveStream = resolver;
}

export class MockEventSource implements EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSED = 2;

  readonly url: string;
  readonly withCredentials = false;
  readyState = 0;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  private readonly listeners = new Map<string, Set<Listener>>();
  private cleanup: (() => void) | null = null;

  constructor(url: string | URL) {
    const resolved = new URL(String(url), window.location.href);
    this.url = resolved.href;
    // Connect asynchronously, like the real EventSource, so callers can attach
    // handlers after construction.
    setTimeout(() => {
      if (this.readyState === 2) return;
      const handler = resolveStream(resolved);
      if (!handler) {
        this.fail();
        return;
      }
      this.readyState = 1;
      this.dispatch("open", new Event("open"));
      const cleanup = handler(this);
      if (cleanup) {
        if (this.readyState === 2) cleanup();
        else this.cleanup = cleanup;
      }
    }, 15);
  }

  /** Push one SSE message. `event` names a custom event type like `change`. */
  send(data: unknown, event = "message"): void {
    if (this.readyState !== 1) return;
    const payload = typeof data === "string" ? data : JSON.stringify(data);
    this.dispatch(event, new MessageEvent(event, { data: payload }));
  }

  /** Simulate a dropped connection. */
  fail(): void {
    if (this.readyState === 2) return;
    this.readyState = 2;
    this.runCleanup();
    this.dispatch("error", new Event("error"));
  }

  close(): void {
    if (this.readyState === 2) return;
    this.readyState = 2;
    this.runCleanup();
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
    if (!listener) return;
    const fn: Listener = typeof listener === "function" ? listener : (event) => listener.handleEvent(event);
    (fn as { original?: unknown }).original = listener;
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, set = new Set());
    set.add(fn);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
    const set = this.listeners.get(type);
    if (!set || !listener) return;
    for (const fn of set) {
      if ((fn as { original?: unknown }).original === listener) set.delete(fn);
    }
  }

  dispatchEvent(event: Event): boolean {
    this.dispatch(event.type, event);
    return true;
  }

  private runCleanup(): void {
    const cleanup = this.cleanup;
    this.cleanup = null;
    cleanup?.();
  }

  private dispatch(type: string, event: Event): void {
    if (type === "open") this.onopen?.(event);
    if (type === "message") this.onmessage?.(event as MessageEvent<string>);
    if (type === "error") this.onerror?.(event);
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
  }
}
