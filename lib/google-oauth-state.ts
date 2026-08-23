/**
 * The short-lived pieces of the Google OAuth handshake, shared by the two
 * routes that make up one round trip.
 *
 * They lived in `app/api/robin/google/route.ts` and were imported from the
 * callback next door, which reads naturally and does not build: Next generates
 * a type for every route file asserting that it exports nothing but handlers
 * and a small set of config keys, so a helper alongside them fails the
 * production type check even though it works in dev.
 */
import { randomBytes } from "node:crypto";

/** Abandoned authorize attempts should not accumulate. */
const STATE_TTL_MS = 10 * 60_000;

/**
 * The OAuth `state` nonces, held in memory only.
 *
 * globalThis rather than a module constant so the set survives Next's dev hot
 * reload, matching how pi-web keeps its own cross-reload state. A restart
 * forgets them, which only costs an in-flight authorize its round trip.
 */
const stateStore = ((globalThis as { __robinGoogleStates?: Set<string> }).__robinGoogleStates ??= new Set<string>());

export function issueState(): string {
  const state = randomBytes(16).toString("hex");
  stateStore.add(state);
  setTimeout(() => stateStore.delete(state), STATE_TTL_MS).unref?.();
  return state;
}

/** True exactly once per issued state; anything else is not ours. */
export function consumeState(state: string): boolean {
  return stateStore.delete(state);
}

/** The redirect must match what is registered in the Google client exactly. */
export function redirectUriFor(req: Request): string {
  return new URL("/api/robin/google/callback", new URL(req.url).origin).toString();
}
