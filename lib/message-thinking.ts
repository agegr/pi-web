import type { AgentMessage, AssistantMessage, SessionEntry } from "./types";

export const MESSAGE_THINKING_CUSTOM_TYPE = "pi-web:message-thinking";
const MAX_MESSAGE_THINKING_LABEL_LENGTH = 64;

export function normalizeMessageThinkingLabel(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error("Invalid message thinking label");
  const label = value.trim();
  if (!label || label.length > MAX_MESSAGE_THINKING_LABEL_LENGTH || /[\u0000-\u001f\u007f]/.test(label)) {
    throw new Error("Invalid message thinking label");
  }
  return label;
}

function customMessageThinkingLabel(entry: SessionEntry): string | undefined {
  if (entry.type !== "custom" || entry.customType !== MESSAGE_THINKING_CUSTOM_TYPE) return undefined;
  const data = entry.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return undefined;
  const fields = data as Record<string, unknown>;
  if (fields.version !== 1) return undefined;
  try {
    return normalizeMessageThinkingLabel(fields.label);
  } catch {
    return undefined;
  }
}

export function knownThinkingLevel(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const level = value.trim();
  return level || undefined;
}

export function messageThinkingLevel(
  message: Pick<AssistantMessage, "thinkingLevel">,
  fallback?: unknown,
): string | undefined {
  return knownThinkingLevel(message.thinkingLevel)
    ?? knownThinkingLevel(fallback);
}

/** Browser display only: copy the label selected when Send was pressed. */
export function withMessageThinking(message: AgentMessage, label?: string): AgentMessage {
  return message.role === "assistant" && label
    ? { ...message, thinkingLevel: label }
    : message;
}

/** Resolve only the displayed branch, including settings before a history page. */
export function readMessageThinkingLevels(
  entries: SessionEntry[],
  entryIds: string[],
): Map<string, string> {
  const levels = new Map<string, string>();
  if (!entryIds.length) return levels;
  const wanted = new Set(entryIds);
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const branch: SessionEntry[] = [];
  const visited = new Set<string>();
  let current = byId.get(entryIds[entryIds.length - 1]);
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    branch.push(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }

  const changes: Array<{ level: string | undefined; timestamp: number }> = [];
  let displayLabel: string | undefined;
  for (const entry of branch.reverse()) {
    if (entry.type === "thinking_level_change") {
      changes.push({ level: knownThinkingLevel(entry.thinkingLevel), timestamp: Date.parse(entry.timestamp) });
      displayLabel = undefined;
    }
    displayLabel = customMessageThinkingLabel(entry) ?? displayLabel;
    if (!wanted.has(entry.id) || entry.type !== "message" || entry.message.role !== "assistant") continue;
    const message = entry.message;
    let index = changes.length - 1;
    // Old records were appended at completion. A setting changed mid-response
    // must not relabel a response whose start timestamp precedes that change.
    if (typeof message.timestamp === "number" && Number.isFinite(message.timestamp)) {
      while (index >= 0 && changes[index].timestamp > message.timestamp) index -= 1;
    }
    const level = messageThinkingLevel(message, displayLabel ?? changes[index]?.level);
    if (level !== undefined) levels.set(entry.id, level);
  }
  return levels;
}

export function readCurrentMessageThinkingLabel(entries: SessionEntry[]): string | undefined {
  let label: string | undefined;
  for (const entry of entries) {
    if (entry.type === "thinking_level_change") label = undefined;
    label = customMessageThinkingLabel(entry) ?? label;
  }
  return label;
}
