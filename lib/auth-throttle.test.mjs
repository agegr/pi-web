import assert from "node:assert/strict";
import test from "node:test";

const {
  AUTH_THROTTLE_MAX_DELAY_MS,
  AUTH_THROTTLE_RESET_AFTER_MS,
  backoffDelayMs,
  createAuthThrottleState,
  getAuthRetryAfterMs,
  recordAuthFailure,
  recordAuthSuccess,
  retryAfterSeconds,
} = await import("./auth-throttle.ts");

test("allows attempts until the first failure", () => {
  const state = createAuthThrottleState();
  assert.equal(getAuthRetryAfterMs(1_000, state), 0);
});

test("doubles the delay on each failure and caps at the maximum", () => {
  const state = createAuthThrottleState();
  let now = 0;
  const delays = [];
  for (let i = 0; i < 8; i += 1) {
    delays.push(recordAuthFailure(now, state));
    now += delays[delays.length - 1];
  }
  assert.deepEqual(delays, [1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000]);
  assert.ok(AUTH_THROTTLE_RESET_AFTER_MS > AUTH_THROTTLE_MAX_DELAY_MS, "waiting out a block must not reset the counter");
  assert.equal(backoffDelayMs(100), AUTH_THROTTLE_MAX_DELAY_MS);
  assert.equal(backoffDelayMs(0), 0);
});

test("reports the remaining block time and lifts it when it expires", () => {
  const state = createAuthThrottleState();
  recordAuthFailure(10_000, state);
  recordAuthFailure(11_000, state);
  assert.equal(getAuthRetryAfterMs(11_500, state), 1_500);
  assert.equal(getAuthRetryAfterMs(13_000, state), 0);
  assert.equal(state.failures, 2, "expired block keeps the failure count for backoff");
});

test("forgets failures once they are older than the reset window", () => {
  const state = createAuthThrottleState();
  recordAuthFailure(0, state);
  recordAuthFailure(1_000, state);
  const later = 1_000 + AUTH_THROTTLE_RESET_AFTER_MS;
  assert.equal(getAuthRetryAfterMs(later, state), 0);
  assert.equal(state.failures, 0);
  assert.equal(recordAuthFailure(later, state), 1_000, "backoff restarts from the base delay");
});

test("success clears the counter and the block", () => {
  const state = createAuthThrottleState();
  recordAuthFailure(0, state);
  recordAuthFailure(1_000, state);
  recordAuthSuccess(state);
  assert.equal(getAuthRetryAfterMs(1_001, state), 0);
  assert.equal(recordAuthFailure(1_001, state), 1_000);
});

test("Retry-After rounds up to whole seconds and is at least one", () => {
  assert.equal(retryAfterSeconds(1), 1);
  assert.equal(retryAfterSeconds(1_000), 1);
  assert.equal(retryAfterSeconds(1_001), 2);
  assert.equal(retryAfterSeconds(60_000), 60);
});

test("shares one global state across module instances", async () => {
  const other = await import(`./auth-throttle.ts?instance=${Date.now()}`);
  recordAuthSuccess();
  recordAuthFailure(0);
  assert.ok(other.getAuthRetryAfterMs(0) > 0);
  other.recordAuthSuccess();
  assert.equal(getAuthRetryAfterMs(0), 0);
});
