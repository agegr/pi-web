import type { AssistantMessageEvent } from "@earendil-works/pi-ai";
import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import { PI_WEB_TIMING_CUSTOM_TYPE } from "./session-timing";

export const HOST_TIMING_EXTENSION_NAME = "pi-web-timing";

/**
 * Time-to-first-token and decode time cannot be reconstructed from the session
 * log: Pi's `Usage` record stores tokens and cost but no durations. They are
 * only observable while a request is in flight, so this built-in extension
 * measures them live and persists one entry per model request.
 *
 * Entries go through `pi.appendEntry`, which writes a `custom` entry that Pi
 * documents as never participating in LLM context, so instrumentation cannot
 * change what the model sees. `computeSessionTiming()` reads them back.
 *
 * Caveat: sessions written before this extension existed carry no entries, so
 * their TTFT and output speed stay unknown and the UI shows a dash rather than
 * a guessed value.
 */
export function createTimingExtension(now: () => number = Date.now): InlineExtension {
  return {
    name: HOST_TIMING_EXTENSION_NAME,
    hidden: true,
    factory: (pi) => {
      // Anchored per request: `before_provider_request` is the closest host
      // hook to request dispatch, so everything after it counts as model time.
      let requestStartedAt: number | null = null;
      let firstTokenAt: number | null = null;

      pi.on("before_provider_request", () => {
        requestStartedAt = now();
        firstTokenAt = null;
      });

      pi.on("message_start", (event) => {
        if (event.message.role !== "assistant") return;
        // Auto-retries and host-initiated requests can stream without a fresh
        // provider-request hook, so fall back to the message start stamp.
        if (requestStartedAt === null) requestStartedAt = now();
        firstTokenAt = null;
      });

      pi.on("message_update", (event) => {
        if (firstTokenAt !== null) return;
        if (!isFirstToken(event.assistantMessageEvent)) return;
        firstTokenAt = now();
      });

      pi.on("message_end", (event) => {
        if (event.message.role !== "assistant") return;
        const message = event.message;
        const finishedAt = now();
        const startedAt = requestStartedAt;
        const tokenAt = firstTokenAt;
        requestStartedAt = null;
        firstTokenAt = null;

        const ttftMs = startedAt !== null && tokenAt !== null
          ? Math.max(0, tokenAt - startedAt)
          : null;
        const decodeMs = tokenAt !== null ? Math.max(0, finishedAt - tokenAt) : 0;

        // An aborted or errored request still has a meaningful TTFT, but a
        // partial decode would bias the weighted speed, so only completed
        // requests contribute decode time and output tokens.
        const decodeCompleted = message.stopReason !== "aborted" && message.stopReason !== "error";
        const outputTokens = typeof message.usage?.output === "number" && message.usage.output >= 0
          ? message.usage.output
          : 0;

        pi.appendEntry(PI_WEB_TIMING_CUSTOM_TYPE, {
          ttftMs,
          decodeMs: decodeCompleted ? decodeMs : 0,
          outputTokens: decodeCompleted ? outputTokens : 0,
          // Correlation key: the assistant message this sample belongs to.
          // Without it the trajectory view could only pair samples with
          // requests by position, which is an implicit contract that breaks
          // the moment an entry is inserted or filtered out.
          ...(typeof message.timestamp === "number" ? { messageTimestamp: message.timestamp } : {}),
          ...(typeof message.responseId === "string" ? { responseId: message.responseId } : {}),
          stopReason: message.stopReason,
          model: message.model,
          provider: message.provider,
          capturedAt: new Date(finishedAt).toISOString(),
        });
      });
    },
  };
}

/**
 * The first streamed token, whatever kind it is: thinking, visible text, or
 * tool-call arguments. Structural `*_start` frames are not tokens, so a
 * request that streams nothing measurable reports no TTFT rather than a
 * near-zero one.
 */
function isFirstToken(event: AssistantMessageEvent): boolean {
  if (
    event.type === "text_delta"
    || event.type === "thinking_delta"
    || event.type === "toolcall_delta"
  ) {
    return typeof event.delta === "string" && event.delta.length > 0;
  }
  return false;
}
