import type { JsonAgentSessionEvent } from "@earendil-works/pi-coding-agent";

export interface AgentEventLike {
  type: string;
  [key: string]: unknown;
}

export type ClientMessageUpdateEvent = Extract<
  JsonAgentSessionEvent,
  { type: "message_update" }
>;

const OMITTED_EVENT_TYPES = new Set([
  "turn_start",
  "turn_end",
  "tool_execution_update",
]);

/** Apply pi-web's event filters plus Pi 0.84's message_update projection. */
export function toClientAgentEvent(
  event: AgentEventLike,
): AgentEventLike | ClientMessageUpdateEvent | null {
  if (OMITTED_EVENT_TYPES.has(event.type)) return null;

  if (event.type === "message_update") {
    const assistantMessageEvent = event.assistantMessageEvent;
    if (
      typeof assistantMessageEvent !== "object"
      || assistantMessageEvent === null
      || Array.isArray(assistantMessageEvent)
    ) return null;

    if (!("partial" in assistantMessageEvent)) {
      return {
        type: "message_update",
        assistantMessageEvent,
      } as ClientMessageUpdateEvent;
    }

    const { partial: _partial, ...deltaEvent } = assistantMessageEvent;
    void _partial;
    return {
      type: "message_update",
      assistantMessageEvent: deltaEvent,
    } as ClientMessageUpdateEvent;
  }

  if (event.type === "agent_end") return { type: "agent_end" };
  return event;
}

export function isEventIncludedInSnapshot(
  event: AgentEventLike,
  snapshot: unknown,
): boolean {
  return snapshot !== undefined
    && (event.type === "message_start" || event.type === "message_update")
    && event.message === snapshot;
}
