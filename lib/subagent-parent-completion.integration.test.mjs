import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fauxAssistantMessage, fauxProvider, fauxText } from "@earendil-works/pi-ai";
import {
  createAgentSessionFromServices, createAgentSessionServices, ModelRuntime, SessionManager, SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");
const { createSubagentController, hasUnsettledSubagentRun } = await jiti.import("./subagent-runtime.ts");
const answer = (text) => fauxAssistantMessage([fauxText(text)]);
const tick = () => new Promise((resolve) => setImmediate(resolve));

async function until(check) {
  const deadline = Date.now() + 5_000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for fixture phase");
    await tick();
  }
}

test("real SDK: a main session announces its task once, after the run its last subagent report starts (#1434)", { timeout: 20_000 }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-family-completion-"));
  const oldAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  const sessions = new Map();
  t.after(async () => {
    for (const wrapper of sessions.values()) {
      wrapper.destroy();
    }
    if (oldAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = oldAgentDir;
    await rm(dir, { recursive: true, force: true });
  });
  await mkdir(join(dir, "agents"));
  await writeFile(join(dir, "agents", "fixture.md"), [
    "---", "description: Synthetic notification fixture.", "tools: read",
    "load_skills: false", "load_extensions: false", "mcp: off", "codemode: off", "---", "Report the result.",
  ].join("\n"));
  const faux = fauxProvider({ models: [{ id: "family-fixture" }] });
  const modelRuntime = await ModelRuntime.create({
    authPath: join(dir, "auth.json"), modelsPath: null, refreshOnCreate: false,
  });
  modelRuntime.registerNativeProvider(faux.provider);
  const services = await createAgentSessionServices({
    cwd: dir, agentDir: dir, modelRuntime, settingsManager: SettingsManager.inMemory(),
    resourceLoaderOptions: { noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true },
  });
  const { session: parent } = await createAgentSessionFromServices({
    services, sessionManager: SessionManager.create(dir, join(dir, "sessions")), model: faux.getModel("family-fixture"),
  });
  const pushed = [];
  const root = new AgentSessionWrapper(parent, { onAgentRunComplete: (id) => pushed.push(id) });
  sessions.set(parent.sessionId, root);
  root.start();
  const ends = [];
  root.onEvent((event) => { if (event.type === "agent_settled" || event.type === "prompt_done") ends.push(event); });
  const controller = createSubagentController({
    getSession: (id) => sessions.get(id),
    registerSession: (inner) => {
      const wrapper = new AgentSessionWrapper(inner, { suppressCompletionNotifications: true });
      sessions.set(inner.sessionId, wrapper);
      wrapper.start();
      return wrapper;
    },
    resolveSessionPath: async (id) => sessions.get(id)?.sessionFile ?? null,
    reopenSession: async () => { throw new Error("Fixture should keep its sessions alive"); },
    invalidateSessionList() {},
    isBuiltInSubagentsEnabled: () => true,
  });
  const firstReply = Promise.withResolvers();
  const childReply = Promise.withResolvers();
  const finalReply = Promise.withResolvers();
  let parentEntered = false;
  let childEntered = false;
  let finalEntered = false;
  faux.setResponses([
    async () => { parentEntered = true; await firstReply.promise; return answer("Background task dispatched."); },
    async () => { childEntered = true; await childReply.promise; return answer("Child report."); },
    async () => { finalEntered = true; await finalReply.promise; return answer("Final synthesis."); },
  ]);
  // Release all synthetic model calls even if an assertion fails; never leave a real run hanging.
  t.after(() => { firstReply.resolve(); childReply.resolve(); finalReply.resolve(); });
  await root.send({ type: "prompt", message: "Delegate a task, then synthesize its report." });
  await until(() => parentEntered);
  const execution = await controller.extensionRuntime.start({
    parentContext: { sessionManager: parent.sessionManager }, parentToolCallId: "fixture-call",
    profile: "fixture", task: "Return a report.", description: "Background fixture", runInBackground: true,
  });
  const notification = execution.completion.then((run) => controller.extensionRuntime.notifyParent(run));
  await until(() => childEntered);
  firstReply.resolve();
  await until(() => ends.some((event) => event.type === "prompt_done"));
  assert.equal(root.isRunning(), false);
  assert.equal(hasUnsettledSubagentRun(root.sessionId), true);
  assert.deepEqual(pushed, [], "the main session is idle, but its child is still running");
  // The page reads the same from the run's end: no chime, no notification.
  assert.deepEqual(ends.map((event) => [event.type, event.subagentsActive]), [
    ["agent_settled", true],
    ["prompt_done", true],
  ]);

  ends.length = 0;
  childReply.resolve();
  await until(() => finalEntered);
  assert.equal(root.isRunning(), true);
  // The report's turn has started: from here the parent's run stands for it.
  assert.equal(hasUnsettledSubagentRun(root.sessionId), false);
  assert.deepEqual(pushed, [], "the child's report alone is not completion");
  finalReply.resolve();
  await notification;
  assert.equal(root.isRunning(), false);
  assert.equal(parent.getLastAssistantText(), "Final synthesis.");
  assert.deepEqual(pushed, [root.sessionId]);
  assert.deepEqual(ends, [{ type: "agent_settled", aborted: false }]);
});
