/**
 * Blocking extension UI waits in arrival order, one entry per request id: the
 * dialogs (select / confirm / input / editor) in one queue, `ctx.ui.custom()`
 * panels in another. Several can be open at once — tools running in parallel,
 * each gated by a permission extension — and the server holds every one until it
 * is answered or closed, so a single slot would let a later request hide an
 * earlier one that then never gets a response.
 *
 * Every helper returns the queue it was given when nothing changes, so a
 * replayed request or a repeated close does not re-render.
 */

/** Appends a request unless its id is already waiting (SSE reconnects replay every pending request). */
export function enqueueExtensionUiRequest<T extends { id: string }>(queue: T[], request: T): T[] {
  if (queue.some((item) => item.id === request.id)) return queue;
  return [...queue, request];
}

/**
 * Replaces the request with the same id where it stands, or appends it. A custom
 * panel re-sends its whole render under its id on every change, and that render
 * must neither move the panel in the queue nor be dropped as a replay.
 */
export function upsertExtensionUiRequest<T extends { id: string }>(queue: T[], request: T): T[] {
  const index = queue.findIndex((item) => item.id === request.id);
  if (index === -1) return [...queue, request];
  if (queue[index] === request) return queue;
  return queue.map((item, itemIndex) => itemIndex === index ? request : item);
}

/**
 * Keeps only the requests the server still holds. A close sent while this tab's
 * event stream was down never arrives, and the stale request would otherwise stay
 * at the head of the queue, hiding every request behind it.
 */
export function retainExtensionUiRequests<T extends { id: string }>(queue: T[], ids: ReadonlySet<string>): T[] {
  if (queue.every((item) => ids.has(item.id))) return queue;
  return queue.filter((item) => ids.has(item.id));
}

/** Removes exactly the request with this id: answered, cancelled, expired, or closed by Stop. */
export function removeExtensionUiRequest<T extends { id: string }>(queue: T[], id: string): T[] {
  if (!queue.some((item) => item.id === id)) return queue;
  return queue.filter((item) => item.id !== id);
}
