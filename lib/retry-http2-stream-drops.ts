import { isContextOverflow, type AssistantMessage } from "@earendil-works/pi-ai";

// TEMPORARY. pi decides whether a failed assistant turn is worth retrying from a
// fixed list of error texts (RETRYABLE_PROVIDER_ERROR_PATTERN in pi-ai's
// utils/retry.ts). Relay providers word a dropped HTTP/2 stream differently from
// the providers those patterns were written against — pi knows Bedrock's "http2
// request did not get a response" but not a relay's "Upstream HTTP/2 stream
// failed" — so the drop fails fast and the run stops. Delete this file and its
// call in AgentSessionWrapper once pi's list covers these messages upstream.

// The missing texts, and nothing wider: an HTTP/2 *stream* stated together with a
// failure word in the same clause — the class stops at a period or a newline, so a
// relay that dumps a body has to name the drop in one line to be retried. This adds
// cases; it never widens a class. An `AbortError`, an HTTP/2 framing or protocol
// error, a proxy that refuses HTTP/2, a model that does not support streaming, and a
// bare "HTTP/2 stream" mention all stay as fatal as pi called them.
const UPSTREAM_HTTP2_STREAM_DROP = /http\/?2[ _-]?stream(?!ing)[^.\n]{0,24}?(?:fail|reset|clos|terminat|abort|cancel|drop|broken|error)/i;

// pi's NON_RETRYABLE_PROVIDER_LIMIT_ERROR_PATTERN is private, and from outside its
// fatal verdict is indistinguishable from "not in the retryable list" — both return
// false. Because the rule above runs after that verdict, re-check the account-limit
// markers here so a relay that wraps a quota/billing body in transport wording stays
// fatal instead of burning the retry budget on it. Only consulted on a path pi
// already called non-retryable, so it can never suppress a retry pi wanted, and
// drifting from pi's list costs at most an early fail-fast (today's behaviour).
const ACCOUNT_LIMIT_MARKERS = /insufficient_quota|quota exceeded|out of budget|billing|available balance|usage limit|UsageLimitError/i;

interface RetryJudgeHost {
  _isRetryableError?: (this: unknown, message: AssistantMessage) => boolean;
}

export function retryHttp2StreamDrops(session: object): void {
  const host = session as RetryJudgeHost;
  const original = host._isRetryableError;
  // An SDK release that renames the judge leaves this installing a method nothing
  // calls, so the bug comes back on its own instead of breaking session startup.
  if (typeof original !== "function") return;
  host._isRetryableError = function (this: unknown, message: AssistantMessage): boolean {
    // Ask pi first: its verdict is only ever overruled on the way to `true` for a
    // drop, so nothing pi retries can stop being retried.
    if (original.call(this, message)) return true;
    // A user Stop arrives as stopReason "aborted", never "error", so it cannot be
    // retried by wording; context overflow belongs to compaction, not retry.
    return message.stopReason === "error"
      && !!message.errorMessage
      && !isContextOverflow(message)
      && !ACCOUNT_LIMIT_MARKERS.test(message.errorMessage)
      && UPSTREAM_HTTP2_STREAM_DROP.test(message.errorMessage);
  };
}
