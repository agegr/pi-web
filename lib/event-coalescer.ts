import type { AgentEvent } from "./rpc-manager";

/**
 * Coalesces consecutive `message_update` events for the SSE stream.
 *
 * Every `message_update` carries the FULL accumulated message, and the agent
 * emits one roughly every streamed chunk. Forwarding each to the browser makes
 * transfer grow O(n^2) with the message size — ~150x amplification over the
 * actual content on remote/metered connections (issue #375).
 *
 * Only the latest pending `message_update` is kept; the owner flushes it on a
 * short timer (so streaming stays smooth) via {@link flush}. Any other event
 * flushes the pending update first, so a `message_update` is never reordered
 * past a later tool/turn/`agent_end` event and the message's final content is
 * always delivered before the next boundary event.
 */
export interface MessageUpdateCoalescer {
  /** Emit `event`, buffering it when it is a coalescible `message_update`. */
  push(event: AgentEvent): void;
  /** Emit the buffered `message_update`, if any. */
  flush(): void;
  /** Whether a `message_update` is currently buffered. */
  hasPending(): boolean;
}

export function createMessageUpdateCoalescer(
  emit: (event: AgentEvent) => void,
): MessageUpdateCoalescer {
  let pending: AgentEvent | null = null;

  const flush = () => {
    if (!pending) return;
    const event = pending;
    pending = null;
    emit(event);
  };

  return {
    push(event) {
      if (event.type === "message_update") {
        // Supersede any earlier pending update — it already carries the full
        // accumulated message, so only the newest one matters.
        pending = event;
        return;
      }
      // Preserve ordering: the in-progress message must reach the client before
      // whatever event follows it.
      flush();
      emit(event);
    },
    flush,
    hasPending() {
      return pending !== null;
    },
  };
}
