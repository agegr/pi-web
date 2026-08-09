import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");

test("RPC running snapshot tracks tool, compaction, generation and queue state", () => {
  let listener = null;
  const inner = {
    sessionId: "running-session",
    sessionFile: "E:/sessions/running.jsonl",
    isStreaming: true,
    isCompacting: false,
    isBashRunning: false,
    pendingMessageCount: 2,
    sessionManager: {
      getCwd: () => "E:/pi-web-worktrees/nav",
      getSessionName: () => "Navigation task",
      getBranch: () => [{
        type: "message",
        message: { role: "user", content: "Check navigation" },
      }],
    },
    subscribe: (next) => {
      listener = next;
      return () => { listener = null; };
    },
    dispose: () => {},
    abortBash: () => {},
    extensionRunner: {},
  };
  const wrapper = new AgentSessionWrapper(inner);
  wrapper.start();

  listener({ type: "tool_execution_start", toolCallId: "tool-1", toolName: "bash", args: { command: "npm test" } });
  assert.deepEqual(wrapper.getRunningSnapshot().status, { kind: "executing", detail: "bash npm test" });
  assert.equal(wrapper.getRunningSnapshot().queued, 2);

  listener({ type: "compaction_start" });
  assert.deepEqual(wrapper.getRunningSnapshot().status, { kind: "compacting" });
  listener({ type: "compaction_end" });
  listener({ type: "tool_execution_end", toolCallId: "tool-1" });
  assert.deepEqual(wrapper.getRunningSnapshot().status, { kind: "generating" });

  wrapper.destroy();
});
