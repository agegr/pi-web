import type { AgentMessage, AssistantMessage, ToolCallContent } from "./types";

function isObject(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}

function streamingRawInput(block: Record<string, unknown>): string | undefined {
  if (typeof block.rawInput === "string") return block.rawInput;
  if (typeof block.partialJson === "string") return block.partialJson;
  if (typeof block.partialArgs === "string") return block.partialArgs;

  const customInput = isObject(block.customInput) ? block.customInput : null;
  const property = customInput && typeof customInput.property === "string"
    ? customInput.property
    : null;
  const args = isObject(block.arguments) ? block.arguments : null;
  return property && args && typeof args[property] === "string"
    ? args[property]
    : undefined;
}

function normalizeToolCallBlock(
  block: unknown,
  options: { includeStreamingRawInput?: boolean } = {},
): ToolCallContent | null {
  if (!isObject(block) || block.type !== "toolCall") return null;
  const normalized: ToolCallContent = {
    type: "toolCall",
    toolCallId: typeof block.toolCallId === "string" ? block.toolCallId : (typeof block.id === "string" ? block.id : ""),
    toolName: typeof block.toolName === "string" ? block.toolName : (typeof block.name === "string" ? block.name : ""),
    input: typeof block.input === "object" && block.input !== null && !Array.isArray(block.input)
      ? block.input as Record<string, unknown>
      : (typeof block.arguments === "object" && block.arguments !== null && !Array.isArray(block.arguments)
        ? block.arguments as Record<string, unknown>
        : {}),
  };
  const rawInput = options.includeStreamingRawInput ? streamingRawInput(block) : undefined;
  return rawInput === undefined ? normalized : { ...normalized, rawInput };
}

function normalizeAssistantToolCalls(
  msg: AgentMessage,
  options: { includeStreamingRawInput?: boolean } = {},
): AgentMessage {
  // Non-assistant roles (user, toolResult, bashExecution, custom) are returned
  // unchanged — only assistant messages go through tool-call field normalization.
  if (msg.role !== "assistant") return msg;
  const content = (msg as AssistantMessage).content;
  if (!Array.isArray(content)) return msg;
  const normalized = content.map((block) => {
    const result = normalizeToolCallBlock(block, options);
    return result ?? block;
  });
  return { ...msg, content: normalized } as AgentMessage;
}

export function normalizeToolCalls(msg: AgentMessage): AgentMessage {
  return normalizeAssistantToolCalls(msg);
}

export function normalizeStreamingToolCalls(msg: AgentMessage): AgentMessage {
  return normalizeAssistantToolCalls(msg, { includeStreamingRawInput: true });
}
