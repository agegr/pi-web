import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { createAgentSessionFromServices, createAgentSessionServices, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const FIXTURE = fileURLToPath(new URL("./__fixtures__/mcp-env-server.mjs", import.meta.url));
const HANG_FIXTURE = fileURLToPath(new URL("./__fixtures__/mcp-hang-server.mjs", import.meta.url));

// Another extension's tool named like an MCP tool, which `ext:alpha` leaves out.
const BETA_EXTENSION = `export default function (pi) {
  pi.registerTool({ name: "mcp__beta__write", label: "x", description: "x", parameters: { type: "object", properties: {} },
    execute: async () => ({ content: [{ type: "text", text: "beta wrote" }] }) });
}
`;

const PROFILES = {
  // Write-capable built-ins: MCP tools run whatever their annotations say.
  worker: "tools: read, bash\nmcp: on",
  // Read-only built-ins, as Explore and Plan have.
  explorer: "tools: read, grep, find, ls\nmcp: on",
  scripted: "tools: read, bash\nmcp: on\ncodemode: on",
  selected: "tools: read, bash, ext:alpha\nmcp: on",
  plain: "tools: read, bash",
  chat: "tools: none\nmcp: on",
};

async function setup(t, servers) {
  const dir = await mkdtemp(join(tmpdir(), "subagent-mcp-"));
  // t.after hooks run in the order they were added, which would remove the
  // folder while the sessions and their MCP children still run in it (EBUSY
  // on Windows). Cleanups run last added first: the folder goes last, with
  // retries while the stopped children exit.
  const cleanups = [];
  const cleanup = (fn) => cleanups.push(fn);
  t.after(async () => {
    for (const fn of cleanups.reverse()) await fn();
  });
  cleanup(() => rm(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 }));
  const previousDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  cleanup(() => { if (previousDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previousDir; });
  await writeFile(join(dir, "mcp.json"), JSON.stringify({ mcpServers: servers }));
  await mkdir(join(dir, "extensions"), { recursive: true });
  await writeFile(join(dir, "extensions", "alpha.ts"), "export default function () {}\n");
  await writeFile(join(dir, "extensions", "beta.ts"), BETA_EXTENSION);
  await mkdir(join(dir, ".pi", "agents"), { recursive: true });
  for (const [name, frontmatter] of Object.entries(PROFILES)) {
    await writeFile(join(dir, ".pi", "agents", `${name}.md`), `---\ndescription: ${name}\n${frontmatter}\n---\nCHILD\n`);
  }

  const faux = fauxProvider({ models: [{ id: "faux-model" }] });
  const modelRuntime = await ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: null, refreshOnCreate: false });
  modelRuntime.registerNativeProvider(faux.provider);
  const services = await createAgentSessionServices({ cwd: dir, agentDir: dir, modelRuntime, settingsManager: SettingsManager.inMemory(),
    resourceLoaderOptions: { noExtensions: true, noSkills: true, noThemes: true, noPromptTemplates: true, noContextFiles: true } });
  const { session: parentSession } = await createAgentSessionFromServices({ services, sessionManager: SessionManager.inMemory(dir), model: faux.getModel("faux-model") });
  cleanup(() => parentSession.dispose());

  const jiti = createJiti(import.meta.url);
  const { createSubagentController } = await jiti.import("./subagent-runtime.ts");
  const { AgentSessionWrapper, startRpcSession } = await jiti.import("./rpc-manager.ts");
  const parentId = parentSession.sessionId;
  const parent = { inner: parentSession, cwd: dir, sessionFile: join(dir, "parent.jsonl"), isAlive: () => true, isRunning: () => false };
  const wrappers = new Map();
  const track = (wrapper) => {
    wrappers.set(wrapper.sessionId, wrapper);
    cleanup(async () => { if (wrapper.isAlive()) await wrapper.shutdown(); });
    return wrapper;
  };
  const controller = createSubagentController({
    getSession: (id) => id === parentId ? parent : wrappers.get(id),
    registerSession(inner, options) {
      const wrapper = track(new AgentSessionWrapper(inner, options));
      wrapper.start(); wrapper.beginExtensionBinding();
      return wrapper;
    },
    reopenSession: async (id, file) => track((await startRpcSession(id, file)).session),
    resolveSessionPath: async (id) => wrappers.get(id)?.sessionFile ?? null,
    invalidateSessionList() {}, isBuiltInSubagentsEnabled: () => true,
  });

  const start = (profile, signal) => controller.extensionRuntime.start({
    parentContext: parentSession, parentToolCallId: `start-${profile}`, profile, task: "work", description: profile,
    ...(signal ? { signal } : {}),
  });
  return { faux, controller, wrappers, parentSession, start };
}

function toolResult(wrapper, name) {
  return wrapper.inner.agent.state.messages.findLast((message) => message.role === "toolResult" && message.toolName === name);
}

function textOf(message) {
  return message.content.map((block) => block.text ?? "").join("");
}

const fixtureServer = (exposure) => ({ command: process.execPath, args: [FIXTURE], ...(exposure ? { exposure } : {}) });

test("a child with mcp: on connects mcp.json servers before its run and calls their tools", async (t) => {
  const { faux, wrappers, start } = await setup(t, { fix: fixtureServer("direct") });
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall("mcp__fix__record", { note: "from child" })], { stopReason: "toolUse" }),
    fauxAssistantMessage([fauxText("done")]),
  ]);
  const execution = await start("worker");
  assert.equal((await execution.completion).status, "completed");
  const child = wrappers.get(execution.run.sessionId);
  const result = toolResult(child, "mcp__fix__record");
  assert.equal(result.isError, false);
  assert.match(textOf(result), /"recorded":"from child"/);
  assert.ok(child.inner.getActiveToolNames().includes("mcp__fix__record"));
});

test("a child with read-only tools runs only MCP tools marked readOnlyHint", async (t) => {
  const { faux, wrappers, start } = await setup(t, { fix: fixtureServer("direct") });
  faux.setResponses([
    fauxAssistantMessage([
      fauxToolCall("mcp__fix__record", { note: "change" }, { id: "call-record" }),
      fauxToolCall("mcp__fix__env_has", { name: "PATH" }, { id: "call-env" }),
    ], { stopReason: "toolUse" }),
    fauxAssistantMessage([fauxText("done")]),
  ]);
  const execution = await start("explorer");
  assert.equal((await execution.completion).status, "completed");
  const child = wrappers.get(execution.run.sessionId);
  const record = toolResult(child, "mcp__fix__record");
  assert.equal(record.isError, true);
  assert.match(textOf(record), /read-only tools, and the MCP server does not mark "mcp__fix__record" as read-only/);
  const envHas = toolResult(child, "mcp__fix__env_has");
  assert.equal(envHas.isError, false);
  assert.match(textOf(envHas), /"has":true/);
});

test("without Code mode, a child loads codemode-exposed MCP tools through tool_search", async (t) => {
  const { faux, wrappers, start } = await setup(t, { scripted: fixtureServer() });
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall("tool_search", { query: "record note" })], { stopReason: "toolUse" }),
    fauxAssistantMessage([fauxToolCall("mcp__scripted__record", { note: "found" })], { stopReason: "toolUse" }),
    fauxAssistantMessage([fauxText("done")]),
  ]);
  const execution = await start("worker");
  assert.equal((await execution.completion).status, "completed");
  const child = wrappers.get(execution.run.sessionId);
  assert.equal(toolResult(child, "tool_search").isError, false);
  const result = toolResult(child, "mcp__scripted__record");
  assert.equal(result.isError, false);
  assert.match(textOf(result), /"recorded":"found"/);
  assert.equal(child.inner.getAllTools().some((candidate) => candidate.name === "codemode"), false);
});

test("a child with Code mode calls codemode-exposed MCP tools from a script", async (t) => {
  const { faux, wrappers, start } = await setup(t, { scripted: fixtureServer() });
  const code = "console.log(JSON.stringify(await tools.mcp__scripted__record({ note: \"scripted\" })));";
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall("codemode", { code })], { stopReason: "toolUse" }),
    fauxAssistantMessage([fauxText("done")]),
  ]);
  const execution = await start("scripted");
  assert.equal((await execution.completion).status, "completed");
  const child = wrappers.get(execution.run.sessionId);
  assert.match(textOf(toolResult(child, "codemode")), /"recorded":"scripted"/);
  // Scripts reach these servers, so tool_search stays out of the child's requests.
  assert.equal(child.inner.getActiveToolNames().includes("tool_search"), false);
});

test("ext: selectors with mcp: on keep another extension's MCP-named tools out", async (t) => {
  const { faux, wrappers, start } = await setup(t, { fix: fixtureServer("direct") });
  faux.setResponses([
    fauxAssistantMessage([
      fauxToolCall("mcp__beta__write", {}, { id: "call-beta" }),
      fauxToolCall("mcp__fix__record", { note: "kept" }, { id: "call-fix" }),
    ], { stopReason: "toolUse" }),
    fauxAssistantMessage([fauxText("done")]),
  ]);
  const execution = await start("selected");
  assert.equal((await execution.completion).status, "completed");
  const child = wrappers.get(execution.run.sessionId);
  const beta = toolResult(child, "mcp__beta__write");
  assert.equal(beta.isError, true);
  assert.match(textOf(beta), /from an extension this subagent's profile did not select/);
  assert.equal(toolResult(child, "mcp__fix__record").isError, false);
});

test("a profile without mcp: on connects nothing", async (t) => {
  const { faux, wrappers, start } = await setup(t, { fix: fixtureServer("direct") });
  faux.setResponses([fauxAssistantMessage([fauxText("done")])]);
  const execution = await start("plain");
  assert.equal((await execution.completion).status, "completed");
  const child = wrappers.get(execution.run.sessionId);
  assert.equal(child.inner.getAllTools().some((candidate) => candidate.name.startsWith("mcp__") || candidate.name === "tool_search"), false);
});

test("a chat-only profile rejects mcp: on", async (t) => {
  const { start } = await setup(t, { fix: fixtureServer("direct") });
  await assert.rejects(start("chat"), /MCP cannot be enabled for a chat-only subagent profile/);
});

test("resume after the child closed reopens it with its MCP servers", async (t) => {
  const { faux, controller, wrappers, parentSession, start } = await setup(t, { fix: fixtureServer("direct") });
  faux.setResponses([fauxAssistantMessage([fauxText("first")])]);
  const execution = await start("explorer");
  assert.equal((await execution.completion).status, "completed");
  const childId = execution.run.sessionId;
  await wrappers.get(childId).shutdown();
  // Reopening builds the child from its snapshot. Only provider construction is replaced.
  const originalCreate = ModelRuntime.create;
  ModelRuntime.create = async (...args) => {
    const runtime = await originalCreate.apply(ModelRuntime, args);
    runtime.registerNativeProvider(faux.provider);
    return runtime;
  };
  t.after(() => { ModelRuntime.create = originalCreate; });

  faux.setResponses([
    fauxAssistantMessage([
      fauxToolCall("mcp__fix__record", { note: "change" }, { id: "call-record" }),
      fauxToolCall("mcp__fix__env_has", { name: "PATH" }, { id: "call-env" }),
    ], { stopReason: "toolUse" }),
    fauxAssistantMessage([fauxText("again")]),
  ]);
  const resumed = await controller.extensionRuntime.resume({
    parentContext: parentSession, parentToolCallId: "resume", sessionId: childId, task: "more", description: "more",
  });
  assert.equal((await resumed.completion).status, "completed");
  const reopened = wrappers.get(childId);
  assert.equal(toolResult(reopened, "mcp__fix__env_has").isError, false);
  // The read-only scope comes back from the snapshot, not from the profile file.
  assert.match(textOf(toolResult(reopened, "mcp__fix__record")), /does not mark "mcp__fix__record" as read-only/);
});

// The wait for servers with `direct` tools lasts up to 10 s; a server that never answers holds it.
const STOPS = {
  "abortSubagent": ({ controller, childId }) => controller.abort(childId),
  "Stop in the child's own chat": ({ wrappers, childId }) => wrappers.get(childId).send({ type: "abort" }),
  "the parent's Stop": ({ parentStop }) => parentStop.abort(),
};
for (const [label, stop] of Object.entries(STOPS)) {
  test(`${label} while a child's MCP servers connect aborts the run before it starts`, async (t) => {
    const { faux, controller, wrappers, start } = await setup(t, { hang: { command: process.execPath, args: [HANG_FIXTURE], exposure: "direct" } });
    faux.setResponses([fauxAssistantMessage([fauxText("should not run")])]);
    const parentStop = new AbortController();
    const execution = await start("worker", parentStop.signal);
    const childId = execution.run.sessionId;
    const deadline = Date.now() + 5_000;
    while ((await controller.get(childId))?.status !== "running") {
      if (Date.now() > deadline) throw new Error("the run never started");
      await new Promise((resolve) => { setTimeout(resolve, 20); });
    }
    const stoppedAt = Date.now();
    await stop({ controller, wrappers, childId, parentStop });
    const run = await execution.completion;
    assert.equal(run.status, "aborted");
    assert.equal(run.error, undefined);
    assert.ok(Date.now() - stoppedAt < 5_000, "the wait ended well before its 10 s limit");
    assert.equal(faux.state.callCount, 0);
  });
}
