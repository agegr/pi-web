import type { AgentMessage } from "./types";

/**
 * Pi stores toolCall blocks as {id, name, arguments} but our types use
 * {toolCallId, toolName, input}. Normalize both file-read and streaming paths.
 */
export function normalizeToolCalls(msg: AgentMessage): AgentMessage {
  if (msg.role !== "assistant") return msg;
  const raw = msg as unknown as { content?: unknown[] };
  if (!Array.isArray(raw.content)) return msg;
  const normalized = raw.content.map((block) => {
    const b = block as Record<string, unknown>;
    if (b.type !== "toolCall") return b;
    return {
      type: "toolCall",
      toolCallId: b.toolCallId ?? b.id,
      toolName: b.toolName ?? b.name,
      input: b.input ?? b.arguments,
    };
  });
  return { ...(msg as object), content: normalized } as unknown as AgentMessage;
}
