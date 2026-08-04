import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { computeSessionTiming } = await jiti.import("./session-timing.ts");

const t = (ms) => ms;

function user(ms, text = "hi") {
  return { role: "user", content: text, ...(ms === undefined ? {} : { timestamp: t(ms) }) };
}
function assistant(ms, model = "m") {
  return { role: "assistant", content: [{ type: "text", text: "ok" }], model, ...(ms === undefined ? {} : { timestamp: t(ms) }) };
}
function toolResult(ms, toolCallId = "1") {
  return { role: "toolResult", toolCallId, content: [{ type: "text", text: "r" }], ...(ms === undefined ? {} : { timestamp: t(ms) }) };
}
function bash(ms) {
  return { role: "bashExecution", command: "ls", output: "", ...(ms === undefined ? {} : { timestamp: t(ms) }) };
}
function custom(ms, customType = "compaction") {
  return { role: "custom", customType, content: "x", display: true, ...(ms === undefined ? {} : { timestamp: t(ms) }) };
}

const ZERO = { modelWaitMs: 0, toolExecMs: 0, totalActiveMs: 0, otherMs: 0 };

test("empty or single-message session yields zeros", () => {
  assert.deepEqual(computeSessionTiming([]), ZERO);
  assert.deepEqual(computeSessionTiming([user(1000)]), ZERO);
});

test("user -> assistant gap counts as model wait", () => {
  const r = computeSessionTiming([user(1000), assistant(4000)]);
  assert.deepEqual(r, { modelWaitMs: 3000, toolExecMs: 0, totalActiveMs: 3000, otherMs: 0 });
});

test("assistant -> toolResult gap counts as tool execution", () => {
  const r = computeSessionTiming([assistant(1000), toolResult(4000)]);
  assert.deepEqual(r, { modelWaitMs: 0, toolExecMs: 3000, totalActiveMs: 3000, otherMs: 0 });
});

test("bash execution gap counts as tool execution", () => {
  const r = computeSessionTiming([assistant(1000), bash(7000)]);
  assert.deepEqual(r, { modelWaitMs: 0, toolExecMs: 6000, totalActiveMs: 6000, otherMs: 0 });
});

test("a full agentic turn decomposes into model wait + tool exec", () => {
  // user(0) -> assistant(5000) -> toolResult(9000) -> assistant(12000)
  const r = computeSessionTiming([user(0), assistant(5000), toolResult(9000), assistant(12000)]);
  assert.deepEqual(r, { modelWaitMs: 8000, toolExecMs: 4000, totalActiveMs: 12000, otherMs: 0 });
});

test("human idle gap before a user message is excluded from total", () => {
  // turn 1: user(0)->assistant(3000); idle 3s->20s; turn 2: user(20000)->assistant(23000)
  const r = computeSessionTiming([user(0), assistant(3000), user(20000), assistant(23000)]);
  // modelWait = 3000 + 3000 = 6000; the 17s idle gap is excluded; totalActive = 6000
  assert.deepEqual(r, { modelWaitMs: 6000, toolExecMs: 0, totalActiveMs: 6000, otherMs: 0 });
});

test("compaction / custom gaps fall into other", () => {
  const r = computeSessionTiming([user(0), custom(2000), assistant(5000)]);
  // user->custom (2000) = other; custom->assistant (3000) = model wait
  assert.deepEqual(r, { modelWaitMs: 3000, toolExecMs: 0, totalActiveMs: 5000, otherMs: 2000 });
});

test("messages without timestamps are skipped without breaking later gaps", () => {
  // assistant without timestamp in the middle; only the (user->assistant) pair on either
  // side of it is uncomputable, the rest still resolve.
  const r = computeSessionTiming([user(0), assistant(undefined), toolResult(5000)]);
  // user->assistant(?) skipped; assistant(?)->toolResult skipped => zeros
  assert.deepEqual(r, ZERO);
});

test("negative gaps from out-of-order timestamps are clamped to zero", () => {
  const r = computeSessionTiming([user(5000), assistant(3000)]);
  assert.deepEqual(r, { ...ZERO });
});
