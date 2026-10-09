/**
 * Where a streaming reply's tokens-per-second measurement starts: when its first
 * tokens showed, and how many there were. Kept per reply outside the message
 * view, because switching sessions remounts the chat, and a measurement started
 * over would divide every token streamed so far by the time since the remount.
 */
export interface StreamRateStart {
  at: number;
  tokens: number;
}

// A reply that finishes while its chat is not shown is never looked up again;
// only the newest few are kept.
const MAX_TRACKED_REPLIES = 32;
const starts = new Map<string, StreamRateStart>();

/** A streaming reply's identity: pi stamps its message when the request starts. */
export function streamRateKey(message: { provider?: string; model?: string; timestamp?: number }): string | null {
  if (typeof message.timestamp !== "number") return null;
  return `${message.provider ?? ""}/${message.model ?? ""}@${message.timestamp}`;
}

export function streamRateStart(key: string | null, tokens: number, now: number): StreamRateStart {
  const known = key === null ? undefined : starts.get(key);
  if (known) return known;
  // Joining a reply already under way with no record (a page reload): the
  // tokens already there took an unknown time, so only later ones count.
  const start = { at: now, tokens };
  if (key !== null) {
    starts.set(key, start);
    if (starts.size > MAX_TRACKED_REPLIES) starts.delete(starts.keys().next().value!);
  }
  return start;
}

export function streamTokensPerSecond(start: StreamRateStart, tokens: number, now: number): number | null {
  const elapsedSeconds = (now - start.at) / 1000;
  return elapsedSeconds > 0.5 ? (tokens - start.tokens) / elapsedSeconds : null;
}
