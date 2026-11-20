import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

// #1746: pi appends a user message to the session only after emitting its
// message_end and announces the entry id to no one, so the chat had no id for a
// prompt (or a steer) sent during the run and offered no "New session" on it
// until the run's end read the file. The wrapper names the entry right after.

const agentDir = await mkdtemp(join(tmpdir(), "pi-web-user-entry-agent-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");
test.after(() => rm(agentDir, { recursive: true, force: true }));
const tick = () => new Promise((r) => setTimeout(r, 10));

async function setup(t) {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-user-entry-cwd-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  // Each `wait` call runs until the test releases it.
  const waits = [];
  const extension = (pi) => {
    pi.registerTool({
      name: "wait", label: "wait", description: "waits", parameters: { type: "object", properties: {} },
      async execute() {
        await new Promise((resolve) => waits.push(resolve));
        return { content: [{ type: "text", text: "done" }], details: undefined };
      },
    });
  };
  const faux = fauxProvider({ models: [{ id: "faux-user-entry" }] });
  const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null, refreshOnCreate: false });
  modelRuntime.registerNativeProvider(faux.provider);
  const settingsManager = SettingsManager.inMemory({});
  const resourceLoader = new DefaultResourceLoader({ cwd, agentDir, settingsManager, extensionFactories: [extension], noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
  await resourceLoader.reload();
  const sessionManager = SessionManager.create(cwd, join(cwd, "sessions"));
  const { session } = await createAgentSession({ cwd, agentDir, modelRuntime, model: faux.getModel("faux-user-entry"), sessionManager, settingsManager, resourceLoader });
  const wrapper = new AgentSessionWrapper(session);
  t.after(() => wrapper.destroy());
  wrapper.start();
  wrapper.beginExtensionBinding();
  await wrapper.waitUntilReady();
  const events = [];
  wrapper.onEvent((event) => events.push(event));
  const waitFor = async (check) => { for (let i = 0; i < 300 && !check(); i += 1) await tick(); assert.ok(check()); };
  const settle = async () => { for (let i = 0; i < 300 && (wrapper.isRunning() || !session.isIdle); i += 1) await tick(); };
  return { session, wrapper, faux, waits, events, waitFor, settle };
}

/** The entry pi appended for a user message, by text. */
function userEntry(session, text) {
  return session.sessionManager.getBranch().find((entry) =>
    entry.type === "message" && entry.message.role === "user"
    && (typeof entry.message.content === "string" ? entry.message.content : entry.message.content[0]?.text) === text);
}

test("names the entry of each user message delivered during the run, which New session forks from mid-run", async (t) => {
  const { session, wrapper, faux, waits, events, waitFor, settle } = await setup(t);
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall("wait", {})], { stopReason: "toolUse" }),
    fauxAssistantMessage([fauxToolCall("wait", {})], { stopReason: "toolUse" }),
    fauxAssistantMessage([fauxText("reply")]),
  ]);

  await wrapper.send({ type: "prompt", message: "start" });
  await waitFor(() => waits.length === 1);
  const prompt = userEntry(session, "start");
  assert.ok(prompt);
  const promptEnd = events.findIndex((event) => event.type === "message_end" && event.message.role === "user");
  assert.deepEqual(events[promptEnd + 1], { type: "user_message_entry", entryId: prompt.id, timestamp: prompt.message.timestamp });

  // A steer, delivered at the turn boundary once the first call returns.
  await wrapper.send({ type: "prompt", message: "steer", streamingBehavior: "steer" });
  waits.shift()();
  await waitFor(() => waits.length === 1);
  const steer = userEntry(session, "steer");
  assert.ok(steer);
  const steerEnd = events.findLastIndex((event) => event.type === "message_end" && event.message.role === "user");
  assert.notEqual(steerEnd, promptEnd);
  assert.deepEqual(events[steerEnd + 1], { type: "user_message_entry", entryId: steer.id, timestamp: steer.message.timestamp });
  assert.equal(events.filter((event) => event.type === "user_message_entry").length, 2);

  // New session on the steer while the run goes on: the copy ends before it, and the source keeps running.
  assert.equal(wrapper.isRunning(), true);
  const forked = await wrapper.send({ type: "fork", entryId: steer.id });
  assert.equal(forked.cancelled, false);
  assert.equal(wrapper.isRunning(), true);
  const sessionDir = session.sessionManager.getSessionDir();
  const copyName = (await readdir(sessionDir)).find((name) => name.includes(forked.newSessionId));
  assert.ok(copyName, "the copy is in the source's session directory");
  const copied = SessionManager.open(join(sessionDir, copyName), sessionDir).getBranch()
    .filter((entry) => entry.type === "message" && entry.message.role !== "system")
    .map((entry) => entry.message.role === "user" ? `user:${entry.message.content[0]?.text ?? entry.message.content}` : entry.message.role);
  assert.deepEqual(copied, ["user:start", "assistant", "toolResult"]);

  waits.shift()();
  await settle();
  assert.equal(session.messages.at(-1).role, "assistant");
});

test("sends one entry per user message, none for the reply", async (t) => {
  const { wrapper, faux, events, settle } = await setup(t);
  faux.setResponses([fauxAssistantMessage([fauxText("reply")])]);
  await wrapper.send({ type: "prompt", message: "hello" });
  await settle();
  const types = events.map((event) => event.type);
  assert.equal(types.filter((type) => type === "user_message_entry").length, 1);
  assert.equal(types.filter((type) => type === "message_end").length >= 2, true);
});
