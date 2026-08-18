import type { AgentMessage, AssistantMessage, TextContent, UserMessage } from "./types";

export type SessionSearchRole = "user" | "assistant";

export interface SessionSearchDocument {
  entryId: string;
  messageIndex: number;
  role: SessionSearchRole;
  text: string;
}

export interface SessionMessageMatch extends SessionSearchDocument {
  snippet: string;
}

export interface GlobalSessionSearchHit extends SessionMessageMatch {
  sessionId: string;
}

export interface SessionSearchTarget {
  requestId: number;
  sessionId: string;
  entryId: string;
  query: string;
}

function messageText(message: AgentMessage): { role: SessionSearchRole; text: string } | null {
  if (message.role === "user") {
    const content = (message as UserMessage).content;
    return {
      role: "user",
      text: typeof content === "string"
        ? content
        : content
          .filter((block): block is TextContent => block.type === "text")
          .map((block) => block.text)
          .join("\n"),
    };
  }

  if (message.role === "assistant") {
    return {
      role: "assistant",
      // Conversation search intentionally excludes reasoning and tool payloads:
      // they are noisy, often hidden, and may contain very large generated data.
      text: (message as AssistantMessage).content
        .filter((block): block is TextContent => block.type === "text")
        .map((block) => block.text)
        .join("\n"),
    };
  }

  return null;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function createSessionSearchDocuments(
  messages: AgentMessage[],
  entryIds: string[],
): SessionSearchDocument[] {
  const documents: SessionSearchDocument[] = [];
  for (let messageIndex = 0; messageIndex < messages.length; messageIndex += 1) {
    const entryId = entryIds[messageIndex];
    if (!entryId) continue;
    const searchable = messageText(messages[messageIndex] as AgentMessage);
    if (!searchable) continue;
    const text = normalizeText(searchable.text);
    if (!text) continue;
    documents.push({ entryId, messageIndex, role: searchable.role, text });
  }
  return documents;
}

export function createSessionSearchSnippet(text: string, query: string, maxLength = 180): string {
  if (text.length <= maxLength) return text;
  const needle = query.trim().toLocaleLowerCase();
  const matchIndex = text.toLocaleLowerCase().indexOf(needle);
  const center = matchIndex === -1 ? 0 : matchIndex + Math.floor(needle.length / 2);
  const start = Math.max(0, Math.min(text.length - maxLength, center - Math.floor(maxLength / 2)));
  const excerpt = text.slice(start, start + maxLength).trim();
  return `${start > 0 ? "…" : ""}${excerpt}${start + maxLength < text.length ? "…" : ""}`;
}

export function searchSessionDocuments(
  documents: SessionSearchDocument[],
  query: string,
  limit = Number.POSITIVE_INFINITY,
): SessionMessageMatch[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle || limit <= 0) return [];

  const matches: SessionMessageMatch[] = [];
  for (const document of documents) {
    if (!document.text.toLocaleLowerCase().includes(needle)) continue;
    matches.push({
      ...document,
      snippet: createSessionSearchSnippet(document.text, query),
    });
    if (matches.length >= limit) break;
  }
  return matches;
}

export function searchSessionMessages(
  messages: AgentMessage[],
  entryIds: string[],
  query: string,
  limit?: number,
): SessionMessageMatch[] {
  return searchSessionDocuments(createSessionSearchDocuments(messages, entryIds), query, limit);
}
