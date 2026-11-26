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
const { createSubagentController } = await jiti.import("./subagent-runtime.ts");

// The child's extension compacts on the first text delta of a marked prompt, as an extension
// watching context usage does, and `[compact and resume]` continues from onComplete.
// session_before_compact supplies the summary (no summarizer request) and holds briefly, so
// the aborted turn settles well before compaction_end.
const extension = `export default function (pi) {
  let action;
  pi.on("input", (event) => {
    action = event.text.includes("[compact and resume]") ? "resume"
      : event.text.includes("[compact only]") ? "compact"
      : event.text.includes("[compact cancelled]") ? "cancel" : undefined;
  });
  let cancel = false;
  pi.on("session_before_compact", async (event) => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (cancel) return { cancel: true };
    return { compaction: { summary: "summary", firstKeptEntryId: event.preparation.firstKeptEntryId, tokensBefore: 10 } };
  });
  pi.on("message_update", (event, ctx) => {
    if (!action || event.assistantMessageEvent.type !== "text_delta") return;
    const resume = action === "resume";
    cancel = action === "cancel";
    action = undefined;
    ctx.compact({ onComplete: () => {
      if (resume) pi.sendUserMessage("Reply with the single word CONTINUED.");
    } });
  });
}
`;

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-subagent-compaction-"));
  const previousDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  const sessions = new Map();
  t.after(async () => {
    for (const wrapper of [...sessions.values()].reverse()) {
      if (wrapper.isAlive()) await wrapper.shutdown();
    }
    if (previousDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousDir;
    await rm(dir, { recursive: true, force: true });
  });
  await mkdir(join(dir, "agents"));
  await mkdir(join(dir, "extensions"));
  await writeFile(join(dir, "agents", "fixture.md"), [
    "---", "description: Manual compaction fixture.", "tools: read", "extensions: [compact]",
    "load_skills: false", "codemode: off", "---", "Complete the task without calling tools.",
  ].join("\n"));
  await writeFile(join(dir, "extensions", "compact.ts"), extension);
  await writeFile(join(dir, "settings.json"), JSON.stringify({ compaction: { enabled: false, keepRecentTokens: 1 } }));
  // Slow enough that a Stop or ctx.compact() lands mid-stream.
  const faux = fauxProvider({ models: [{ id: "faux-manual-compaction" }], tokensPerSecond: 200 });
  const modelRuntime = await ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: null, refreshOnCreate: false });
  modelRuntime.registerNativeProvider(faux.provider);
  const services = await createAgentSessionServices({
    cwd: dir, agentDir: dir, modelRuntime, settingsManager: SettingsManager.inMemory(),
    resourceLoaderOptions: { noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true },
  });
  const { session: parent } = await createAgentSessionFromServices({
    services, sessionManager: SessionManager.create(dir, join(dir, "sessions")), model: faux.getModel("faux-manual-compaction"),
  });
  const registerSession = (inner, options) => {
    const wrapper = new AgentSessionWrapper(inner, options);
    sessions.set(inner.sessionId, wrapper);
    wrapper.start();
    wrapper.beginExtensionBinding();
    return wrapper;
  };
  registerSession(parent);
  const controller = createSubagentController({
    getSession: (id) => sessions.get(id), registerSession,
    resolveSessionPath: async (id) => sessions.get(id)?.sessionFile ?? null,
    reopenSession: async () => { throw new Error("The fixture keeps its sessions open"); },
    invalidateSessionList() {}, isBuiltInSubagentsEnabled: () => true,
  });
  const runtime = controller.extensionRuntime;
  const request = { parentContext: parent, parentToolCallId: "start", profile: "fixture", description: "Compaction fixture", runInBackground: true };
  faux.setResponses([fauxAssistantMessage([fauxText("READY")])]);
  const initial = await (await runtime.start({ ...request, task: "Reply with the single word READY." })).completion;
  assert.equal(initial.status, "completed", initial.error);
  const child = sessions.get(initial.sessionId);
  const events = [];
  child.onEvent((event) => {
    if (event.type === "agent_settled") events.push([event.type, event.aborted]);
    if (event.type === "compaction_start") events.push([event.type, event.reason]);
    if (event.type === "compaction_end") events.push([event.type, event.aborted]);
    if (event.type === "prompt_done") events.push([event.type, event.aborted === true]);
  });
  // The long reply is cut off by the compaction or a Stop; the next ones answer what follows.
  faux.setResponses([
    fauxAssistantMessage([fauxText("color ".repeat(400))]),
    fauxAssistantMessage([fauxText("CONTINUED")]),
    fauxAssistantMessage([fauxText("parked reply")]),
  ]);
  const resume = (task) => runtime.resume({ ...request, sessionId: child.sessionId, parentToolCallId: "resume", task });
  const reports = () => parent.sessionManager.getEntries().filter((entry) => entry.customType === "pi-web:subagent-notification");
  const settle = async () => {
    for (let i = 0; i < 300 && child.isRunning(); i += 1) await tick();
  };
  return { runtime, controller, child, events, resume, reports, settle };
}

const onFirstDelta = (child, action) => new Promise((resolve) => {
  const off = child.onEvent((event) => {
    if (event.type !== "message_update" || event.assistantMessageEvent?.type !== "text_delta") return;
    off();
    resolve(action());
  });
});

test("real SDK: a background report waits for the turn started by ctx.compact onComplete", async (t) => {
  const { runtime, child, events, resume, reports } = await fixture(t);
  let statusDuringCompaction;
  const off = child.onEvent((event) => {
    if (event.type === "compaction_start") statusDuringCompaction = runtime.get(child.sessionId);
  });
  const result = await (await resume("[compact and resume] Write a long list of colors.")).completion;
  off();
  assert.deepEqual(events, [
    ["agent_settled", true], ["compaction_start", "manual"], ["compaction_end", false], ["agent_settled", false],
  ]);
  assert.equal((await statusDuringCompaction).status, "running");
  assert.equal(result.status, "completed", result.error);
  assert.match(result.result, /CONTINUED/);
  await runtime.notifyParent(result);
  assert.equal(reports().length, 1);
  assert.doesNotMatch(reports()[0].content, /was stopped\./);
});

for (const [marker, title, compactionAborted] of [
  ["[compact only]", "a compaction with no continuation still reports the stop", false],
  ["[compact cancelled]", "a cancelled compaction still reports the stop", true],
]) {
  test(`real SDK: ${title}`, async (t) => {
    const { runtime, events, resume, reports } = await fixture(t);
    const result = await (await resume(`${marker} Write a long list of colors.`)).completion;
    assert.deepEqual(events, [["agent_settled", true], ["compaction_start", "manual"], ["compaction_end", compactionAborted]]);
    assert.equal(result.status, "aborted");
    await runtime.notifyParent(result);
    assert.match(reports()[0].content, /was stopped\./);
  });
}

for (const [who, stop] of [
  ["Stop in the child chat", ({ child }) => child.send({ type: "abort" })],
  ["abortSubagent", ({ controller, child }) => controller.abort(child.sessionId)],
]) {
  test(`real SDK: ${who} still reports the stop`, async (t) => {
    const context = await fixture(t);
    const stopped = onFirstDelta(context.child, () => stop(context));
    const result = await (await context.resume("Write a long list of colors.")).completion;
    await stopped;
    assert.equal(result.status, "aborted");
    assert.deepEqual(context.events, [["agent_settled", true]]);
  });

  test(`real SDK: ${who} during the compaction ends the run without the continuation`, async (t) => {
    const context = await fixture(t);
    let stopped;
    const off = context.child.onEvent((event) => {
      if (event.type === "compaction_start") stopped = stop(context);
    });
    const result = await (await context.resume("[compact and resume] Write a long list of colors.")).completion;
    off();
    await stopped;
    assert.equal(result.status, "aborted");
    assert.deepEqual(context.events, [["agent_settled", true], ["compaction_start", "manual"], ["compaction_end", true]]);
  });
}

test("real SDK: prompt_done waits for the turn started by ctx.compact onComplete", async (t) => {
  const { child, events, settle } = await fixture(t);
  await child.send({ type: "prompt", message: "[compact and resume] Write a long list of colors." });
  for (let i = 0; i < 300 && !events.some(([type]) => type === "prompt_done"); i += 1) await tick();
  await settle();
  assert.deepEqual(events, [
    ["agent_settled", true], ["compaction_start", "manual"], ["compaction_end", false],
    ["agent_settled", false], ["prompt_done", false],
  ]);
});

test("real SDK: the compact command reports the stopped prompt at once and a parked prompt its own run", async (t) => {
  const { child, events, settle } = await fixture(t);
  let parked;
  const off = child.onEvent((event) => {
    if (event.type === "compaction_start") parked = child.send({ type: "prompt", message: "parked" });
  });
  const compacted = onFirstDelta(child, () => child.send({ type: "compact" }));
  await child.send({ type: "prompt", message: "Write a long list of colors." });
  await compacted;
  assert.deepEqual(await parked, { queued: true });
  off();
  await settle();
  // The stopped prompt's prompt_done must not arrive inside the parked prompt's run as a
  // finished one: the page would complete that run's stage and chime while it streams.
  assert.deepEqual(events, [
    ["agent_settled", true], ["compaction_start", "manual"], ["prompt_done", true],
    ["compaction_end", false], ["agent_settled", false], ["prompt_done", false],
  ]);
});
