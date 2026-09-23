import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  addRunningTool,
  endRunningTool,
  phaseAfterMessage,
  updateRunningTool,
} = await jiti.import("./agent-phase.ts");

function assistant(content) {
  return {
    role: "assistant",
    content,
    model: "test-model",
    provider: "test-provider",
  };
}

test("enters tool execution as soon as the completed assistant message contains tool calls", () => {
  assert.deepEqual(phaseAfterMessage(null, assistant([{ type: "text", text: "Working" }])), {
    kind: "waiting_model",
  });
  assert.deepEqual(phaseAfterMessage(null, assistant([
    { type: "toolCall", toolCallId: "read-1", toolName: "read", input: {} },
    { type: "toolCall", toolCallId: "bash-1", toolName: "bash", input: {} },
  ])), {
    kind: "running_tools",
    tools: [
      { id: "read-1", name: "read" },
      { id: "bash-1", name: "bash" },
    ],
  });
});

test("preserves the active tool phase across user and tool result messages", () => {
  const running = {
    kind: "running_tools",
    tools: [{ id: "bash-1", name: "bash" }],
  };

  assert.strictEqual(phaseAfterMessage(running, {
    role: "user",
    content: "Queued while the tool runs",
  }), running);
  assert.strictEqual(phaseAfterMessage(running, {
    role: "toolResult",
    toolCallId: "read-1",
    toolName: "read",
    content: [],
  }), running);
});

test("keeps a single tool active without duplicating its start event", () => {
  let phase = addRunningTool(null, "bash-1", "bash");
  phase = addRunningTool(phase, "bash-1", "bash");
  phase = updateRunningTool(phase, "bash-1", "bash", "Compiling");

  assert.deepEqual(phase, {
    kind: "running_tools",
    tools: [{ id: "bash-1", name: "bash", progress: "Compiling" }],
  });
  assert.deepEqual(endRunningTool(phase, "bash-1"), { kind: "waiting_model" });
});

test("stays in tool execution until the last parallel tool finishes", () => {
  let phase = addRunningTool(null, "read-1", "read");
  phase = addRunningTool(phase, "bash-1", "bash");

  const afterRead = endRunningTool(phase, "read-1");
  assert.deepEqual(afterRead, {
    kind: "running_tools",
    tools: [{ id: "bash-1", name: "bash" }],
  });
  assert.deepEqual(endRunningTool(afterRead, "bash-1"), { kind: "waiting_model" });
});
