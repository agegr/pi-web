// Wrap the provider StreamFn to record request start, first token and
// completion without changing the stream contract.

import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { StreamFn } from "@earendil-works/pi-agent-core";

export interface TrajectoryStreamHooks {
  startRequest(model: unknown, context: unknown, options: unknown): string;
  firstToken(requestId: string): void;
  finishRequest(
    requestId: string,
    status: "complete" | "error" | "aborted",
    result?: unknown,
  ): void;
}

const DELTA_EVENT_TYPES = new Set(["text_delta", "thinking_delta", "toolcall_delta"]);

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || /abort/i.test(error.message));
}

/**
 * Returns a StreamFn that forwards every event untouched while reporting
 * request timing to the hooks. The wrapper returns an
 * `AssistantMessageEventStream`, so `result()` keeps working.
 */
export function wrapTrajectoryStream(base: StreamFn, hooks: TrajectoryStreamHooks): StreamFn {
  return (model, context, options) => {
    const requestId = hooks.startRequest(model, context, options);
    const output = createAssistantMessageEventStream();
    void (async () => {
      let markedFirstToken = false;
      try {
        const baseStream = await base(model, context, options);
        for await (const event of baseStream) {
          if (!markedFirstToken && DELTA_EVENT_TYPES.has(event.type)) {
            markedFirstToken = true;
            hooks.firstToken(requestId);
          }
          output.push(event);
        }
        const result = await baseStream.result();
        hooks.finishRequest(requestId, "complete", result);
        output.end(result);
      } catch (error) {
        hooks.finishRequest(requestId, isAbortError(error) ? "aborted" : "error", error);
        output.end();
      }
    })();
    return output;
  };
}
