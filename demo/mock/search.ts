/** GET /api/sessions/search — plain substring search over message text. */
import type { SessionEntry } from "@/lib/types";
import { allSessions, sessionInfo } from "./sessions/store";

function blocksOf(entry: SessionEntry): string[] {
  if (entry.type !== "message") return [];
  const message = entry.message as { role: string; content?: unknown };
  if (message.role !== "user" && message.role !== "assistant") return [];
  if (typeof message.content === "string") return [message.content];
  if (!Array.isArray(message.content)) return [];
  return message.content.map((block: { type?: string; text?: string }) => (block?.type === "text" ? block.text ?? "" : ""));
}

export async function searchSessions(query: string) {
  const needle = query.trim().toLowerCase();
  const results: unknown[] = [];
  if (!needle) return { results, truncated: false };
  for (const session of allSessions()) {
    if (session.transient) continue;
    for (const entry of session.entries) {
      const blocks = blocksOf(entry);
      for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
        const text = blocks[blockIndex];
        const index = text.toLowerCase().indexOf(needle);
        if (index < 0) continue;
        results.push({
          session: sessionInfo(session),
          entryId: entry.id,
          blockIndex,
          before: text.slice(Math.max(0, index - 60), index).replace(/\s+/g, " "),
          match: text.slice(index, index + needle.length),
          after: text.slice(index + needle.length, index + needle.length + 80).replace(/\s+/g, " "),
        });
        if (results.length >= 50) return { results, truncated: true };
        break;
      }
    }
  }
  return { results, truncated: false };
}
