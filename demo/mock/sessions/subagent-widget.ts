import { SESSION_IDS } from "./ids";

/**
 * A real `subagent-async` widget line captured from a pi-subagents run, keyed by
 * the parent session it belongs to. `/api/agent/[id]` get_state serves it so the
 * static demo shows the Agents panel with a live run's progress, exactly as the
 * extension publishes it (`PI_SUBAGENT_ASYNC_JSON:` prefix included).
 */
const RUN_ID = "019d7b54-9b2a-7e79-c3d4-8c9d0e1f2a18";

const snapshot = {
  kind: "pi-subagents.async-status-snapshot",
  version: 1,
  generatedAt: Date.now(),
  runs: [
    {
      id: RUN_ID,
      kind: "subagent",
      label: "scout",
      state: "running",
      startedAt: Date.now() - 42_000,
      updatedAt: Date.now(),
      activity: {
        state: "active",
        currentTool: "grep",
        currentToolStartedAt: Date.now() - 3_000,
        lastActivityAt: Date.now() - 1_000,
        turnCount: 4,
        toolCount: 9,
      },
    },
  ],
};

export const SUBAGENT_ASYNC_SNAPSHOT_WIDGET: Record<string, string> = {
  [SESSION_IDS.extend]: `PI_SUBAGENT_ASYNC_JSON:${JSON.stringify(snapshot)}`,
};
