import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  interopDefault: true,
  moduleCache: false,
});
const { createSubagentBackgroundWorkProbe } = await jiti.import("./subagent-background-work.ts");

function createEventBus() {
  const listeners = new Map();
  return {
    emit(event, data) {
      for (const listener of listeners.get(event) ?? []) listener(data);
    },
    on(event, listener) {
      const current = listeners.get(event) ?? new Set();
      current.add(listener);
      listeners.set(event, current);
      return () => current.delete(listener);
    },
  };
}

function installStatusBridge(events, runs, omitted = { runs: 0, children: 0, byteLimitExceeded: false }) {
  events.on("subagents:rpc:v1:request", (request) => {
    events.emit(`subagents:rpc:v1:reply:${request.requestId}`, {
      version: 1,
      requestId: request.requestId,
      method: "status",
      success: true,
      data: {
        asyncSnapshot: {
          kind: "pi-subagents.async-status-snapshot",
          version: 1,
          omitted,
          runs,
        },
      },
    });
  });
  events.emit("subagents:rpc:v1:ready", {
    version: 1,
    methods: ["status"],
    session: { sessionId: "session-id" },
  });
}

test("keeps a session alive while pi-subagents reports queued or running work", async () => {
  const events = createEventBus();
  const probe = createSubagentBackgroundWorkProbe(events, "session-id");
  installStatusBridge(events, [{ id: "run-1", state: "running" }]);

  assert.equal(await probe.hasActiveWork(), true);
  probe.dispose();
});

test("allows idle shutdown after all reported subagent work is terminal", async () => {
  const events = createEventBus();
  const probe = createSubagentBackgroundWorkProbe(events, "session-id");
  installStatusBridge(events, [{ id: "run-1", state: "complete" }]);

  assert.equal(await probe.hasActiveWork(), false);
  probe.dispose();
});

test("keeps a session alive when the status snapshot omits possible active descendants", async () => {
  const events = createEventBus();
  const probe = createSubagentBackgroundWorkProbe(events, "session-id");
  installStatusBridge(
    events,
    [{ id: "workflow", state: "complete" }],
    { runs: 0, children: 1, byteLimitExceeded: false },
  );

  assert.equal(await probe.hasActiveWork(), true);
  probe.dispose();
});

test("does not delay shutdown when the subagent RPC bridge is absent", async () => {
  const events = createEventBus();
  const probe = createSubagentBackgroundWorkProbe(events, "session-id", { timeoutMs: 1 });

  assert.equal(await probe.hasActiveWork(), false);
  probe.dispose();
});
