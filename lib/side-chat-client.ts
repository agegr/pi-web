import type { SessionInfo } from "./types";

/** The fork route's refusals of a side chat, as translated notices. */
export const SIDE_REFUSAL_MESSAGES = {
  not_found: "sideChat.error.notFound",
  unsaved: "sideChat.error.unsaved",
  empty: "sideChat.error.empty",
  subagent: "sideChat.error.subagent",
  side: "sideChat.error.side",
} as const;

/** Fork a session into a side chat. `name` is what to call it instead of its first message's first line. */
export async function createSideChat(
  sourceSessionId: string,
  translate: (key: (typeof SIDE_REFUSAL_MESSAGES)[keyof typeof SIDE_REFUSAL_MESSAGES]) => string,
  name?: string,
): Promise<{ session: SessionInfo } | { error: string }> {
  const res = await fetch(`/api/sessions/${encodeURIComponent(sourceSessionId)}/fork`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ side: true, ...(name ? { name } : {}) }),
    cache: "no-store",
  });
  const data = await res.json().catch(() => null) as
    | { sessionId?: string; session?: SessionInfo; code?: string; error?: string }
    | null;
  if (res.ok && data?.sessionId && data.session) return { session: data.session };
  return {
    error: data?.code && data.code in SIDE_REFUSAL_MESSAGES
      ? translate(SIDE_REFUSAL_MESSAGES[data.code as keyof typeof SIDE_REFUSAL_MESSAGES])
      : data?.error ?? `HTTP ${res.status}`,
  };
}
