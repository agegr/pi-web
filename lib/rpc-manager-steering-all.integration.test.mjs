import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const agentDir = await mkdtemp(join(tmpdir(), "pi-web-steering-all-agent-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");
test.after(() => rm(agentDir, { recursive: true, force: true }));
const tick = () => new Promise((r) => setTimeout(r, 10));

test("queued steering prompts are delivered together at the next turn boundary (#1771)", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-steering-all-cwd-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));

  let releaseTool;
  const toolStarted = new Promise((resolve) => {
    // resolved inside execute
    releaseTool = { start: resolve, finish: null };
  });
  const toolFinished = new Promise((resolve) => {
    releaseTool.finish = resolve;
  });

  const extension = (pi) => {
    pi.registerTool({
      name: "wait",
      label: "wait",
      description: "waits",
      parameters: { type: "object", properties: {} },
      async execute() {
        releaseTool.start();
        await toolFinished;
        return { content: [{ type: "text", text: "done" }], details: undefined };
      },
    });
  };

  const faux = fauxProvider({ models: [{ id: "faux-steering-all" }] });
  const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null, refreshOnCreate: false });
  modelRuntime.registerNativeProvider(faux.provider);
  const settingsManager = SettingsManager.inMemory({});
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
    model: faux.getModel("faux-steering-all"),
    sessionManager: SessionManager.inMemory(cwd),
    settingsManager,
    resourceLoader,
  });

  const wrapper = new AgentSessionWrapper(session);
  t.after(() => wrapper.destroy());
  wrapper.start();
  wrapper.beginExtensionBinding();
  await wrapper.waitUntilReady();

  assert.equal(session.agent.steeringMode, "all");

  faux.setResponses([
    fauxAssistantMessage([fauxToolCall("wait", {})], { stopReason: "toolUse" }),
    fauxAssistantMessage([fauxText("got both")]),
  ]);

  await wrapper.send({ type: "prompt", message: "start" });
  await toolStarted;

  await wrapper.send({ type: "prompt", message: "s1", streamingBehavior: "steer" });
  await wrapper.send({ type: "prompt", message: "s2", streamingBehavior: "steer" });

  releaseTool.finish();

  for (let i = 0; i < 300 && (wrapper.isRunning() || !session.isIdle); i += 1) await tick();

  const userTexts = session.messages
    .filter((m) => m.role === "user")
    .map((m) => (typeof m.content === "string" ? m.content : m.content[0]?.text));

  assert.deepEqual(userTexts, ["start", "s1", "s2"]);
  assert.deepEqual((await wrapper.send({ type: "get_state" })).queuedMessages, { steering: [], followUp: [] });
});
