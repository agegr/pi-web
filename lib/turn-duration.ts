import type { AgentMessage } from "./types";

function recordedMs(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** When a response ended: its request start plus the time pi recorded for it (pi 1.1). */
function responseEnd(message: AgentMessage): number | undefined {
  if (message.role !== "assistant") return undefined;
  const start = recordedMs(message.timestamp);
  const duration = recordedMs(message.durationMs);
  return start !== undefined && duration !== undefined ? start + duration : undefined;
}

/** A reply that answered the turn: a run that follows it was started later, e.g. by an extension's message. */
function answersTurn(message: AgentMessage): boolean {
  return message.role === "assistant" && (message.stopReason === "stop" || message.stopReason === "length");
}

/**
 * How long a finished turn took: from its anchor (the user's message, a compaction summary,
 * a subagent completion, an extension's message that opened a run) until the last response or
 * tool result in `messages[anchorIdx + 1, endIdx)` ended, less the waits between an answer and a
 * run an extension started after it inside the turn (its message is no anchor, e.g. the one that
 * continues a reply cut at the output limit). The custom messages right after the anchor opened
 * the run with it, so the last of them is the start: a shown message anchors the turn
 * (`getTurnAnchors()`), and the hidden one that triggered the run may have come much later.
 * Undefined when the anchor has no time, or when the turn's last response predates `durationMs`:
 * its timestamp is when it started, so the turn's end is unknown.
 */
export function getTurnDurationMs(messages: AgentMessage[], anchorIdx: number, endIdx: number): number | undefined {
  let start = recordedMs(messages[anchorIdx]?.timestamp);
  if (start === undefined) return undefined;
  for (let idx = anchorIdx + 1; idx < endIdx && messages[idx].role === "custom"; idx++) {
    const at = recordedMs(messages[idx].timestamp);
    if (at !== undefined) start = Math.max(start, at);
  }
  let end: number | undefined;
  let lastResponseTimed = false;
  let idle = 0;
  let answeredAt: number | undefined;
  let nextRunAt: number | undefined;
  for (let idx = anchorIdx + 1; idx < endIdx; idx++) {
    const message = messages[idx];
    if (message.role === "assistant") {
      if (answeredAt !== undefined && nextRunAt !== undefined) idle += Math.max(0, nextRunAt - answeredAt);
      answeredAt = nextRunAt = undefined;
      const ended = responseEnd(message);
      lastResponseTimed = ended !== undefined;
      if (ended !== undefined) end = Math.max(end ?? ended, ended);
      if (ended !== undefined && answersTurn(message)) answeredAt = end;
    } else if (message.role === "toolResult") {
      const ended = recordedMs(message.timestamp);
      if (ended !== undefined) end = Math.max(end ?? ended, ended);
    } else if (answeredAt !== undefined) {
      const at = recordedMs(message.timestamp);
      if (at !== undefined) nextRunAt = Math.max(nextRunAt ?? at, at);
    }
  }
  if (!lastResponseTimed || end === undefined) return undefined;
  return Math.max(0, end - start - idle);
}

/** A turn's length as the chat shows it, in whole seconds: 14s, then 3m 5s, then 1h 2m 5s. */
export function formatTurnDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m ${seconds}s`;
}
