import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const agentDir = await mkdtemp(join(tmpdir(), "pi-web-stop-queue-agent-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");
test.after(() => rm(agentDir, { recursive: true, force: true }));
const tick = () => new Promise((r) => setTimeout(r, 10));

async function setup(t, steeringMode) {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-stop-queue-cwd-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const gate = { started: false };
  const extension = (pi) => {
    pi.registerTool({
      name: "wait", label: "wait", description: "waits", parameters: { type: "object", properties: {} },
      async execute(_id, _p, signal) {
        gate.started = true;
        await new Promise((resolve) => { signal?.addEventListener("abort", resolve, { once: true }); });
        return { content: [{ type: "text", text: "stopped" }], details: undefined };
      },
    });
  };
  const faux = fauxProvider({ models: [{ id: "faux-stop-queue" }] });
  const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null, refreshOnCreate: false });
  modelRuntime.registerNativeProvider(faux.provider);
  const settingsManager = SettingsManager.inMemory(steeringMode ? { steeringMode } : {});
  const resourceLoader = new DefaultResourceLoader({ cwd, agentDir, settingsManager, extensionFactories: [extension], noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
  await resourceLoader.reload();
  const { session } = await createAgentSession({ cwd, agentDir, modelRuntime, model: faux.getModel("faux-stop-queue"), sessionManager: SessionManager.inMemory(cwd), settingsManager, resourceLoader });
  const wrapper = new AgentSessionWrapper(session);
  t.after(() => wrapper.destroy());
  wrapper.start();
  wrapper.beginExtensionBinding();
  await wrapper.waitUntilReady();
  const userTexts = () => session.messages.filter((m) => m.role === "user")
    .map((m) => (typeof m.content === "string" ? m.content : m.content[0]?.text));
  const settle = async () => { for (let i = 0; i < 300 && (wrapper.isRunning() || !session.isIdle); i += 1) await tick(); };
  return { session, wrapper, faux, gate, userTexts, settle };
}

// Stop lands while a tool runs, with two steers and a follow-up queued. pi's TUI
// clears the queues before it aborts and puts the texts in the editor; left queued,
// the stopped run still sent a steer at its turn boundary (all of them in "all" mode)
// and the rest went out with the next prompt.
for (const mode of ["one-at-a-time", "all"]) {
  test(`Stop returns every queued message and sends none of them (steeringMode ${mode})`, async (t) => {
    const { wrapper, faux, gate, userTexts, settle } = await setup(t, mode);
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("wait", {})], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxText("reply")]),
    ]);
    await wrapper.send({ type: "prompt", message: "start" });
    while (!gate.started) await tick();
    await wrapper.send({ type: "prompt", message: "s1", streamingBehavior: "steer" });
    await wrapper.send({ type: "prompt", message: "s2", streamingBehavior: "steer" });
    await wrapper.send({ type: "prompt", message: "f1", streamingBehavior: "followUp" });

    assert.deepEqual(await wrapper.send({ type: "abort" }), { steering: ["s1", "s2"], followUp: ["f1"] });
    await settle();
    assert.deepEqual((await wrapper.send({ type: "get_state" })).queuedMessages, { steering: [], followUp: [] });
    assert.deepEqual(userTexts(), ["start"]);

    await wrapper.send({ type: "prompt", message: "next" });
    await settle();
    assert.deepEqual(userTexts(), ["start", "next"]);
  });
}

test("Stop with nothing queued returns null", async (t) => {
  const { wrapper, faux, gate, settle } = await setup(t);
  faux.setResponses([fauxAssistantMessage([fauxToolCall("wait", {})], { stopReason: "toolUse" })]);
  await wrapper.send({ type: "prompt", message: "start" });
  while (!gate.started) await tick();
  assert.equal(await wrapper.send({ type: "abort" }), null);
  await settle();
});
