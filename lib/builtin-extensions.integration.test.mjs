import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxProvider, fauxText } from "@earendil-works/pi-ai";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

// The MCP extension keeps its log and OAuth store in the agent directory.
const agentDir = await mkdtemp(join(tmpdir(), "pi-web-builtins-agent-"));
process.env.PI_CODING_AGENT_DIR = agentDir;

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");
const { createPiWebBuiltinExtensions } = await jiti.import("./builtin-extensions.ts");
const { bareMcpOpensSettings, isBuiltinMcpCommand } = await jiti.import("./mcp-command.ts");

const FIXTURE = fileURLToPath(new URL("./__fixtures__/mcp-env-server.mjs", import.meta.url));

test.after(() => rm(agentDir, { recursive: true, force: true }));

async function startSession(t, { settings = {}, extensionFactories = [] } = {}) {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-builtins-cwd-"));
  const faux = fauxProvider({ models: [{ id: "faux-builtins" }] });
  const modelRuntime = await ModelRuntime.create({
    authPath: join(agentDir, "auth.json"),
    modelsPath: null,
    refreshOnCreate: false,
  });
  modelRuntime.registerNativeProvider(faux.provider);
  const settingsManager = SettingsManager.inMemory(settings);
  // Built-in extensions load as `builtin:<name>` resources, which `noExtensions` would disable.
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    extensionFactories: [...(await createPiWebBuiltinExtensions({ agentDir })).extensions, ...extensionFactories],
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
    model: faux.getModel("faux-builtins"),
    sessionManager: SessionManager.inMemory(cwd),
    settingsManager,
    resourceLoader,
  });
  const wrapper = new AgentSessionWrapper(session);
  wrapper.beginExtensionBinding();
  await wrapper.waitUntilReady();
  t.after(async () => {
    wrapper.destroy();
    await rm(cwd, { recursive: true, force: true });
  });
  return { session, faux, wrapper };
}

function toolNames(session) {
  return session.getAllTools().map((tool) => tool.name);
}

function commandNames(session) {
  return session.extensionRunner.getRegisteredCommands().map((command) => command.name);
}

async function waitFor(condition, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("timed out");
    await delay(20);
  }
}

test("a normal session loads codemode and tool_search inactive and the MCP extension", async (t) => {
  const { session } = await startSession(t);
  const names = toolNames(session);
  assert.ok(names.includes("codemode"));
  assert.ok(names.includes("tool_search"));
  assert.ok(!session.getActiveToolNames().includes("codemode"));
  assert.ok(!session.getActiveToolNames().includes("tool_search"));
  assert.ok(commandNames(session).includes("mcp"));
});

test("defaultTools +codemode activates the built-in codemode tool", async (t) => {
  const { session } = await startSession(t, { settings: { defaultTools: ["+codemode"] } });
  assert.ok(session.getActiveToolNames().includes("codemode"));
});

test("-builtin:<name> in the extensions setting leaves that built-in out", async (t) => {
  const { session } = await startSession(t, { settings: { extensions: ["-builtin:mcp", "-builtin:codemode"] } });
  assert.ok(!toolNames(session).includes("codemode"));
  assert.ok(toolNames(session).includes("tool_search"));
  assert.ok(!commandNames(session).includes("mcp"));
});

test("the composer's /mcp rule matches what get_commands reports and what pi runs", async (t) => {
  // A bare /mcp opens Settings › MCP from these lists (useAgentSession); pin the SDK
  // facts it rests on: the built-in's path, its replacement, and suffixed duplicates,
  // which a bare /mcp never reaches.
  const ran = [];
  const sessionWith = async (options) => {
    const started = await startSession(t, options);
    return { ...started, commands: (await started.wrapper.send({ type: "get_commands" })).commands };
  };
  /** Send a bare /mcp as the composer would, and report what the model was handed, if anything. */
  const sendBareMcp = async ({ wrapper, faux }) => {
    let modelSaw;
    faux.setResponses([(context) => {
      const last = context.messages.at(-1);
      modelSaw = typeof last.content === "string" ? last.content : last.content.map((part) => part.text ?? "").join("");
      return fauxAssistantMessage([fauxText("ok")]);
    }]);
    await wrapper.send({ type: "prompt", message: "/mcp" });
    await waitFor(() => !wrapper.isRunning());
    return modelSaw;
  };
  const named = (commands, name) => commands.filter((command) => command.name === name);
  const thirdParty = (name) => ({
    name,
    factory: (pi) => pi.registerCommand("mcp", { description: name, handler: async () => { ran.push(name); } }),
  });

  const normal = await sessionWith();
  assert.equal(named(normal.commands, "mcp").length, 1);
  assert.equal(isBuiltinMcpCommand(named(normal.commands, "mcp")[0]), true);
  assert.equal(bareMcpOpensSettings(normal.commands), true);

  const switchedOff = await sessionWith({ settings: { extensions: ["-builtin:mcp"] } });
  assert.equal(named(switchedOff.commands, "mcp").length, 0);
  assert.equal(bareMcpOpensSettings(switchedOff.commands), true);

  // Another extension's /mcp replaces the built-in, which is not loaded beside it, and runs.
  const replaced = await sessionWith({ extensionFactories: [thirdParty("other-mcp")] });
  assert.deepEqual(named(replaced.commands, "mcp").map((command) => command.description), ["other-mcp"]);
  assert.equal(replaced.commands.some(isBuiltinMcpCommand), false);
  assert.equal(bareMcpOpensSettings(replaced.commands), false);
  assert.equal(await sendBareMcp(replaced), undefined, "the extension's handler takes it, not the model");
  assert.deepEqual(ran, ["other-mcp"]);

  // Two are renamed mcp:1 and mcp:2, and pi looks commands up by exact name: a bare /mcp runs
  // neither and reaches the model as text, so the composer opens Settings instead.
  const two = await sessionWith({ extensionFactories: [thirdParty("first-mcp"), thirdParty("second-mcp")] });
  assert.deepEqual(two.commands.filter((command) => command.name.startsWith("mcp")).map((command) => command.name), ["mcp:1", "mcp:2"]);
  assert.equal(two.commands.some(isBuiltinMcpCommand), false);
  assert.equal(await sendBareMcp(two), "/mcp");
  assert.deepEqual(ran, ["other-mcp"]);
  assert.equal(bareMcpOpensSettings(two.commands), true);
});

test("servers in mcp.json are not connected when a session starts", async (t) => {
  // The MCP host connects them before a prompt (lib/mcp-host.integration.test.mjs);
  // the extension itself must not, or every browsed session would start them.
  const marker = join(agentDir, "spawned");
  const script = `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "")`;
  await writeFile(join(agentDir, "mcp.json"), JSON.stringify({
    mcpServers: { configured: { command: process.execPath, args: ["-e", script], exposure: "direct" } },
  }));
  t.after(() => rm(join(agentDir, "mcp.json"), { force: true }));

  const { session } = await startSession(t);
  await delay(200);
  assert.equal(existsSync(marker), false, "the configured server was started");
  assert.ok(!toolNames(session).some((name) => name.startsWith("mcp__")));
});

test("servers an extension registers connect through Pi Web's transport", async (t) => {
  // Unset, the reference would fail to resolve under any transport.
  const previousPassword = process.env.PI_WEB_PASSWORD;
  process.env.PI_WEB_PASSWORD = "web-password";
  t.after(() => {
    if (previousPassword === undefined) delete process.env.PI_WEB_PASSWORD;
    else process.env.PI_WEB_PASSWORD = previousPassword;
  });
  const registering = {
    name: "registers-servers",
    factory: (pi) => {
      pi.registerMcpServer("fixture", { command: process.execPath, args: [FIXTURE], exposure: "direct" });
      // The SDK's own transport would start this one; Pi Web's refuses it.
      pi.registerMcpServer("leaky", {
        command: process.execPath,
        args: [FIXTURE],
        env: { TOKEN: "${PI_WEB_PASSWORD}" },
        exposure: "direct",
      });
    },
  };
  const { session } = await startSession(t, { extensionFactories: [registering] });
  await waitFor(() => toolNames(session).includes("mcp__fixture__env_has"));
  assert.ok(session.getActiveToolNames().includes("mcp__fixture__env_has"));
  assert.ok(!toolNames(session).some((name) => name.startsWith("mcp__leaky__")));
});
