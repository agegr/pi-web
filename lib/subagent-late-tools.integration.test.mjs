import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall, getCurrentTools } from "@earendil-works/pi-ai";
import { createAgentSessionFromServices, createAgentSessionServices, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

// Registers its tool at session_start, as pi's examples/extensions/dynamic-tools.ts does, and
// tries to switch on `write`, which the profiles leave out.
const LATE_EXTENSION = `export default function (pi) {
  pi.on("session_start", () => {
    pi.registerTool({ name: "late_tool", label: "late", description: "late", parameters: { type: "object", properties: {} },
      execute: async () => ({ content: [{ type: "text", text: "LATE_OK" }] }) });
    pi.setActiveTools([...pi.getActiveTools(), "write"]);
  });
}
`;

async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), "subagent-late-tools-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const previousDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  t.after(() => { if (previousDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previousDir; });
  await mkdir(join(dir, "extensions"), { recursive: true });
  await writeFile(join(dir, "extensions", "late.ts"), LATE_EXTENSION);
  await writeFile(join(dir, "extensions", "other.ts"), "export default function () {}\n");
  await mkdir(join(dir, ".pi", "agents"), { recursive: true });
  await writeFile(join(dir, ".pi", "agents", "all.md"), "---\ndescription: All\ntools: read\nload_extensions: true\n---\nCHILD\n");
  await writeFile(join(dir, ".pi", "agents", "scoped.md"), "---\ndescription: Scoped\ntools: read\nextensions: [late]\n---\nCHILD\n");
  await writeFile(join(dir, ".pi", "agents", "selected.md"), "---\ndescription: Selected\ntools: read, ext:other\n---\nCHILD\n");

  const faux = fauxProvider({ models: [{ id: "faux-model" }] });
  const modelRuntime = await ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: null, refreshOnCreate: false });
  modelRuntime.registerNativeProvider(faux.provider);
  const services = await createAgentSessionServices({ cwd: dir, agentDir: dir, modelRuntime, settingsManager: SettingsManager.inMemory(),
    resourceLoaderOptions: { noExtensions: true, noSkills: true, noThemes: true, noPromptTemplates: true, noContextFiles: true } });
  const { session: parentSession } = await createAgentSessionFromServices({ services, sessionManager: SessionManager.inMemory(dir), model: faux.getModel("faux-model") });
  t.after(() => parentSession.dispose());

  const jiti = createJiti(import.meta.url);
  const { createSubagentController } = await jiti.import("./subagent-runtime.ts");
  const { readSubagentSessionResources } = await jiti.import("./subagents.ts");
  const { AgentSessionWrapper, startRpcSession } = await jiti.import("./rpc-manager.ts");
  const parentId = parentSession.sessionId;
  const wrappers = new Map();
  const parent = { inner: parentSession, cwd: dir, sessionFile: join(dir, "parent.jsonl"), isAlive: () => true, isRunning: () => false };
  const state = { child: undefined };
  const controller = createSubagentController({
    getSession: (id) => id === parentId ? parent : wrappers.get(id),
    registerSession(inner, options) {
      state.child = new AgentSessionWrapper(inner, options);
      state.child.start(); state.child.beginExtensionBinding(); wrappers.set(inner.sessionId, state.child);
    },
    reopenSession: async () => { throw new Error("unused"); }, resolveSessionPath: async () => state.child.sessionFile,
    invalidateSessionList() {}, isBuiltInSubagentsEnabled: () => true,
  });
  t.after(async () => { if (state.child?.isAlive()) await state.child.shutdown(); });

  // The model calls `late_tool`; returns what it was declared and what the call answered.
  let calls = 0;
  const callLateTool = async (run) => {
    const id = `call-${++calls}`;
    let declared;
    faux.setResponses([
      (context) => {
        declared = getCurrentTools(context.messages).map((tool) => tool.name);
        return fauxAssistantMessage(fauxToolCall("late_tool", {}, { id }), { stopReason: "toolUse" });
      },
      fauxAssistantMessage([fauxText("done")]),
    ]);
    await run();
    const result = state.child.inner.sessionManager.getEntries()
      .find((entry) => entry.type === "message" && entry.message.role === "toolResult" && entry.message.toolCallId === id).message;
    return { declared, text: result.content.map((block) => block.text).join("") };
  };
  const spawn = (profile) => callLateTool(async () => {
    const execution = await controller.extensionRuntime.start({ parentContext: parentSession, parentToolCallId: "start", profile, task: "work", description: "work" });
    assert.equal((await execution.completion).status, "completed");
  });
  return { faux, state, callLateTool, spawn, readSubagentSessionResources, startRpcSession };
}

test("a child loading extensions without selectors can call a tool registered at session_start (#883)", async (t) => {
  const { faux, state, callLateTool, spawn, readSubagentSessionResources, startRpcSession } = await setup(t);
  const assertLateTool = ({ declared, text }) => {
    assert.ok(declared.includes("late_tool"));
    assert.equal(text, "LATE_OK");
    // The profile's built-ins are the only ones registered, so an extension cannot switch `write`
    // on. Read by source, so a built-in a later SDK adds outside `SDK_BUILTIN_TOOLS` shows up here.
    const builtins = state.child.inner.getAllTools().filter((tool) => tool.sourceInfo.source === "builtin");
    assert.deepEqual(builtins.map((tool) => tool.name), ["read"]);
    assert.ok(!state.child.inner.getActiveToolNames().includes("write"));
  };

  assertLateTool(await spawn("all"));
  assert.equal(readSubagentSessionResources(state.child.inner.sessionManager.getEntries()).allExtensionTools, true);

  await state.child.send({ type: "reload" });
  assertLateTool(await callLateTool(() => state.child.inner.prompt("again")));

  // Reopening builds the same tool options from the snapshot. Only provider construction is replaced.
  const id = state.child.inner.sessionId, file = state.child.sessionFile;
  await state.child.shutdown();
  const originalCreate = ModelRuntime.create;
  ModelRuntime.create = async (...args) => {
    const runtime = await originalCreate.apply(ModelRuntime, args);
    runtime.registerNativeProvider(faux.provider);
    return runtime;
  };
  t.after(() => { ModelRuntime.create = originalCreate; });
  state.child = (await startRpcSession(id, file)).session;
  await state.child.waitUntilReady();
  assertLateTool(await callLateTool(() => state.child.inner.prompt("reopened")));
});

test("an extensions: list without selectors admits its extensions' late tools too", async (t) => {
  const { spawn } = await setup(t);
  const { declared, text } = await spawn("scoped");
  assert.ok(declared.includes("late_tool"));
  assert.equal(text, "LATE_OK");
});

test("`ext:` selectors still admit only the tools they name", async (t) => {
  const { state, spawn, readSubagentSessionResources } = await setup(t);
  const { declared, text } = await spawn("selected");
  assert.ok(!declared.includes("late_tool"));
  assert.match(text, /not found/);
  assert.equal(readSubagentSessionResources(state.child.inner.sessionManager.getEntries()).allExtensionTools, undefined);
});
