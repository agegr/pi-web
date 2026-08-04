import type { AgentMessage } from "./types";
import type { SessionTiming } from "./pi-types";

/**
 * Break a session's wall-clock time into active buckets, excluding gaps where
 * the user was idle (reading / thinking / typing before their next message).
 *
 * Each gap between consecutive messages is attributed to the bucket of the
 * message it leads INTO: a gap ending at an assistant message is time spent
 * waiting for the model (includes network RTT); a gap ending at a tool result
 * or bash execution is tool runtime; anything else is "other" (e.g. compaction).
 * Gaps ending at a user message are the user's own idle time and are dropped.
 *
 * Gaps are only counted when both messages carry a timestamp, so the result
 * degrades gracefully while a session is mid-stream.
 */
export function computeSessionTiming(messages: AgentMessage[]): SessionTiming {
  let modelWaitMs = 0;
  let toolExecMs = 0;
  let otherMs = 0;

  for (let i = 1; i < messages.length; i++) {
    const prev = messages[i - 1];
    const curr = messages[i];
    const prevTs = prev.timestamp;
    const currTs = curr.timestamp;
    if (typeof prevTs !== "number" || typeof currTs !== "number") continue;
    const gap = currTs - prevTs;
    if (gap <= 0) continue;
    switch (curr.role) {
      case "user":
        break;
      case "assistant":
        modelWaitMs += gap;
        break;
      case "toolResult":
      case "bashExecution":
        toolExecMs += gap;
        break;
      default:
        otherMs += gap;
    }
  }

  return {
    modelWaitMs,
    toolExecMs,
    totalActiveMs: modelWaitMs + toolExecMs + otherMs,
    otherMs,
  };
}
