import type {
  DebugPageVisibility,
  DebugRunningPoll,
  DebugTrackedEventSource,
  DebugTrackedEventSourceKind,
} from "./debug-types";

/**
 * What this page knows about its own connections, for the debug panel: the EventSources it holds,
 * its visibility history and the HTTP protocol it reached the server with. Tracking only listens:
 * it never opens, closes or reconnects a source, and a closed source simply drops out of the list.
 * Sources are held weakly: one the page closed and dropped is never kept alive here, along with
 * whatever its handlers close over (a terminal's scrollback, a viewer's last file).
 */

interface EventSourceLike {
  readonly readyState: number;
  addEventListener?(type: "open" | "error", listener: () => void): void;
}

interface TrackedSource {
  id: number;
  kind: DebugTrackedEventSourceKind;
  label: string | null;
  source: WeakRef<EventSourceLike>;
  createdAt: number;
  opens: number;
  errors: number;
  lastOpenAt: number | null;
  lastErrorAt: number | null;
}

const EVENT_SOURCE_CLOSED = 2;

const tracked = new Set<TrackedSource>();
let nextTrackedId = 1;

/** The entry's source while it is open or reconnecting; undefined once it closed or was collected. */
function liveSource(entry: TrackedSource): EventSourceLike | undefined {
  const source = entry.source.deref();
  return source && source.readyState !== EVENT_SOURCE_CLOSED ? source : undefined;
}

function pruneClosed(): void {
  for (const entry of tracked) {
    if (!liveSource(entry)) tracked.delete(entry);
  }
}

/**
 * Registers an EventSource the page just created and returns it unchanged, so a call site reads
 * `const es = trackEventSource("terminal", new EventSource(url))`. `open` and `error` are counted
 * through extra listeners; the source's own `onopen` / `onerror` / `onmessage` are untouched.
 */
export function trackEventSource<T extends EventSourceLike>(kind: DebugTrackedEventSourceKind, source: T, label: string | null = null): T {
  pruneClosed();
  const entry: TrackedSource = {
    id: nextTrackedId++,
    kind,
    label,
    source: new WeakRef(source),
    createdAt: Date.now(),
    opens: 0,
    errors: 0,
    lastOpenAt: null,
    lastErrorAt: null,
  };
  tracked.add(entry);
  if (typeof source.addEventListener === "function") {
    // The listeners close over the entry only: the source reaches the entry, never the reverse.
    source.addEventListener("open", () => {
      entry.opens += 1;
      entry.lastOpenAt = Date.now();
    });
    source.addEventListener("error", () => {
      entry.errors += 1;
      entry.lastErrorAt = Date.now();
    });
  }
  return source;
}

/** The page's sources that are open or reconnecting, oldest first. */
export function listTrackedEventSources(): DebugTrackedEventSource[] {
  const list: DebugTrackedEventSource[] = [];
  for (const entry of tracked) {
    const source = liveSource(entry);
    if (!source) {
      tracked.delete(entry);
      continue;
    }
    list.push({
      id: entry.id,
      kind: entry.kind,
      label: entry.label,
      state: source.readyState === 1 ? "open" : "connecting",
      createdAt: entry.createdAt,
      opens: entry.opens,
      errors: entry.errors,
      lastOpenAt: entry.lastOpenAt,
      lastErrorAt: entry.lastErrorAt,
    });
  }
  return list;
}

const visibility = {
  trackingSince: null as number | null,
  lastHiddenAt: null as number | null,
  lastVisibleAt: null as number | null,
  hiddenCount: 0,
};

function recordVisibility(): void {
  if (typeof document === "undefined") return;
  if (document.visibilityState === "hidden") {
    visibility.lastHiddenAt = Date.now();
    visibility.hiddenCount += 1;
  } else {
    visibility.lastVisibleAt = Date.now();
  }
}

/** Starts recording visibility changes, once per page; a passive listener, safe to call often. */
export function startPageVisibilityTracking(): void {
  if (visibility.trackingSince !== null || typeof document === "undefined") return;
  visibility.trackingSince = Date.now();
  document.addEventListener("visibilitychange", recordVisibility);
}

export function readPageVisibility(): DebugPageVisibility {
  const hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
  return {
    state: hidden ? "hidden" : "visible",
    trackingSince: visibility.trackingSince,
    lastHiddenAt: visibility.lastHiddenAt,
    lastVisibleAt: visibility.lastVisibleAt,
    hiddenCount: visibility.hiddenCount,
  };
}

const runningPoll: DebugRunningPoll = { count: 0, failures: 0, last: null };

/**
 * Records one finished `GET /api/agent/running` poll of the sidebar. Called from that poll's
 * `finally`; it only assigns, so it cannot change how the poll goes on. `endedAt` is when its
 * answer was read: the session-list reload a poll may start after that is not its round trip.
 * Without one (no answer, or none read) the poll is measured up to now.
 */
export function noteRunningPoll(
  startedAt: number,
  outcome: "ok" | "error" | "aborted",
  httpStatus: number | null,
  endedAt: number | null = null,
): void {
  const at = Date.now();
  runningPoll.count += 1;
  if (outcome === "error") runningPoll.failures += 1;
  runningPoll.last = { at, durationMs: Math.max(0, (endedAt ?? at) - startedAt), outcome, httpStatus };
}

export function readRunningPoll(): DebugRunningPoll {
  return { ...runningPoll, last: runningPoll.last ? { ...runningPoll.last } : null };
}

/**
 * The protocol the page itself loaded over ("http/1.1", "h2", "h3"), or null when the browser does
 * not say. pi-web serves plain HTTP/1.1, where a browser keeps six connections per origin for all
 * its tabs (#1283); h2 means a TLS proxy in front. Open streams never reach Resource Timing, so
 * only the navigation entry is read, and its buffer is never touched.
 */
export function readHttpProtocol(): string | null {
  if (typeof performance === "undefined" || typeof performance.getEntriesByType !== "function") return null;
  const entry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  const protocol = entry?.nextHopProtocol;
  if (protocol) return protocol;
  if (typeof location !== "undefined" && location.protocol === "http:") return "http/1.1";
  return null;
}
