// Runtime adapter: ties TrajectoryRecorder and the StreamFn wrapper to one
// AgentSession. Used only for sessions created by Pi Web after the feature
// ships; existing sessions never get a sidecar.

import type { StreamFn } from "@earendil-works/pi-agent-core";
import { TrajectoryRecorder, type TrajectoryRecorderOptions } from "./trajectory-recorder";
import { wrapTrajectoryStream } from "./trajectory-stream";

/** Minimal structural view of the session the runtime needs. */
export interface TrajectoryRuntimeSession {
  agent: { streamFunction: unknown };
  sessionManager: { getLeafId(): string | null };
}

export interface TrajectoryRuntime {
  recorder: TrajectoryRecorder;
  installStreamWrapper(): void;
  handleAgentEvent(event: { type: string; [key: string]: unknown }): void;
  close(): Promise<void>;
}

export function createTrajectoryRuntime(
  session: TrajectoryRuntimeSession,
  options: TrajectoryRecorderOptions,
): TrajectoryRuntime {
  const recorder = new TrajectoryRecorder({
    ...options,
    getLeafId: () => session.sessionManager.getLeafId(),
  });
  let streamWrapperInstalled = false;
  let closed = false;

  return {
    recorder,

    installStreamWrapper(): void {
      if (streamWrapperInstalled || closed) return;
      streamWrapperInstalled = true;
      const base = session.agent.streamFunction as StreamFn;
      session.agent.streamFunction = wrapTrajectoryStream(base, {
        startRequest: (model, context, opts) => recorder.startRequest(model, context, opts),
        firstToken: (requestId) => recorder.firstToken(requestId),
        finishRequest: (requestId, status, result) => recorder.finishRequest(requestId, status, result),
      });
    },

    handleAgentEvent(event: { type: string; [key: string]: unknown }): void {
      recorder.onAgentEvent(event);
    },

    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      await recorder.close();
    },
  };
}
