import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import {
  createAgentSessionFromServices, createAgentSessionServices, ModelRuntime, SessionManager, SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");
const { createSubagentController, hasUnsettledSubagentRun } = await jiti.import("./subagent-runtime.ts");
const { createSubagentExtension, SUBAGENT_NOTIFICATION_PREFIX } = await jiti.import("./subagent-extension.ts");
const answer = (text) => fauxAssistantMessage([fauxText(text)]);
const callTool = (name, args) => fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" });
const tick = () => new Promise((resolve) => setImmediate(resolve));

async function until(check) {
  const deadline = Date.now() + 5_000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for fixture phase");
    await tick();
  }
}

const textOf = (message) => typeof message.content === "string"
  ? message.content
  : message.content.map((block) => block.text ?? "").join("");
/** A subagent report as the model sees it: pi replays the custom message as a user turn. */
const isReport = (message) => message.role === "user" && textOf(message).startsWith(SUBAGENT_NOTIFICATION_PREFIX);
const isChildRequest = (context) => context.messages.some((message) => message.role === "user" && textOf(message).includes("Return a report."));
const reportEntries = (session) => session.sessionManager.getEntries()
  .filter((entry) => entry.type === "custom_message" && entry.customType === "pi-web:subagent-notification");

/**
 * A main session (real AgentSession behind pi-web's wrapper) that loads the subagent tools and a
 * `hold` tool that runs until the test releases it, plus a controller whose children are real
 * sessions on the same faux provider.
 */
async function familyFixture(t) {
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
  let controller;
  const runtime = new Proxy({}, { get: (_target, name) => (...args) => controller.extensionRuntime[name](...args) });
  const hold = { entered: Promise.withResolvers(), release: Promise.withResolvers() };
  t.after(() => hold.release.resolve());
  const holdTool = (pi) => {
    pi.registerTool({
      name: "hold",
      label: "hold",
      description: "Run until the test releases it.",
      parameters: Type.Object({}),
      async execute() {
        hold.entered.resolve();
        await hold.release.promise;
        return { content: [{ type: "text", text: "held" }], details: undefined };
      },
    });
  };
  const services = await createAgentSessionServices({
    cwd: dir, agentDir: dir, modelRuntime, settingsManager: SettingsManager.inMemory(),
    resourceLoaderOptions: {
      noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
      extensionFactories: [createSubagentExtension(runtime, () => []), holdTool],
    },
  });
  const { session: parent } = await createAgentSessionFromServices({
    services, sessionManager: SessionManager.create(dir, join(dir, "sessions")), model: faux.getModel("family-fixture"),
  });
  const pushed = [];
  const root = new AgentSessionWrapper(parent, { onAgentRunComplete: (id) => pushed.push(id) });
  sessions.set(parent.sessionId, root);
  root.start();
  const ends = [];
  const queued = [];
  root.onEvent((event) => {
    if (event.type === "agent_settled" || event.type === "prompt_done") ends.push(event);
    if (event.type === "queue_update") queued.push(...event.steering, ...event.followUp);
  });
  controller = createSubagentController({
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
  /** A background child the way the `Agent` tool starts one, its report sent to the parent. */
  const startChild = async () => {
    const execution = await controller.extensionRuntime.start({
      parentContext: { sessionManager: parent.sessionManager }, parentToolCallId: "fixture-call",
      profile: "fixture", task: "Return a report.", description: "Background fixture", runInBackground: true,
    });
    const notification = execution.completion.then((run) => controller.extensionRuntime.notifyParent(run));
    return { execution, notification };
  };
  return { faux, parent, root, controller, ends, pushed, queued, hold, startChild };
}

test("real SDK: a main session announces its task once, after the run its last subagent report starts (#1434)", { timeout: 20_000 }, async (t) => {
  const { faux, parent, root, controller, ends, pushed } = await familyFixture(t);
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

/** Let a pending notification reach the parent wrapper and subscribe to its run. */
async function settle() {
  for (let i = 0; i < 20; i += 1) await tick();
}

test("real SDK: a report that arrives during a tool call reaches the parent's next model call in the same run (#1727)", { timeout: 20_000 }, async (t) => {
  const { faux, parent, root, ends, pushed, queued, hold, startChild } = await familyFixture(t);
  const parentRequests = [];
  faux.setResponses(Array.from({ length: 6 }, () => (context) => {
    if (isChildRequest(context)) return answer("Child report.");
    parentRequests.push(context);
    return parentRequests.length === 1 ? callTool("hold", {}) : answer("Synthesis with the report.");
  }));
  await root.send({ type: "prompt", message: "Work on something while a subagent runs." });
  await hold.entered.promise;
  const { execution, notification } = await startChild();
  await execution.completion;
  await settle();
  assert.equal(root.isRunning(), true, "the child finished while the parent's tool still runs");

  hold.release.resolve();
  await notification;
  await until(() => !root.isRunning());

  assert.equal(parentRequests.length, 2, "one run: no turn of its own for the report");
  const roles = parentRequests[1].messages.slice(-2).map((message) => (isReport(message) ? "report" : message.role));
  assert.deepEqual(roles, ["toolResult", "report"], "the request after the tool batch carries the report");
  assert.equal(reportEntries(parent).length, 1);
  assert.equal(parent.getLastAssistantText(), "Synthesis with the report.");
  assert.deepEqual(queued, [], "a queued report is no composer row");
  assert.deepEqual(ends.map((event) => event.type), ["agent_settled", "prompt_done"]);
  assert.deepEqual(pushed, [root.sessionId], "the run that took the report announces the task once");
});

test("real SDK: a report the parent is collecting with get_subagent_result is not steered in as well (#1727)", { timeout: 20_000 }, async (t) => {
  const { faux, parent, root, ends, startChild } = await familyFixture(t);
  const childGate = Promise.withResolvers();
  t.after(() => childGate.resolve());
  let childId;
  const parentRequests = [];
  faux.setResponses(Array.from({ length: 6 }, () => async (context) => {
    if (isChildRequest(context)) {
      await childGate.promise;
      return answer("Child report.");
    }
    parentRequests.push(context);
    return parentRequests.length === 1
      ? callTool("get_subagent_result", { agent_id: childId, wait: true })
      : answer("Collected.");
  }));
  const { execution, notification } = await startChild();
  childId = execution.run.sessionId;
  let waiting = false;
  const unsubscribe = parent.subscribe((event) => {
    if (event.type === "tool_execution_start" && event.toolName === "get_subagent_result") waiting = true;
  });
  t.after(unsubscribe);
  await root.send({ type: "prompt", message: "Wait for the subagent's report." });
  await until(() => waiting);

  // The child finishes while the parent polls for it.
  childGate.resolve();
  await notification;
  await until(() => !root.isRunning());

  assert.equal(parentRequests.length, 2);
  const last = parentRequests[1].messages.at(-1);
  assert.equal(last.role, "toolResult");
  assert.match(textOf(last), /Child report\./);
  assert.equal(parentRequests[1].messages.filter(isReport).length, 0, "the tool result is the report");
  assert.equal(reportEntries(parent).length, 0);
  assert.deepEqual(ends.map((event) => event.type), ["agent_settled", "prompt_done"]);
});

test("real SDK: a report Stop clears from pi's steering queue still reaches the parent, in a run of its own (#1727)", { timeout: 20_000 }, async (t) => {
  const { faux, parent, root, queued, hold, startChild } = await familyFixture(t);
  const parentRequests = [];
  faux.setResponses(Array.from({ length: 6 }, () => (context) => {
    if (isChildRequest(context)) return answer("Child report.");
    parentRequests.push(context);
    if (parentRequests.length === 1) return callTool("hold", {});
    return answer(context.messages.some(isReport) ? "Read the report after Stop." : "Stopped.");
  }));
  await root.send({ type: "prompt", message: "Work on something while a subagent runs." });
  await hold.entered.promise;
  const { execution, notification } = await startChild();
  await execution.completion;
  await settle();

  // Stop right after the report was queued at the turn boundary, before pi took it: the
  // wrapper's Stop clears pi's queues, then aborts.
  let stop;
  const unsubscribe = parent.subscribe((event) => {
    if (event.type !== "turn_end" || stop) return;
    stop = { reportQueued: parent.agent.hasQueuedMessages(), cleared: parent.clearQueue(), aborted: parent.abort() };
  });
  t.after(unsubscribe);
  hold.release.resolve();
  await notification;
  await stop.aborted;
  await until(() => !root.isRunning());

  assert.equal(stop.reportQueued, true, "Stop came with the report queued as a steer");
  assert.deepEqual(stop.cleared, { steering: [], followUp: [] }, "nothing for the composer to recall");
  assert.deepEqual(queued, []);
  const reportRequests = parentRequests.filter((context) => context.messages.some(isReport));
  assert.equal(reportRequests.length, 1, "delivered once, after Stop");
  assert.equal(reportEntries(parent).length, 1);
  assert.equal(parent.getLastAssistantText(), "Read the report after Stop.");
});
