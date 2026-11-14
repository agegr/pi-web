import type { SessionInfo } from "./types";
import { sideChatTitle } from "./session-family";

/** Where a side chat's search hit goes: its parent's chat, with this chat's tab. */
export interface SideChatHit {
  parentSessionId: string;
  /** The parent's own title, when the list has it: the hit says whose side chat it is. */
  parentTitle?: string;
  /** The tab's label, numbered the way the Agents switcher numbers untitled side chats. */
  label: string;
}

/**
 * A side chat never opens as the main chat (ADR 0007): it lives in its parent's
 * right panel. Picking its search hit opens the parent and then the side chat's
 * tab. Null for every other session, which the hit selects as usual.
 */
export function sideChatHit(
  session: SessionInfo,
  sessions: readonly SessionInfo[],
  untitled: string,
): SideChatHit | null {
  if (session.relation?.kind !== "side") return null;
  const parentSessionId = session.relation.parentSessionId;
  const parent = sessions.find((item) => item.id === parentSessionId);
  const parentTitle = parent?.name || parent?.firstMessage || undefined;
  // Numbered among its own parent's side chats, as the Agents switcher does. The
  // hit itself counts even when the caller's list has not listed it yet (a
  // search can read a catalogue newer than the page), so the row and its tab
  // carry the same number.
  const siblings = sessions.filter((item) => item.relation?.kind === "side" && item.relation.parentSessionId === parentSessionId);
  const members = siblings.some((item) => item.id === session.id) ? siblings : [...siblings, session];
  return { parentSessionId, ...(parentTitle ? { parentTitle } : {}), label: sideChatTitle(session, untitled, members) };
}
