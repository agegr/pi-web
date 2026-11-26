import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

// The referenced session is resolved through the agent dir: never the real one.
const agentDir = await mkdtemp(join(tmpdir(), "pi-web-reference-agent-"));
const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = agentDir;
test.after(async () => {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  await rm(agentDir, { recursive: true, force: true });
});

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");

/** An idle SDK session whose prompt() records what it was given. */
function makeInner(manager, calls) {
  const listeners = new Set();
  return {
    sessionId: manager.getSessionId(),
    sessionFile: manager.getSessionFile(),
    sessionManager: manager,
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    autoCompactionEnabled: true,
    autoRetryEnabled: true,
    pendingMessageCount: 0,
    model: undefined,
    systemPrompt: "",
    agent: { state: {} },
    extensionRunner: {},
    prompt(message, options) {
      calls.push(message);
      options?.preflightResult?.(calls.length === 1 ? "started" : "queued");
      return Promise.resolve();
    },
    getSteeringMessages: () => [],
    getFollowUpMessages: () => [],
    clearQueue: () => ({ steering: [], followUp: [] }),
    getContextUsage: () => undefined,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {},
  };
}

test("a prompt quoting a session keeps its place ahead of a prompt sent after it", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-reference-cwd-"));
  const sessionsDir = join(agentDir, "sessions", "--reference--");
  await mkdir(sessionsDir, { recursive: true });
  const referenced = SessionManager.create(cwd, sessionsDir);
  referenced.appendMessage({ role: "user", content: "the old question", timestamp: Date.now() });
  referenced.appendMessage({
    role: "assistant",
    content: [{ type: "text", text: "the old answer" }],
    stopReason: "stop",
    timestamp: Date.now(),
  });

  const manager = SessionManager.create(cwd, join(cwd, "own-sessions"));
  const calls = [];
  const wrapper = new AgentSessionWrapper(makeInner(manager, calls));
  wrapper.start();
  t.after(async () => {
    wrapper.destroy();
    await rm(cwd, { recursive: true, force: true });
  });

  // Not awaited one by one: the second arrives while the first's file is read.
  await Promise.all([
    wrapper.send({ type: "prompt", message: `see [old chat](#session:${referenced.getSessionId()})`, streamingBehavior: "steer" }),
    wrapper.send({ type: "prompt", message: "sent second", streamingBehavior: "steer" }),
  ]);

  assert.equal(calls.length, 2);
  assert.match(calls[0], /^see <session-reference title="old chat"/);
  assert.match(calls[0], /User: the old question\n\nAssistant: the old answer/);
  assert.equal(calls[1], "sent second");
});

test("a referenced file deleted since it was resolved is reported, not quoted as empty", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-reference-cwd-"));
  const sessionsDir = join(agentDir, "sessions", "--vanished--");
  await mkdir(sessionsDir, { recursive: true });
  const referenced = SessionManager.create(cwd, sessionsDir);
  referenced.appendMessage({ role: "user", content: "gone soon", timestamp: Date.now() });
  referenced.appendMessage({ role: "assistant", content: [{ type: "text", text: "ok" }], stopReason: "stop", timestamp: Date.now() });

  const manager = SessionManager.create(cwd, join(cwd, "own-sessions"));
  const calls = [];
  const wrapper = new AgentSessionWrapper(makeInner(manager, calls));
  wrapper.start();
  t.after(async () => {
    wrapper.destroy();
    await rm(cwd, { recursive: true, force: true });
  });

  const message = `see [gone](#session:${referenced.getSessionId()})`;
  await wrapper.send({ type: "prompt", message });
  assert.match(calls[0], /User: gone soon/);
  // The path stays cached; the file does not.
  await rm(referenced.getSessionFile());
  await wrapper.send({ type: "prompt", message, streamingBehavior: "steer" });
  assert.equal(calls[1], "see (A referenced session could not be read: gone.)");
});
