import type { ClientMessageUpdateEvent } from "./agent-event-wire";
import { normalizeToolCalls } from "./normalize";
import type {
  AgentMessage,
  AssistantContentBlock,
  AssistantMessage,
} from "./types";

export type ClientAssistantMessageEvent =
  ClientMessageUpdateEvent["assistantMessageEvent"];

export interface StreamingState {
  isStreaming: boolean;
  streamingMessage: AssistantMessage | null;
  toolArgsJson: Record<number, string>;
}

export type StreamAction =
  | { type: "start" }
  | { type: "snapshot"; message: AgentMessage }
  | { type: "delta"; event: ClientAssistantMessageEvent }
  | { type: "end" };

export const INITIAL_STREAMING_STATE: StreamingState = {
  isStreaming: false,
  streamingMessage: null,
  toolArgsJson: {},
};

function closePartialJson(json: string): string {
  const source = json.trim();
  if (!source) return "{}";
  let inString = false;
  let escape = false;
  const stack: string[] = [];
  for (const char of source) {
    if (inString) {
      if (escape) escape = false;
      else if (char === "\\") escape = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") stack.push("}");
    else if (char === "[") stack.push("]");
    else if (char === "}" || char === "]") stack.pop();
  }
  let suffix = "";
  if (escape) suffix += "\\";
  if (inString) suffix += '"';
  suffix += stack.reverse().join("");
  return source + suffix;
}

function parsePartialToolArgs(json: string): Record<string, unknown> {
  try {
    const value = JSON.parse(closePartialJson(json));
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function toolCallBlock(
  current: AssistantContentBlock | undefined,
  id?: string,
  toolName?: string,
  input?: Record<string, unknown>,
): AssistantContentBlock {
  const existing = current?.type === "toolCall" ? current : undefined;
  return {
    type: "toolCall",
    toolCallId: id || existing?.toolCallId || "",
    toolName: toolName || existing?.toolName || "",
    input: input ?? existing?.input ?? {},
  };
}

function updateContentBlock(
  state: StreamingState,
  contentIndex: number,
  update: (current: AssistantContentBlock | undefined) => AssistantContentBlock | null,
): StreamingState {
  const message = state.streamingMessage;
  if (!message || !Number.isInteger(contentIndex) || contentIndex < 0) return state;

  const content = [...message.content];
  const nextBlock = update(content[contentIndex]);
  if (!nextBlock) return state;
  content[contentIndex] = nextBlock;
  return {
    ...state,
    isStreaming: true,
    streamingMessage: { ...message, content },
  };
}

function applyDelta(
  state: StreamingState,
  event: ClientAssistantMessageEvent,
): StreamingState {
  switch (event.type) {
    case "text_start":
      return updateContentBlock(state, event.contentIndex, (current) => (
        current?.type === "text" ? current : { type: "text", text: "" }
      ));
    case "text_delta":
      return updateContentBlock(state, event.contentIndex, (current) => (
        current?.type === "text"
          ? { ...current, text: current.text + event.delta }
          : null
      ));
    case "text_end":
      return updateContentBlock(state, event.contentIndex, (current) => ({
        ...(current?.type === "text" ? current : {}),
        type: "text",
        text: event.content,
      }));
    case "thinking_start":
      return updateContentBlock(state, event.contentIndex, (current) => (
        current?.type === "thinking" ? current : { type: "thinking", thinking: "" }
      ));
    case "thinking_delta":
      return updateContentBlock(state, event.contentIndex, (current) => (
        current?.type === "thinking"
          ? { ...current, thinking: current.thinking + event.delta }
          : null
      ));
    case "thinking_end":
      return updateContentBlock(state, event.contentIndex, (current) => ({
        ...(current?.type === "thinking" ? current : {}),
        type: "thinking",
        thinking: event.content,
      }));
    case "toolcall_start":
      return updateContentBlock(state, event.contentIndex, (current) => toolCallBlock(
        current,
        "id" in event && typeof event.id === "string" ? event.id : undefined,
        "toolName" in event && typeof event.toolName === "string" ? event.toolName : undefined,
      ));
    case "toolcall_delta": {
      if (!state.streamingMessage || !Number.isInteger(event.contentIndex) || event.contentIndex < 0) {
        return state;
      }
      const raw = (state.toolArgsJson[event.contentIndex] ?? "") + event.delta;
      const id = "id" in event && typeof event.id === "string" ? event.id : undefined;
      const toolName = "toolName" in event && typeof event.toolName === "string" ? event.toolName : undefined;
      const next = updateContentBlock(state, event.contentIndex, (current) => toolCallBlock(
        current,
        id,
        toolName,
        parsePartialToolArgs(raw),
      ));
      return {
        ...next,
        toolArgsJson: { ...state.toolArgsJson, [event.contentIndex]: raw },
      };
    }
    case "toolcall_end":
      return updateContentBlock(state, event.contentIndex, () => ({
        type: "toolCall",
        toolCallId: event.toolCall.id,
        toolName: event.toolCall.name,
        input: event.toolCall.arguments,
      }));
    default:
      return state;
  }
}

export function streamReducer(
  state: StreamingState,
  action: StreamAction,
): StreamingState {
  switch (action.type) {
    case "start":
      return { isStreaming: true, streamingMessage: null, toolArgsJson: {} };
    case "snapshot": {
      const message = normalizeToolCalls(action.message);
      return message.role === "assistant"
        ? { isStreaming: true, streamingMessage: message, toolArgsJson: {} }
        : state;
    }
    case "delta":
      return applyDelta(state, action.event);
    case "end":
      return INITIAL_STREAMING_STATE;
    default:
      return state;
  }
}
