/** GET /api/sessions/search — every space-separated term (or "quoted phrase") in message text, else all in the session title. */
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

// The same split as parseTerms() in lib/session-search.ts.
function parseTerms(query: string): string[] {
  const terms: string[] = [];
  let current = "";
  let quoted = false;
  for (const char of query) {
    if (char === '"' && (quoted || !current)) {
      if (quoted && current) terms.push(current);
      if (quoted) current = "";
      quoted = !quoted;
    } else if (!quoted && /\s/.test(char)) {
      if (current) terms.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  if (current) terms.push(current);
  return terms;
}

export async function searchSessions(query: string) {
  const lowered = query.trim().toLowerCase();
  const terms = parseTerms(lowered);
  if (!terms.length && lowered) terms.push(lowered);
  const needle = terms[0];
  const results: unknown[] = [];
  if (!needle) return { results, truncated: false };
  for (const session of allSessions()) {
    if (session.transient) continue;
    // As lib/session-search.ts: the first term's first hit, once every other term is somewhere.
    let hit: unknown;
    let pending = terms.slice(1);
    for (const entry of session.entries) {
      const blocks = blocksOf(entry);
      for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
        const text = blocks[blockIndex];
        pending = pending.filter((term) => !text.toLowerCase().includes(term));
        const index = hit ? -1 : text.toLowerCase().indexOf(needle);
        if (index < 0) continue;
        hit = {
          session: sessionInfo(session),
          entryId: entry.id,
          blockIndex,
          before: text.slice(Math.max(0, index - 60), index).replace(/\s+/g, " "),
          match: text.slice(index, index + needle.length),
          after: text.slice(index + needle.length, index + needle.length + 80).replace(/\s+/g, " "),
        };
      }
      if (hit && !pending.length) break;
    }
    if (hit && !pending.length) {
      results.push(hit);
      if (results.length >= 50) return { results, truncated: true };
      continue;
    }
    // As lib/session-search.ts: the displayed title only when no message matched.
    const info = sessionInfo(session);
    const title = info.name || info.firstMessage;
    if (!terms.every((term) => title.toLowerCase().includes(term))) continue;
    const index = title.toLowerCase().indexOf(needle);
    results.push({
      session: info,
      blockIndex: 0,
      titleMatch: true,
      before: title.slice(0, index),
      match: title.slice(index, index + needle.length),
      after: title.slice(index + needle.length),
    });
    if (results.length >= 50) return { results, truncated: true };
  }
  return { results, truncated: false };
}
