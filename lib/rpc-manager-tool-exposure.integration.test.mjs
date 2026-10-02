import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fauxAssistantMessage, fauxProvider, fauxText } from "@earendil-works/pi-ai";
import {
  createAgentSession,
  createCodemodeExtension,
  createToolSearchExtension,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const { AgentSessionWrapper, resolveActiveToolNames } = await jiti.import("./rpc-manager.ts");
const { appendSessionToolSelection } = await jiti.import("./session-tool-selection.ts");

const READ_ONLY = ["read", "grep", "find", "ls"];

const lookupExtension = {
  name: "lookup",
  factory: (pi) => {
    pi.registerTool({
      name: "lookup",
      label: "lookup",
      description: "an extension tool pi activates on registration",
      parameters: { type: "object", properties: {} },
      async execute() {
        return { content: [{ type: "text", text: "found" }], details: undefined };
      },
    });
  },
};

// On reload it swaps the discovery tools, as the MCP extension does when exposures change.
const reloadSwitchExtension = {
  name: "reload-switch",
  factory: (pi) => {
    pi.on("session_start", (event) => {
      if (event.reason !== "reload") return;
      pi.setActiveTools([...pi.getActiveTools().filter((name) => name !== "tool_search"), "codemode"]);
    });
  },
};

// pi's own codemode and tool_search, which register with `defaultActive: false`.
async function createSession(dir, settings = {}, extensionFactories = []) {
  const faux = fauxProvider({ models: [{ id: "faux-tools" }] });
  const modelRuntime = await ModelRuntime.create({
    authPath: join(dir, "auth.json"),
    modelsPath: null,
    refreshOnCreate: false,
  });
  modelRuntime.registerNativeProvider(faux.provider);
  const settingsManager = SettingsManager.inMemory(settings);
  const resourceLoader = new DefaultResourceLoader({
    cwd: dir,
    agentDir: dir,
    settingsManager,
    extensionFactories: [createCodemodeExtension(), createToolSearchExtension(), lookupExtension, ...extensionFactories],
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  });
  await resourceLoader.reload();
  const { session } = await createAgentSession({
    cwd: dir,
    agentDir: dir,
    modelRuntime,
    model: faux.getModel("faux-tools"),
    sessionManager: SessionManager.inMemory(dir),
    settingsManager,
    resourceLoader,
  });
  return { session, faux };
}

function sorted(names) {
  return [...names].sort();
}

test("a pinned preset neither activates codemode nor drops the one defaultTools adds", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-tool-activation-"));
  try {
    const plain = await createSession(dir);
    const initial = plain.session.getActiveToolNames();
    assert.deepEqual(sorted(initial), ["bash", "edit", "lookup", "read", "write"]);
    assert.deepEqual(
      sorted(resolveActiveToolNames(plain.session, READ_ONLY, initial)),
      ["find", "grep", "lookup", "ls", "read"],
    );
    plain.session.dispose();

    const withCodemode = await createSession(dir, { defaultTools: ["+codemode"] });
    const initialWithCodemode = withCodemode.session.getActiveToolNames();
    assert.ok(initialWithCodemode.includes("codemode"));
    assert.deepEqual(
      sorted(resolveActiveToolNames(withCodemode.session, READ_ONLY, initialWithCodemode)),
      ["codemode", "find", "grep", "lookup", "ls", "read"],
    );
    withCodemode.session.dispose();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// Like an MCP server's tool when only scripts reach it.
const scriptedMcpExtension = {
  name: "scripted-mcp",
  factory: (pi) => {
    pi.registerTool({
      name: "mcp__docs__search",
      label: "search",
      description: "search the docs",
      parameters: { type: "object", properties: { query: { type: "string" } } },
      exposure: "codemode",
      namespace: { name: "mcp__docs", description: "the docs server" },
      async execute() {
        return { content: [{ type: "text", text: "found" }], details: undefined };
      },
    });
  },
};

test("get_tools reports codemode's description as declared, with the tools scripts can call", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-tool-descriptions-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { session } = await createSession(dir, { defaultTools: ["+codemode"] }, [scriptedMcpExtension]);
  const wrapper = new AgentSessionWrapper(session);
  t.after(() => wrapper.destroy());

  const tools = await wrapper.send({ type: "get_tools" });
  const codemode = tools.find((tool) => tool.name === "codemode");

  assert.equal(codemode.active, true);
  assert.equal(codemode.description, session.agent.state.tools.find((tool) => tool.name === "codemode").description);
  assert.notEqual(codemode.description, session.getToolDefinition("codemode").description);
  // Each namespace is a heading with its summary; pi no longer counts its tools there.
  assert.match(codemode.description, /## mcp__docs\nthe docs server/);
  assert.match(codemode.description, /search the docs/);
});

test("get_tools marks the active tools codemode's only mode leaves out of requests", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-tool-hidden-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const hiddenNames = async (settings) => {
    const { session } = await createSession(dir, settings);
    const wrapper = new AgentSessionWrapper(session);
    t.after(() => wrapper.destroy());
    const tools = await wrapper.send({ type: "get_tools" });
    assert.ok(tools.find((tool) => tool.name === "codemode").active);
    return sorted(tools.filter((tool) => tool.declarationHidden).map((tool) => tool.name));
  };

  // Still active, so presets and scripts see them; only their declarations are withheld.
  assert.deepEqual(
    await hiddenNames({ defaultTools: ["+codemode"], codemode: { mode: "only" } }),
    ["bash", "edit", "lookup", "read", "write"],
  );
  assert.deepEqual(await hiddenNames({ defaultTools: ["+codemode"] }), []);
});

test("navigating to an older branch keeps the Read-only pin and codemode", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-tool-navigation-"));
  const { session, faux } = await createSession(dir);
  const wrapper = new AgentSessionWrapper(session);
  try {
    faux.setResponses([
      () => fauxAssistantMessage([fauxText("first")]),
      () => fauxAssistantMessage([fauxText("second")]),
    ]);
    await session.prompt("first");
    const firstLeafId = session.sessionManager.getLeafId();

    appendSessionToolSelection(session.sessionManager, READ_ONLY);
    wrapper.setActiveToolSelection(READ_ONLY);
    // Activated at runtime, as the MCP extension does when a server connects.
    session.setActiveToolsByName([...session.getActiveToolNames(), "codemode"]);
    await session.prompt("second");
    const secondLeafId = session.sessionManager.getLeafId();
    const pinnedTools = ["codemode", "find", "grep", "lookup", "ls", "read"];
    assert.deepEqual(sorted(session.getActiveToolNames()), pinnedTools);

    // On its own, pi restores the older branch's loadout: write is back and codemode is gone.
    await session.navigateTree(firstLeafId, {});
    assert.deepEqual(sorted(session.getActiveToolNames()), ["bash", "edit", "lookup", "read", "write"]);
    await session.navigateTree(secondLeafId, {});
    assert.deepEqual(sorted(session.getActiveToolNames()), pinnedTools);

    assert.deepEqual(await wrapper.send({ type: "navigate_tree", targetId: firstLeafId }), { cancelled: false });
    assert.equal(session.sessionManager.getLeafId(), firstLeafId);
    assert.deepEqual(sorted(session.getActiveToolNames()), pinnedTools);
  } finally {
    wrapper.destroy();
    await rm(dir, { recursive: true, force: true });
  }
});

test("reload keeps the pinned coding tools and what extensions chose while they restarted", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-tool-reload-"));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  // The wrapper's reload reads project trust from the agent directory.
  process.env.PI_CODING_AGENT_DIR = dir;
  const { session } = await createSession(dir, {}, [reloadSwitchExtension]);
  const wrapper = new AgentSessionWrapper(session);
  try {
    wrapper.beginExtensionBinding();
    await wrapper.waitUntilReady();
    wrapper.setActiveToolSelection(READ_ONLY);
    session.setActiveToolsByName([...session.getActiveToolNames(), "tool_search"]);
    assert.deepEqual(sorted(session.getActiveToolNames()), ["find", "grep", "lookup", "ls", "read", "tool_search"]);

    assert.deepEqual(await wrapper.send({ type: "reload" }), { success: true });

    // The extension switched tool_search off and codemode on; the pin still holds.
    assert.deepEqual(sorted(session.getActiveToolNames()), ["codemode", "find", "grep", "lookup", "ls", "read"]);
  } finally {
    wrapper.destroy();
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    await rm(dir, { recursive: true, force: true });
  }
});
