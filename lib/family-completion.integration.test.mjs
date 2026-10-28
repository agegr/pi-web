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
const { forgetSessionCompletion } = await jiti.import("./session-completion.ts");
const answer = (text) => fauxAssistantMessage([fauxText(text)]);
const tick = () => new Promise((resolve) => setImmediate(resolve));

async function until(check) {
  const deadline = Date.now() + 5_000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for fixture phase");
    await tick();
  }
}

test("real SDK: background work and its final parent synthesis produce one shared completion", { timeout: 20_000 }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-family-completion-"));
  const oldAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  const sessions = new Map();
  t.after(async () => {
    for (const wrapper of sessions.values()) {
      wrapper.destroy();
      forgetSessionCompletion(wrapper.sessionId);
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
  const completions = [];
  root.onEvent((event) => { if (event.type === "session_complete") completions.push(event); });
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
    onFamilySettled: (id, options) => sessions.get(id)?.recheckCompletion(options),
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
  await until(() => !root.isRunning());
  assert.equal(hasUnsettledSubagentRun(root.sessionId), true);
  assert.deepEqual(completions, [], "the main session is idle, but its child is still running");
  assert.deepEqual(pushed, []);

  childReply.resolve();
  await until(() => finalEntered);
  assert.equal(root.isRunning(), true);
  assert.equal(hasUnsettledSubagentRun(root.sessionId), true, "delivery holds through the triggered parent run");
  assert.deepEqual(completions, [], "the child's report alone is not completion");
  finalReply.resolve();
  await notification;
  await until(() => completions.length === 1);
  assert.equal(hasUnsettledSubagentRun(root.sessionId), false);
  assert.equal(root.isRunning(), false);
  assert.equal(parent.getLastAssistantText(), "Final synthesis.");
  assert.deepEqual(pushed, [root.sessionId]);
  assert.equal(completions[0].completionId, root.completionId);
  assert.equal(sessions.get(execution.run.sessionId).completionId, undefined);
  root.recheckCompletion();
  assert.equal(completions.length, 1);
});
