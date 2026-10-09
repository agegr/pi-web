import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { isRetryableAssistantError } from "@earendil-works/pi-ai";

const jiti = createJiti(import.meta.url, {
  interopDefault: true,
  moduleCache: false,
});
const { retryHttp2StreamDrops } = await jiti.import("./retry-http2-stream-drops.ts");

function judge() {
  const session = { _isRetryableError: isRetryableAssistantError };
  retryHttp2StreamDrops(session);
  return (errorMessage, stopReason = "error") => session._isRetryableError({ errorMessage, stopReason });
}

test("a relay's HTTP/2 stream drop is retried, though pi's own list misses it", () => {
  const isRetryable = judge();

  assert.equal(isRetryableAssistantError({ stopReason: "error", errorMessage: "Upstream HTTP/2 stream failed" }), false);
  assert.equal(isRetryable("Upstream HTTP/2 stream failed"), true);
  assert.equal(isRetryable("upstream_http2_stream_error: Upstream HTTP/2 stream failed"), true);
  assert.equal(isRetryable("HTTP/2 stream was reset (INTERNAL_ERROR)"), true);
  assert.equal(isRetryable("HTTP/2 stream closed before the response completed"), true);
  assert.equal(isRetryable("relay: http/2 stream dropped while streaming tools"), true);
});

test("the patch only adds texts: pi's verdicts still decide everything else", () => {
  const isRetryable = judge();

  assert.equal(isRetryable("OpenAI Responses stream ended before a terminal response event"), true);
  assert.equal(isRetryable("server_error: Our servers are currently overloaded."), true);
  assert.equal(isRetryable("insufficient_quota: You exceeded your current quota"), false);
  assert.equal(isRetryable("Monthly usage limit reached"), false);
  assert.equal(isRetryable("some error we have never seen"), false);
  assert.equal(isRetryable(undefined), false);
  // An aborted turn carrying the same wording is the user's Stop, not a drop.
  assert.equal(isRetryable("Upstream HTTP/2 stream failed", "aborted"), false);
});

test("an HTTP/2 mention that is not a stream drop stays fatal", () => {
  const isRetryable = judge();

  // Every one of these is fatal to pi too, so a looser predicate is what would make
  // them retry: an abort, a framing/protocol failure, a config or policy refusal, and
  // a transport phrase attached to a fatal quota/overflow verdict.
  const notAStreamDrop = [
    "HTTP/2 stream",
    "AbortError: The operation was aborted.",
    "The user aborted a request.",
    "ERR_HTTP2_PAYLOAD_ERROR: Invalid payload length 16777216 greater than maximum 16384",
    "PROTOCOL_ERROR: http/2 connection negotiated h2 but streams were refused",
    "model http2-large does not support streaming",
    "your proxy says http/2 streams are blocked by policy",
    "insufficient_quota: quota exhausted (HTTP/2 stream reset upstream)",
    "Monthly usage limit reached (HTTP/2 stream closed)",
    "billing overdue (http/2 stream failure while sending)",
    "prompt too long: http/2 stream failed while sending 300k tokens",
  ];
  for (const errorMessage of notAStreamDrop) {
    assert.equal(isRetryableAssistantError({ errorMessage, stopReason: "error" }), false, errorMessage);
    assert.equal(isRetryable(errorMessage), false, errorMessage);
  }
});

test("a session whose judge is gone is left alone instead of crashing a run", () => {
  const session = {};
  retryHttp2StreamDrops(session);
  assert.equal("_isRetryableError" in session, false);
});
