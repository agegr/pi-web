"use client";

/**
 * A nudge telling every polled panel to re-fetch now.
 *
 * The panels poll on their own so agent-side writes eventually show up, but
 * after the dashboard assistant acts the user is watching and a 5–30 second
 * wait reads as the command having failed. The assistant fires this on
 * completion so its effects land immediately.
 */
const listeners = new Set<() => void>();

export function requestRefresh(): void {
  for (const listener of [...listeners]) listener();
}

export function onRefreshRequest(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
