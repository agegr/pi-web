import type { AgentMessage, AssistantMessage, ToolResultMessage } from "./types";

/**
 * Sum the tool-execution wall-clock time inside one turn.
 *
 * Walks the turn's messages in chronological order and accumulates the gaps
 * between adjacent timestamps while tools are running. A "previous end"
 * cursor tracks when the model last finished generating:
 *   - assistant end  = `endedAt ?? timestamp` (generation finished)
 *   - toolResult ts  = tool execution finished
 *
 * This single pass is correct for both execution shapes:
 *   - serial:  each toolResult − previous assistant end
 *   - parallel: adjacent toolResult gaps sum to last toolResult − assistant end
 *
 * @param turnMessages messages of one turn in chronological order, excluding
 *   the leading user message.
 * @param turnStartTimestamp the leading user message's timestamp, used as the
 *   initial cursor.
 */
export function computeTurnToolDurationMs(
  turnMessages: readonly AgentMessage[],
  turnStartTimestamp?: number,
): number {
  let prevEnd = turnStartTimestamp;
  let toolMs = 0;
  for (const m of turnMessages) {
    if (m.role === "toolResult") {
      const ts = (m as ToolResultMessage).timestamp;
      if (ts != null && prevEnd != null && ts > prevEnd) toolMs += ts - prevEnd;
      if (ts != null) prevEnd = ts;
    } else if (m.role === "assistant") {
      const end = (m as AssistantMessage).endedAt ?? (m as AssistantMessage).timestamp;
      if (end != null) prevEnd = end;
    }
  }
  return toolMs;
}
