import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { computeTurnToolDurationMs } = await jiti.import("./turn-timing.ts");

function assistant(timestamp, endedAt) {
  return { role: "assistant", content: [], model: "m", provider: "p", timestamp, endedAt };
}
function toolResult(timestamp) {
  return { role: "toolResult", toolCallId: String(timestamp), content: [], timestamp };
}

test("empty turn or tool-free turn yields zero", () => {
  assert.equal(computeTurnToolDurationMs([], 3000), 0);
  assert.equal(computeTurnToolDurationMs([assistant(4000, 5000)], 3000), 0);
});

test("serial tools sum each toolResult - previous assistant end", () => {
  const msgs = [
    assistant(4000, 5000),  // generation ends -> tool 1 starts
    toolResult(7000),       // 2000ms
    assistant(8000, 9000),  // generation ends -> tool 2 starts
    toolResult(11000),      // 2000ms
  ];
  assert.equal(computeTurnToolDurationMs(msgs, 3000), 4000);
});

test("parallel tools collapse to last toolResult - assistant end", () => {
  const msgs = [
    assistant(4000, 5000), // issues tool A and B in one message
    toolResult(7000),      // A done: 2000ms
    toolResult(8000),      // B done: +1000ms
  ];
  assert.equal(computeTurnToolDurationMs(msgs, 3000), 3000);
});

test("missing timestamps are skipped without crashing", () => {
  const msgs = [
    assistant(4000, 5000),
    toolResult(undefined), // no timestamp -> no gap, cursor unchanged
    assistant(8000, 9000),
  ];
  assert.equal(computeTurnToolDurationMs(msgs, 3000), 0);
});

test("toolResult earlier than the cursor never adds negative time", () => {
  const msgs = [
    assistant(4000, 5000),
    toolResult(4000), // before assistant end (5000): skipped
  ];
  assert.equal(computeTurnToolDurationMs(msgs, 3000), 0);
});

test("assistant without endedAt falls back to its own timestamp", () => {
  const msgs = [
    assistant(4000, undefined), // end falls back to timestamp 4000
    toolResult(6500),           // 2500ms
  ];
  assert.equal(computeTurnToolDurationMs(msgs, 3000), 2500);
});
