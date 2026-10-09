import type { AgentMessage, ToolResultMessage } from "@/lib/types";

/** One page of `GET /api/sessions/[id]/context`, or what the viewer holds. */
export interface SubagentTranscript {
  messages: AgentMessage[];
  entryIds: string[];
  oldestEntryId: string | null;
  hasMore: boolean;
}

export const EMPTY_TRANSCRIPT: SubagentTranscript = { messages: [], entryIds: [], oldestEntryId: null, hasMore: false };

/** Same pairing the main chat builds: a tool result keyed by its tool call. */
export function buildToolResultsMap(messages: readonly AgentMessage[]): Map<string, ToolResultMessage> {
  const map = new Map<string, ToolResultMessage>();
  for (const message of messages) {
    if (message.role === "toolResult") map.set(message.toolCallId, message);
  }
  return map;
}

/**
 * Folds a fresh tail page (a poll) into what the viewer holds. Older pages the
 * user loaded stay when the tail overlaps them; otherwise (more new entries
 * than one page, another branch) the tail replaces them. Entries never change
 * once appended, so a message already shown keeps its object and MessageView's
 * memo skips it.
 */
export function mergeTailPage(current: SubagentTranscript, page: SubagentTranscript): SubagentTranscript {
  const known = new Map<string, AgentMessage>();
  current.entryIds.forEach((id, index) => known.set(id, current.messages[index]));
  const messages = page.messages.map((message, index) => known.get(page.entryIds[index]) ?? message);
  const start = page.hasMore && page.entryIds.length ? current.entryIds.indexOf(page.entryIds[0]) : -1;
  if (start < 0) return { ...page, messages };
  return {
    messages: [...current.messages.slice(0, start), ...messages],
    entryIds: [...current.entryIds.slice(0, start), ...page.entryIds],
    oldestEntryId: current.oldestEntryId,
    hasMore: current.hasMore,
  };
}

/**
 * Prepends an older page asked for with `before: cursor`. A poll that replaced
 * the transcript in between moved the cursor, and the page no longer joins on:
 * it is dropped, never prepended over a gap or twice.
 */
export function prependOlderPage(current: SubagentTranscript, cursor: string, page: SubagentTranscript): SubagentTranscript {
  if (current.oldestEntryId !== cursor) return current;
  return {
    messages: [...page.messages, ...current.messages],
    entryIds: [...page.entryIds, ...current.entryIds],
    oldestEntryId: page.oldestEntryId,
    hasMore: page.hasMore,
  };
}
