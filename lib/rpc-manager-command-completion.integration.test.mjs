import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fauxAssistantMessage, fauxProvider, fauxText } from "@earendil-works/pi-ai";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const agentDir = await mkdtemp(join(tmpdir(), "pi-web-command-completion-agent-"));
process.env.PI_CODING_AGENT_DIR = agentDir;

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");

test.after(() => rm(agentDir, { recursive: true, force: true }));

const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

async function waitFor(condition) {
  for (let i = 0; i < 200 && !condition(); i += 1) await nextTurn();
}

async function startSession(t, extension) {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-command-completion-cwd-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const faux = fauxProvider({ models: [{ id: "faux-command-completion" }] });
  const modelRuntime = await ModelRuntime.create({
    authPath: join(agentDir, "auth.json"),
    modelsPath: null,
    refreshOnCreate: false,
  });
  modelRuntime.registerNativeProvider(faux.provider);
  const settingsManager = SettingsManager.inMemory();
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    extensionFactories: [extension],
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  });
  await resourceLoader.reload();
  const { session } = await createAgentSession({
    cwd,
    agentDir,
    modelRuntime,
    model: faux.getModel("faux-command-completion"),
    sessionManager: SessionManager.inMemory(cwd),
    settingsManager,
    resourceLoader,
  });
  const completed = [];
  const events = [];
  const wrapper = new AgentSessionWrapper(session, {
    onAgentRunComplete: (sessionId) => completed.push(sessionId),
  });
  t.after(() => wrapper.destroy());
  wrapper.start();
  wrapper.onEvent((event) => events.push(event.type));
  wrapper.beginExtensionBinding();
  await wrapper.waitUntilReady();
  return { faux, session, wrapper, completed, events };
}

// pi reports a command "handled" once its handler returns, and pi.sendUserMessage()
// does not wait: the run a command asks for starts after that.
test("pi's handled extension commands announce only the runs they start (#1345)", async (t) => {
  const { faux, session, wrapper, completed, events } = await startSession(t, (pi) => {
    pi.registerCommand("ps-probe", { handler: async () => {} });
    pi.registerCommand("ask", { handler: async (args) => pi.sendUserMessage(args) });
  });
  const count = (type) => events.filter((event) => event === type).length;
  const settled = async (runs) => {
    await waitFor(() => count("agent_settled") === runs && !wrapper.isRunning());
    await nextTurn();
  };

  await wrapper.send({ type: "prompt", message: "/ps-probe" });
  await wrapper.send({ type: "prompt", message: "/ps-probe" });
  await waitFor(() => count("prompt_done") === 2 && !wrapper.isRunning());
  await nextTurn();
  assert.equal(count("agent_start"), 0);
  assert.deepEqual(completed, []);

  faux.setResponses([fauxAssistantMessage([fauxText("done")])]);
  await wrapper.send({ type: "prompt", message: "/ask fix the test" });
  await settled(1);
  assert.deepEqual(completed, [session.sessionId]);

  faux.setResponses([fauxAssistantMessage([fauxText("again")])]);
  await wrapper.send({ type: "prompt", message: "plain prompt" });
  await settled(2);
  assert.deepEqual(completed, [session.sessionId, session.sessionId]);
});
