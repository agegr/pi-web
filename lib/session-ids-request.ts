import { hasJsonContentType, isApiRequestAllowed } from "./request-security";
import { SESSION_ID_PATTERN } from "./session-ui-state-shared";

export const NO_STORE = { "Cache-Control": "no-store" };

/** `{ error }` with `status`, never cached. */
export function noStoreRefusal(status: number, error: string): Response {
  return Response.json({ error }, { status, headers: NO_STORE });
}

/**
 * The `ids` of a `POST { ids: string[] }` that acts on sessions (delete,
 * stats): a request of Pi Web's own, a JSON body, and 1 to `max` session ids.
 * Anything else is answered with the refusal to send.
 */
export async function readSessionIdsRequest(req: Request, max: number): Promise<string[] | Response> {
  if (!isApiRequestAllowed(req)) return noStoreRefusal(403, "Untrusted API request");
  if (!hasJsonContentType(req)) return noStoreRefusal(415, "Content-Type must be application/json");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return noStoreRefusal(400, "Invalid JSON body");
  }
  const ids = typeof body === "object" && body !== null && !Array.isArray(body) ? (body as { ids?: unknown }).ids : undefined;
  if (!Array.isArray(ids) || ids.length === 0) return noStoreRefusal(400, "ids must be a non-empty array");
  if (ids.length > max) return noStoreRefusal(400, `ids may hold at most ${max} session ids`);
  if (!ids.every((id): id is string => typeof id === "string" && SESSION_ID_PATTERN.test(id))) return noStoreRefusal(400, "ids must be session ids");
  return ids;
}
