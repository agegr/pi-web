// Reads for the messages an extension posts while no run goes (a timer, a file
// watcher: `sendMessage({ display: true })`). pi writes each one before its
// `message_end`, so a read started after that event finds it; useAgentSession
// appends what the read found after its loaded window (`entriesAfter()`).

export interface IdleMessageReadOptions {
  /** Reads of the session already under way: one may hold an answer from before the message. */
  pendingReads: (sid: string) => Array<Promise<unknown> | undefined>;
  read: (sid: string) => Promise<unknown>;
  /** False once the read is no longer wanted: another session is shown, or a run started. */
  wanted: (sid: string) => boolean;
  onError?: (error: unknown) => void;
}

/**
 * One read at a time. A message arriving while a read is under way asks for one
 * more after it (that read may have been answered before the message was
 * written); every message arriving meanwhile shares that one. Each read first
 * waits out the session's other reads under way, which can land after it.
 */
export function createIdleMessageReads(options: IdleMessageReadOptions): (sid: string) => void {
  let running = false;
  let next: string | null = null;
  return (sid) => {
    next = sid;
    if (running) return;
    running = true;
    void (async () => {
      try {
        while (next !== null) {
          const current = next;
          next = null;
          if (!options.wanted(current)) continue;
          try {
            await Promise.allSettled(options.pendingReads(current));
            if (options.wanted(current)) await options.read(current);
          } catch (error) {
            options.onError?.(error);
          }
        }
      } finally {
        running = false;
      }
    })();
  };
}

/**
 * The messages a tail read of the branch found after `anchor`, the loaded
 * window's last entry, or null when the read does not reach back to it (more
 * entries came than it holds, or the branch moved): only a full read can say
 * what the window should show then.
 */
export function entriesAfter<T>(
  anchor: string,
  tail: { messages: readonly T[]; entryIds: readonly string[] },
): { messages: T[]; entryIds: string[] } | null {
  const index = tail.entryIds.lastIndexOf(anchor);
  if (index < 0) return null;
  return { messages: tail.messages.slice(index + 1), entryIds: tail.entryIds.slice(index + 1) };
}
