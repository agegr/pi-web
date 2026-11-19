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

const agentDir = await mkdtemp(join(tmpdir(), "pi-web-branch-model-agent-"));
process.env.PI_CODING_AGENT_DIR = agentDir;

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");

test.after(() => rm(agentDir, { recursive: true, force: true }));

// #1715: the model was switched after a reply, then the earlier message was edited and resent.
// The switch's model_change sat on the branch the resend left, so the branch a side chat copies
// (or a reopened session continues) named the old model.
test("a resend from an earlier message records the model the session runs on its own branch (#1715)", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-branch-model-cwd-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const faux = fauxProvider({ models: [{ id: "faux-old" }, { id: "faux-new" }] });
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
    extensionFactories: [{
      name: "noop-command",
      factory: (pi) => pi.registerCommand("noop", { description: "noop", handler: async () => {} }),
    }],
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
    model: faux.getModel("faux-old"),
    sessionManager: SessionManager.inMemory(cwd),
    settingsManager,
    resourceLoader,
  });
  const wrapper = new AgentSessionWrapper(session);
  t.after(() => wrapper.destroy());
  wrapper.start();
  wrapper.beginExtensionBinding();
  await wrapper.waitUntilReady();

  faux.setResponses([
    fauxAssistantMessage([fauxText("first")]),
    fauxAssistantMessage([fauxText("second")]),
    fauxAssistantMessage([fauxText("resent")]),
  ]);
  await session.prompt("one");
  await session.prompt("two");
  await session.setModel(faux.getModel("faux-new"));
  const entries = () => session.sessionManager.getEntries();
  const secondUser = entries().filter((e) => e.type === "message" && e.message.role === "user")[1];

  // The composer's edit: navigate to the message being edited, then send it again.
  await wrapper.send({ type: "navigate_tree", targetId: secondUser.id });
  const changes = () => entries().filter((entry) => entry.type === "model_change").length;
  const changesBefore = changes();
  // An extension command starts no run, so it records nothing, as pi's own run-start record.
  await wrapper.send({ type: "prompt", message: "/noop" });
  assert.equal(changes(), changesBefore);
  await wrapper.send({ type: "prompt", message: "two, reworded" });
  await session.agent.waitForIdle();

  const branch = session.sessionManager.getBranch();
  const lastChange = branch.findLast((entry) => entry.type === "model_change");
  assert.equal(`${lastChange.provider}/${lastChange.modelId}`, "faux/faux-new");
  const lastUser = branch.findLast((entry) => entry.type === "message" && entry.message.role === "user");
  assert.ok(branch.indexOf(lastChange) < branch.indexOf(lastUser), "recorded before the resent message");
});
