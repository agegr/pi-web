import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

// The MCP extension keeps its log and OAuth store in the agent directory.
const agentDir = await mkdtemp(join(tmpdir(), "pi-web-read-only-mcp-agent-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
test.after(() => rm(agentDir, { recursive: true, force: true }));

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");
const { createPiWebBuiltinExtensions } = await jiti.import("./builtin-extensions.ts");
const { createReadOnlyMcpPolicyExtension } = await jiti.import("./mcp-read-only-policy.ts");
const { appendSessionToolSelection } = await jiti.import("./session-tool-selection.ts");

const FIXTURE = fileURLToPath(new URL("./__fixtures__/mcp-env-server.mjs", import.meta.url));
const READ_ONLY = ["read", "grep", "find", "ls"];
const BLOCKED = /read-only tool selection, and the MCP server does not mark "mcp__(direct|scripted)__record" as read-only/;

// `direct` declares its tools to the model; `scripted` leaves them to codemode scripts.
const registerFixtureServers = {
  name: "registers-fixture-servers",
  factory: (pi) => {
    pi.registerMcpServer("direct", { command: process.execPath, args: [FIXTURE], exposure: "direct" });
    pi.registerMcpServer("scripted", { command: process.execPath, args: [FIXTURE] });
  },
};

async function waitFor(condition, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("timed out");
    await delay(20);
  }
}

async function startSession(t, selection) {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-read-only-mcp-cwd-"));
  const faux = fauxProvider({ models: [{ id: "faux-read-only" }] });
  const modelRuntime = await ModelRuntime.create({
    authPath: join(agentDir, "auth.json"),
    modelsPath: null,
    refreshOnCreate: false,
  });
  modelRuntime.registerNativeProvider(faux.provider);
  const settingsManager = SettingsManager.inMemory({});
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    extensionFactories: [
      ...(await createPiWebBuiltinExtensions({ agentDir })).extensions,
      createReadOnlyMcpPolicyExtension(),
      registerFixtureServers,
    ],
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  });
  await resourceLoader.reload();
  const sessionManager = SessionManager.inMemory(cwd);
  const { session } = await createAgentSession({
    cwd,
    agentDir,
    modelRuntime,
    model: faux.getModel("faux-read-only"),
    sessionManager,
    settingsManager,
    resourceLoader,
  });
  const wrapper = new AgentSessionWrapper(session);
  t.after(async () => {
    wrapper.destroy();
    await rm(cwd, { recursive: true, force: true });
  });
  wrapper.beginExtensionBinding();
  await wrapper.waitUntilReady();
  // Both servers connected, and codemode activated for the scripted one.
  await waitFor(() => {
    const active = session.getActiveToolNames();
    return active.includes("mcp__direct__record") && active.includes("codemode")
      && session.getAllTools().some((tool) => tool.name === "mcp__scripted__record");
  });
  if (selection) {
    appendSessionToolSelection(sessionManager, selection);
    wrapper.setActiveToolSelection(selection);
  }
  return { session, faux };
}

function toolResults(session) {
  return session.messages.filter((message) => message.role === "toolResult");
}

function textOf(message) {
  return message.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
}

test("a Read-only session blocks MCP tools the server does not mark read-only", async (t) => {
  const { session, faux } = await startSession(t, READ_ONLY);
  faux.setResponses([
    () => fauxAssistantMessage([
      fauxToolCall("mcp__direct__record", { note: "change" }, { id: "call-record" }),
      fauxToolCall("mcp__direct__env_has", { name: "PATH" }, { id: "call-env" }),
    ], { stopReason: "toolUse" }),
    () => fauxAssistantMessage([fauxText("done")]),
  ]);
  await session.prompt("use the tools");

  const [record, env] = toolResults(session);
  assert.equal(record.toolCallId, "call-record");
  assert.equal(record.isError, true);
  assert.match(textOf(record), BLOCKED);
  assert.equal(env.toolCallId, "call-env");
  assert.equal(env.isError, false);
  assert.match(textOf(env), /"has":true/);
});

test("the policy also blocks the calls a codemode script makes", async (t) => {
  const { session, faux } = await startSession(t, READ_ONLY);
  const code = [
    "const allowed = await tools.mcp__scripted__env_has({ name: \"PATH\" });",
    "const blocked = await tools.mcp__scripted__record({ note: \"change\" }).then(() => \"ran\", (error) => error.message);",
    "return { allowed: allowed.structuredContent.has, blocked };",
  ].join("\n");
  faux.setResponses([
    () => fauxAssistantMessage([fauxToolCall("codemode", { code }, { id: "call-script" })], { stopReason: "toolUse" }),
    () => fauxAssistantMessage([fauxText("done")]),
  ]);
  await session.prompt("run a script");

  const [script] = toolResults(session);
  assert.equal(script.isError, false, textOf(script));
  // The script's return value is the last text block, as JSON.
  const returned = JSON.parse(script.content.at(-1).text);
  assert.equal(returned.allowed, true);
  assert.match(returned.blocked, BLOCKED);
});

test("sessions that may change things call the same tool", async (t) => {
  for (const selection of [undefined, ["read", "bash", "edit", "write"]]) {
    const { session, faux } = await startSession(t, selection);
    faux.setResponses([
      () => fauxAssistantMessage([fauxToolCall("mcp__direct__record", { note: "change" })], { stopReason: "toolUse" }),
      () => fauxAssistantMessage([fauxText("done")]),
    ]);
    await session.prompt("use the tool");
    const [record] = toolResults(session);
    assert.equal(record.isError, false, `${JSON.stringify(selection)}: ${textOf(record)}`);
    assert.match(textOf(record), /"recorded":"change"/);
  }
});
