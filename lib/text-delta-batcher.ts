import type { ClientAssistantMessageEvent } from "@/lib/agent-event-wire";

type TextDelta = Extract<ClientAssistantMessageEvent, { type: "text_delta" }>;
type Schedule = (callback: FrameRequestCallback) => number;
type Cancel = (id: number) => void;

/**
 * Coalesces streaming text deltas into at most one scheduled emission per
 * animation frame while preserving ordering at content-index boundaries.
 * A content-index change, explicit flush, or dispose forces a synchronous
 * emission so event order stays exact.
 */
export function createTextDeltaBatcher(
  schedule: Schedule,
  cancel: Cancel,
  emit: (event: TextDelta) => void,
) {
  let pending: TextDelta | null = null;
  let frame: number | null = null;

  const emitPending = () => {
    const event = pending;
    pending = null;
    if (event) emit(event);
  };

  const onFrame = () => {
    frame = null;
    emitPending();
  };

  const flush = () => {
    if (frame !== null) {
      cancel(frame);
      frame = null;
    }
    emitPending();
  };

  return {
    push(event: TextDelta) {
      if (pending && pending.contentIndex !== event.contentIndex) flush();
      pending = pending
        ? { ...event, delta: pending.delta + event.delta }
        : event;
      if (frame === null) frame = schedule(onFrame);
    },
    flush,
    dispose() {
      if (frame !== null) cancel(frame);
      frame = null;
      pending = null;
    },
  };
}
