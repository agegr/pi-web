// The sidebar's unread markers (#1559). Each browser sets its own: a session
// that finishes while this browser shows another one gets a dot here, as
// before. What is shared is a read: when someone actually looking at a page
// (`lib/user-attention.ts`) has seen a session, the server stamps `readAt` for
// it in the ui state, and every browser drops the markers it set before then.
// A tab merely left open on a session records nothing, so it never clears the
// dots other devices keep for it (the objection to sharing the set in #1263).
//
// Both times are the server's clock: a marker is dated by the running poll
// that last saw its session running (`serverNow`), never by this machine's
// clock, which may be off from another browser's by more than a run takes.
// Client-safe.

export const UNREAD_SESSIONS_STORAGE_KEY = "pi-web:unread-session-ids";

/** Session id → when the marker was set, in server epoch ms. */
export type UnreadMarks = ReadonlyMap<string, number>;

function isTime(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * Markers as localStorage holds them: `{ id: markedAt }`. The id list older
 * builds wrote reads with markedAt 0, so any read clears it. A malformed value
 * (an interrupted write, another client) means no markers.
 */
export function parseUnreadMarks(raw: string | null): Map<string, number> {
  const marks = new Map<string, number>();
  if (!raw) return marks;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return marks;
  }
  if (Array.isArray(parsed)) {
    for (const id of parsed) if (typeof id === "string") marks.set(id, 0);
  } else if (typeof parsed === "object" && parsed !== null) {
    for (const [id, at] of Object.entries(parsed)) if (isTime(at)) marks.set(id, at);
  }
  return marks;
}

/** Null when there is nothing to keep: the key is removed. */
export function serializeUnreadMarks(marks: UnreadMarks): string | null {
  if (marks.size === 0) return null;
  return JSON.stringify(Object.fromEntries(marks));
}

/** `previous` itself while `next` holds the same markers: an adoption must not re-render, or write back. */
export function sameMarksOr(previous: Map<string, number>, next: Map<string, number>): Map<string, number> {
  if (previous.size !== next.size) return next;
  for (const [id, at] of next) if (previous.get(id) !== at) return next;
  return previous;
}

/** Whether a read covers the marker: someone saw the session at or after the marker was set. */
export function isMarkRead(markedAt: number, readAt: number | undefined): boolean {
  return readAt !== undefined && readAt >= markedAt;
}

/** The markers no read covers; `marks` itself when every one stays. */
export function withoutReadMarks<T extends UnreadMarks>(marks: T, readAt: Readonly<Record<string, number>> | undefined): T | Map<string, number> {
  if (!readAt || marks.size === 0) return marks;
  let next: Map<string, number> | null = null;
  for (const [id, at] of marks) {
    if (!isMarkRead(at, Object.prototype.hasOwnProperty.call(readAt, id) ? readAt[id] : undefined)) continue;
    next ??= new Map(marks);
    next.delete(id);
  }
  return next ?? marks;
}

/** The ids the rows show as unread. */
export function unreadIdsOf(marks: UnreadMarks, readAt: Readonly<Record<string, number>> | undefined): Set<string> {
  return new Set(withoutReadMarks(marks, readAt).keys());
}

/**
 * The time for a marker the user sets by hand (Mark as unread, a fork's copy):
 * now on the server's clock, but after the session's last read, which the
 * estimate of the server's clock may not be. A later read still clears it.
 */
export function manualMarkTime(serverNow: number, readAt: number | undefined): number {
  return readAt === undefined ? serverNow : Math.max(serverNow, readAt + 1);
}

/**
 * Whether opening or returning to a session should record a read: this
 * browser marked it, a run of it finished here while nobody was looking
 * (`pending`), it was never read, or it changed since its last read. A
 * session that has not changed since is not written again.
 */
export function needsRead(input: {
  readAt: number | undefined;
  modifiedMs: number | undefined;
  marked: boolean;
  pending: boolean;
}): boolean {
  if (input.marked || input.pending || input.readAt === undefined) return true;
  return input.modifiedMs !== undefined && input.modifiedMs > input.readAt;
}

/** This page's estimate of the server's clock, from the running poll's `serverNow`. */
export interface ServerClock {
  /** One poll's answer: the server's time, and this page's before the request and after the answer. */
  note(serverNow: number, sentAt: number, receivedAt: number): void;
  /** `clientMs` (default: now) on the server's clock. Before any poll, the two clocks are taken as one. */
  toServer(clientMs?: number): number;
}

export function createServerClock(clientNow: () => number = Date.now): ServerClock {
  let offset = 0;
  return {
    note(serverNow, sentAt, receivedAt) {
      if (!isTime(serverNow) || !Number.isFinite(sentAt) || !Number.isFinite(receivedAt)) return;
      offset = serverNow - (sentAt + receivedAt) / 2;
    },
    toServer(clientMs = clientNow()) {
      return clientMs + offset;
    },
  };
}
