import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { phaseLabel, runStatePhase } = await jiti.import("./chat-phase-label.ts");

/** Translate that echoes the key plus params, so assertions read as intent. */
const t = (key, params = {}) => (Object.keys(params).length ? `${key}:${JSON.stringify(params)}` : key);

test("reports the phase the stream is actually in", () => {
  assert.equal(phaseLabel({ kind: "waiting_model" }, t), "chat.waitingModel");
  assert.equal(phaseLabel({ kind: "running_command" }, t), "chat.runningCommand");
  assert.equal(phaseLabel(null, t), null);
  assert.equal(phaseLabel(undefined, t), null);
});

test("describes the tools currently running", () => {
  const one = phaseLabel({ kind: "running_tools", tools: [{ name: "Read" }] }, t);
  assert.equal(one, 'chat.runningNamedTool:{"name":"Read"}');

  assert.equal(
    phaseLabel({ kind: "running_tools", tools: [{ name: "Read" }, { name: "Grep" }] }, t),
    'chat.runningTools:{"names":"Read, Grep"}',
  );
  assert.equal(phaseLabel({ kind: "running_tools", tools: [] }, t), "chat.runningTool");

  // Progress on the newest tool is appended, not the first one's.
  assert.equal(
    phaseLabel({ kind: "running_tools", tools: [{ name: "Read" }, { name: "Bash", progress: "3/5" }] }, t),
    'chat.runningNamedTool:{"name":"Bash"} 3/5',
  );
});

test("compaction overrides the model phase so a long compaction does not read as a hang", () => {
  // The reported bug: a turn enters auto-compaction, the stream has not produced a token
  // yet, and the status still says "waiting for model".
  assert.equal(phaseLabel({ kind: "waiting_model" }, t, true), "chat.compacting");
  assert.equal(phaseLabel({ kind: "running_tools", tools: [{ name: "Read" }] }, t, true), "chat.compacting");
  assert.equal(phaseLabel(null, t, true), "chat.compacting");
});

test("a coarse run state does not downgrade a running tool", () => {
  const running = { kind: "running_tools", tools: [{ name: "Bash" }] };
  // A refresh mid-tool: the state read only reports isStreaming, and the tool it
  // is waiting on already reached the client from the stream replay.
  assert.equal(runStatePhase(running, true), running);
  assert.equal(runStatePhase(running, false), running);

  assert.deepEqual(runStatePhase(null, true), { kind: "waiting_model" });
  assert.deepEqual(runStatePhase({ kind: "waiting_model" }, true), { kind: "waiting_model" });
  assert.deepEqual(runStatePhase({ kind: "waiting_model" }, false), { kind: "running_command" });
  // No tools left to report: the phase falls back to the state.
  assert.deepEqual(runStatePhase({ kind: "running_tools", tools: [] }, true), { kind: "waiting_model" });
});

test("compaction flag off keeps the phase label", () => {
  assert.equal(phaseLabel({ kind: "waiting_model" }, t, false), "chat.waitingModel");
  assert.equal(phaseLabel({ kind: "running_command" }, t, false), "chat.runningCommand");
});

test("queued messages count beside the compaction label, and nowhere else", () => {
  assert.equal(phaseLabel(null, t, true, 2), 'chat.compactingQueued:{"count":2}');
  assert.equal(phaseLabel(null, t, true, 0), "chat.compacting");
  // A queued message does not change a running phase's label.
  assert.equal(phaseLabel({ kind: "waiting_model" }, t, false, 2), "chat.waitingModel");
});
