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

const agentDir = await mkdtemp(join(tmpdir(), "pi-web-compaction-queue-agent-"));
process.env.PI_CODING_AGENT_DIR = agentDir;

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");

test.after(() => rm(agentDir, { recursive: true, force: true }));

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));
const replies = (count) => Array.from({ length: count }, (_, i) => fauxAssistantMessage([fauxText(`reply ${i}`)]));

/**
 * A real AgentSession whose manual compaction holds in `session_before_compact`
 * until the test releases it, and whose `input` handler takes a while for the
 * text "slow", as an extension's async input handler can.
 */
async function compactingSession(t) {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-compaction-queue-cwd-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const gate = { release: null };
  const extension = (pi) => {
    pi.on("session_before_compact", async (event) => {
      await new Promise((resolve) => { gate.release = resolve; });
      return {
        compaction: { summary: "summary", firstKeptEntryId: event.preparation.firstKeptEntryId, tokensBefore: 10 },
      };
    });
    pi.on("input", async (event) => {
      if (event.text === "slow") await new Promise((resolve) => setTimeout(resolve, 50));
      return { action: "continue" };
    });
  };
  const faux = fauxProvider({ models: [{ id: "faux-compaction-queue" }] });
  const modelRuntime = await ModelRuntime.create({
    authPath: join(agentDir, "auth.json"),
    modelsPath: null,
    refreshOnCreate: false,
  });
  modelRuntime.registerNativeProvider(faux.provider);
  const settingsManager = SettingsManager.inMemory({ compaction: { keepRecentTokens: 1 } });
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
    model: faux.getModel("faux-compaction-queue"),
    sessionManager: SessionManager.inMemory(cwd),
    settingsManager,
    resourceLoader,
  });
  const wrapper = new AgentSessionWrapper(session);
  t.after(() => wrapper.destroy());
  wrapper.start();
  wrapper.beginExtensionBinding();
  await wrapper.waitUntilReady();
  const events = [];
  wrapper.onEvent((event) => events.push(event));

  faux.setResponses(replies(2));
  await session.prompt("one");
  await session.prompt("two");
  const compaction = wrapper.send({ type: "compact" }).catch((error) => error);
  while (!gate.release) await tick();
  const sentAfterCompaction = () => session.messages
    .filter((message) => message.role === "user")
    .map((message) => (typeof message.content === "string" ? message.content : message.content[0]?.text))
    .filter((text) => text !== "one" && text !== "two");
  const settle = async () => {
    for (let i = 0; i < 200 && (wrapper.isRunning() || !session.isIdle); i += 1) await tick();
  };
  return { session, wrapper, faux, gate, events, compaction, sentAfterCompaction, settle };
}

test("prompts parked during a manual compaction go out in order, a slow input handler or not", async (t) => {
  const { wrapper, faux, gate, events, compaction, sentAfterCompaction, settle } = await compactingSession(t);

  assert.deepEqual(await wrapper.send({ type: "prompt", message: "slow" }), { queued: true });
  assert.deepEqual(await wrapper.send({ type: "prompt", message: "fast", streamingBehavior: "steer" }), { queued: true });
  // Rows in arrival order: a plain parked prompt is a steer, as the TUI parks Enter.
  assert.deepEqual((await wrapper.send({ type: "get_state" })).queuedMessages, { steering: ["slow", "fast"], followUp: [] });
  assert.equal(wrapper.isRunning(), true);

  faux.setResponses(replies(4));
  gate.release();
  await compaction;
  await settle();

  // Each delivery goes through the admission chain: "fast" never overtakes "slow".
  assert.deepEqual(sentAfterCompaction(), ["slow", "fast"]);
  assert.deepEqual(events.filter((event) => event.type === "prompt_error"), []);
  assert.ok(events.some((event) => event.type === "prompt_done"));
  assert.deepEqual((await wrapper.send({ type: "get_state" })).queuedMessages, { steering: [], followUp: [] });
});

test("Stop during a manual compaction returns the parked prompts instead of sending them", async (t) => {
  const { wrapper, faux, gate, events, compaction, sentAfterCompaction, settle } = await compactingSession(t);

  await wrapper.send({ type: "prompt", message: "parked" });
  faux.setResponses(replies(2));
  const stopped = wrapper.send({ type: "abort" });
  await tick();
  gate.release();
  assert.deepEqual(await stopped, { steering: ["parked"], followUp: [] });
  assert.match(String((await compaction)?.message), /cancelled/i);
  await settle();

  assert.deepEqual(sentAfterCompaction(), []);
  assert.equal(wrapper.isRunning(), false);
  assert.ok(events.some((event) => event.type === "prompt_done" && event.aborted === true));
});

test("Recall during the flush takes back a parked prompt still waiting for its turn", async (t) => {
  const { wrapper, faux, gate, compaction, sentAfterCompaction, settle } = await compactingSession(t);

  await wrapper.send({ type: "prompt", message: "slow" });
  await wrapper.send({ type: "prompt", message: "fast", streamingBehavior: "steer" });
  faux.setResponses(replies(4));
  gate.release();
  await compaction;
  await tick();
  // "slow" is in its input handler; "fast" waits behind it and is still a queue row.
  assert.deepEqual((await wrapper.send({ type: "get_state" })).queuedMessages, { steering: ["fast"], followUp: [] });
  assert.deepEqual(await wrapper.send({ type: "clear_queue" }), { steering: ["fast"], followUp: [] });
  await settle();

  assert.deepEqual(sentAfterCompaction(), ["slow"]);
  assert.equal(wrapper.isRunning(), false);
});

test("a refusal that lands after the compaction ended is sent, not left parked", async (t) => {
  // The SDK refuses during compaction, but the wrapper's rejection handler runs a
  // microtask later: compaction_end may have flushed already. Try every interleaving.
  for (let hops = 0; hops < 40; hops += 1) {
    const { wrapper, faux, gate, compaction, sentAfterCompaction, settle } = await compactingSession(t);
    faux.setResponses(replies(2));
    const ack = wrapper.send({ type: "prompt", message: "racer" });
    for (let i = 0; i < hops; i += 1) await Promise.resolve();
    gate.release();
    await ack;
    await compaction;
    await settle();
    assert.deepEqual(sentAfterCompaction(), ["racer"], `after ${hops} hops`);
    assert.equal(wrapper.isRunning(), false, `after ${hops} hops`);
    wrapper.destroy();
  }
});
