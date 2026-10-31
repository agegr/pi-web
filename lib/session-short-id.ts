/**
 * The 8-character form a subagent report shows for a session id, and the only part of a UUIDv7 that
 * tells two sessions apart: the head is a millisecond timestamp plus a per-process counter, the tail
 * is 32 random bits. `uuidv7()` in pi-ai writes bytes 0-11 and leaves bytes 12-15 as
 * `crypto.getRandomValues` filled them, so the last 8 hex digits are fresh random per id.
 *
 * A model that copies a full id confuses the shared head; the tail is what it must carry between
 * calls. Anything that is not a UUID-shaped id is returned unchanged, so a test's `child-session`
 * reads exactly as before.
 */

const DASHED_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DASHLESS_UUID = /^[0-9a-f]{32}$/i;

/** The only short form a tool accepts: exactly 8 hex digits, `shortSessionId()`'s output. */
export const SHORT_SESSION_ID = /^[0-9a-f]{8}$/i;

export function isShortSessionId(value: string): boolean {
  return SHORT_SESSION_ID.test(value);
}

export function shortSessionId(id: string): string {
  if (!DASHED_UUID.test(id) && !DASHLESS_UUID.test(id)) return id;
  return id.replaceAll("-", "").toLowerCase().slice(-8);
}
