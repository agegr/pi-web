// A queued subagent's wrapper is idle until a slot frees, but its run will prompt that very SDK
// session: the idle timer must not dispose it meanwhile (#1590).
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const testAgentDir = await mkdtemp(join(tmpdir(), "pi-web-subagent-idle-"));
process.env.PI_CODING_AGENT_DIR = testAgentDir;

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const { AgentSessionWrapper, SESSION_IDLE_TIMEOUT_MS } = await jiti.import("./rpc-manager.ts");

after(async () => {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  await rm(testAgentDir, { recursive: true, force: true });
});

const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

test("an idle child wrapper stays open while its subagent run waits for a slot", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
  globalThis.__piSubagentRuns ??= new Map();
  const runs = globalThis.__piSubagentRuns;
  const stored = { run: { sessionId: "queued-child", parentSessionId: "parent", status: "queued" } };
  runs.set("queued-child", stored);
  t.after(() => { if (runs.get("queued-child") === stored) runs.delete("queued-child"); });
  let disposed = false;
  const wrapper = new AgentSessionWrapper({
    sessionId: "queued-child",
    isBashRunning: false,
    isStreaming: false,
    isCompacting: false,
    extensionRunner: {},
    agent: { state: {} },
    subscribe: () => () => {},
    dispose() { disposed = true; },
  }, { suppressCompletionNotifications: true });
  t.after(() => wrapper.destroy());
  wrapper.start();

  t.mock.timers.tick(3 * SESSION_IDLE_TIMEOUT_MS);
  await nextTurn();
  assert.equal(wrapper.isAlive(), true, "a queued run keeps its session");
  assert.equal(disposed, false);

  // The run settled and left the map: the next idle check releases the wrapper as usual.
  runs.delete("queued-child");
  t.mock.timers.tick(SESSION_IDLE_TIMEOUT_MS);
  await nextTurn();
  assert.equal(wrapper.isAlive(), false);
});
