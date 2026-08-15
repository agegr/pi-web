// Runtime adapter: ties TrajectoryRecorder and the StreamFn wrapper to one
// AgentSession. Used only for sessions created by Pi Web after the feature
// ships; existing sessions never get a sidecar.

import type { StreamFn } from "@earendil-works/pi-agent-core";
import { TrajectoryRecorder, type TrajectoryRecorderOptions } from "./trajectory-recorder";
import { wrapTrajectoryStream } from "./trajectory-stream";

export function createTrajectoryRuntime(
  session: {
    agent: { streamFunction: unknown };
    sessionManager: { getLeafId(): string | null };
  },
  options: TrajectoryRecorderOptions,
) {
  const recorder = new TrajectoryRecorder({
    ...options,
    getLeafId: () => session.sessionManager.getLeafId(),
  });
  const base = session.agent.streamFunction as StreamFn;
  session.agent.streamFunction = wrapTrajectoryStream(base, {
    startRequest: (model, context, opts) => recorder.startRequest(model, context, opts),
    firstToken: (requestId) => recorder.firstToken(requestId),
    finishRequest: (requestId, status, result) => recorder.finishRequest(requestId, status, result),
  });

  return {
    recorder,
    handleAgentEvent: (event: { type: string; [key: string]: unknown }) => recorder.onAgentEvent(event),
    close: () => recorder.close(),
  };
}

export type TrajectoryRuntime = ReturnType<typeof createTrajectoryRuntime>;
