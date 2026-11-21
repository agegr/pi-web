/**
 * The JSON answer of a Pi Web route. Throws the `error` the route answered
 * with, or `HTTP <status>` when the answer is not OK or not JSON (a proxy's
 * HTML error page, say), so a caller never shows a JSON parser's message.
 */
export async function readJsonOrThrow<T>(response: Pick<Response, "ok" | "status" | "json">): Promise<T> {
  let data: unknown;
  try {
    data = await response.json();
  } catch (cause) {
    // Only a body that is not JSON becomes the status: an abort or a dropped
    // connection keeps its own error, so a caller still recognises an AbortError.
    if (!(cause instanceof SyntaxError)) throw cause;
    throw new Error(`HTTP ${response.status}`);
  }
  const error = data !== null && typeof data === "object" ? (data as { error?: unknown }).error : undefined;
  if (typeof error === "string" && error) throw new Error(error);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return data as T;
}
