/**
 * Global exponential backoff for password authentication failures.
 *
 * Pi Web serves a single operator and binds to 127.0.0.1, so Next.js route
 * handlers have no reliable client address (`x-forwarded-for` is spoofable and
 * absent for direct connections). Rather than trusting a per-IP key, every
 * failure feeds one shared counter and briefly blocks all password attempts.
 * The only "other user" affected by the block is the operator, and a bounded
 * delay is acceptable for them while it caps brute force at roughly one guess
 * per minute.
 */

export const AUTH_THROTTLE_BASE_DELAY_MS = 1_000;
export const AUTH_THROTTLE_MAX_DELAY_MS = 60_000;

/**
 * Idle time after the last failure before the counter is forgotten. It must be
 * longer than the maximum delay, otherwise waiting out one block would restart
 * the backoff from the base delay and hand an attacker a fresh burst of guesses.
 */
export const AUTH_THROTTLE_RESET_AFTER_MS = 5 * 60_000;

export interface AuthThrottleState {
  failures: number;
  lastFailureAt: number;
  blockedUntil: number;
}

const STATE_KEY = "pi-web:auth-throttle";

function freshState(): AuthThrottleState {
  return { failures: 0, lastFailureAt: 0, blockedUntil: 0 };
}

export function createAuthThrottleState(): AuthThrottleState {
  return freshState();
}

/** Stored on `globalThis` so the counter survives Next.js hot reloads. */
function getGlobalState(): AuthThrottleState {
  const store = globalThis as Record<PropertyKey, unknown>;
  const key = Symbol.for(STATE_KEY);
  const existing = store[key];
  if (isState(existing)) return existing;
  const created = freshState();
  store[key] = created;
  return created;
}

function isState(value: unknown): value is AuthThrottleState {
  return typeof value === "object"
    && value !== null
    && typeof (value as AuthThrottleState).failures === "number"
    && typeof (value as AuthThrottleState).lastFailureAt === "number"
    && typeof (value as AuthThrottleState).blockedUntil === "number";
}

function expireIfStale(state: AuthThrottleState, now: number): void {
  if (state.failures > 0 && now - state.lastFailureAt >= AUTH_THROTTLE_RESET_AFTER_MS) {
    Object.assign(state, freshState());
  }
}

export function backoffDelayMs(failures: number): number {
  if (failures <= 0) return 0;
  const exponent = Math.min(failures - 1, 31);
  return Math.min(AUTH_THROTTLE_BASE_DELAY_MS * 2 ** exponent, AUTH_THROTTLE_MAX_DELAY_MS);
}

/**
 * Milliseconds the caller must still wait before another attempt is accepted,
 * or 0 when attempts are allowed.
 */
export function getAuthRetryAfterMs(
  now = Date.now(),
  state: AuthThrottleState = getGlobalState(),
): number {
  expireIfStale(state, now);
  return Math.max(0, state.blockedUntil - now);
}

/** Records a failed attempt and returns the delay now imposed on the next one. */
export function recordAuthFailure(
  now = Date.now(),
  state: AuthThrottleState = getGlobalState(),
): number {
  expireIfStale(state, now);
  state.failures += 1;
  state.lastFailureAt = now;
  const delay = backoffDelayMs(state.failures);
  state.blockedUntil = now + delay;
  return delay;
}

export function recordAuthSuccess(state: AuthThrottleState = getGlobalState()): void {
  Object.assign(state, freshState());
}

/** Whole seconds for the `Retry-After` header; never less than 1 while blocked. */
export function retryAfterSeconds(retryAfterMs: number): number {
  return Math.max(1, Math.ceil(retryAfterMs / 1000));
}
