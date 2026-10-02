import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  interopDefault: true,
  moduleCache: false,
});
const { AgentSessionWrapper, resolveActiveToolNames } = await jiti.import("./rpc-manager.ts");
const { TOOL_SELECTION_TYPE } = await jiti.import("./session-tool-selection.ts");
const { SUBAGENT_META_TYPE } = await jiti.import("./subagents.ts");

const READ_ONLY = ["read", "grep", "find", "ls"];

// `defaultActive` lives on the definition only; getAllTools() leaves it out, as pi's does.
const DEFINITIONS = [
  { name: "read", description: "read" },
  { name: "bash", description: "bash" },
  { name: "edit", description: "edit" },
  { name: "write", description: "write" },
  { name: "grep", description: "grep" },
  { name: "find", description: "find" },
  { name: "ls", description: "ls" },
  { name: "lookup", description: "no exposure field" },
  { name: "ask", description: "model-only", exposure: "model-only" },
  { name: "codemode", description: "registered inactive", exposure: "model-only", defaultActive: false },
  { name: "tool_search", description: "registered inactive", exposure: "model-only", defaultActive: false },
  { name: "scripted", description: "codemode", exposure: "codemode" },
  { name: "searchable", description: "deferred", exposure: "deferred" },
  { name: "withdrawn", description: "hidden", exposure: "hidden" },
];

function toolInfo(definition) {
  const info = { ...definition };
  delete info.defaultActive;
  return info;
}

function pin(tools) {
  return { type: "custom", customType: TOOL_SELECTION_TYPE, data: { version: 1, tools } };
}

function makeInner({ active = ["read", "lookup", "ask"], definitions = DEFINITIONS, entries = [], ...overrides } = {}) {
  const state = { active: [...active], activations: [] };
  const byName = new Map(definitions.map((definition) => [definition.name, definition]));
  const inner = {
    sessionId: "tool-exposure-session",
    sessionFile: undefined,
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    sessionManager: { getCwd: () => "", getEntries: () => entries },
    settingsManager: { getDefaultTools: () => undefined, setProjectTrusted: () => {} },
    agent: { state: {} },
    extensionRunner: { emit: async () => {}, setUIContext: () => {} },
    subscribe: () => () => {},
    getActiveToolNames: () => [...state.active],
    getAllTools: () => definitions.map(toolInfo),
    // Like pi: unknown and withdrawn tools are ignored.
    setActiveToolsByName: (names) => {
      state.activations.push(names);
      state.active = names.filter((name) => byName.has(name) && byName.get(name).exposure !== "hidden");
    },
    reload: async () => {},
    navigateTree: async () => ({ cancelled: false }),
    dispose: () => {},
    ...overrides,
  };
  return { inner, state };
}

function makeWrapper(options = {}, wrapperOptions = {}) {
  const { inner, state } = makeInner(options);
  return { wrapper: new AgentSessionWrapper(inner, wrapperOptions), inner, state };
}

test("a tool selection replaces only the coding tools and keeps the active extension tools", async (t) => {
  const { wrapper, state } = makeWrapper({
    active: ["read", "bash", "edit", "write", "lookup", "ask", "searchable", "codemode"],
  });
  t.after(() => wrapper.destroy());

  await wrapper.send({ type: "set_tools", toolNames: READ_ONLY });

  assert.deepEqual(state.activations, [
    ["read", "grep", "find", "ls", "lookup", "ask", "searchable", "codemode"],
  ]);
});

test("a tool selection does not activate tools registered with defaultActive: false", (t) => {
  const { wrapper, state } = makeWrapper();
  t.after(() => wrapper.destroy());

  wrapper.setActiveToolSelection(["read"]);

  assert.deepEqual(state.activations, [["read", "lookup", "ask"]]);
});

test("withdrawn and unregistered tools are never carried", (t) => {
  const { wrapper, state } = makeWrapper({ active: ["read", "withdrawn", "gone", "codemode"] });
  t.after(() => wrapper.destroy());

  wrapper.setActiveToolSelection(["read", "withdrawn"]);

  assert.deepEqual(state.activations, [["read", "codemode"]]);
});

test("an empty selection is Chat only", (t) => {
  const { inner } = makeInner({ active: ["read", "lookup", "codemode"] });
  assert.deepEqual(resolveActiveToolNames(inner, [], inner.getActiveToolNames()), []);

  const { wrapper, state } = makeWrapper({ active: ["read", "lookup", "codemode"] });
  t.after(() => wrapper.destroy());
  wrapper.setActiveToolSelection([]);
  assert.deepEqual(state.activations, [[]]);
});

test("startup keeps what defaultTools activates and never what pi leaves inactive", async () => {
  // The SDK's initial loadout: defaultTools plus the tools activated on registration.
  const { inner } = makeInner();
  const withCodemode = ["read", "bash", "edit", "write", "codemode", "lookup", "ask"];
  const withoutCodemode = ["read", "bash", "edit", "write", "lookup", "ask"];

  assert.deepEqual(
    resolveActiveToolNames(inner, READ_ONLY, withCodemode),
    ["read", "grep", "find", "ls", "codemode", "lookup", "ask"],
  );
  assert.deepEqual(
    resolveActiveToolNames(inner, withoutCodemode, withoutCodemode),
    ["read", "bash", "edit", "write", "lookup", "ask"],
  );

  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const startupSource = source.slice(source.indexOf("export async function startRpcSession"));
  assert.match(startupSource, /const initialToolNames = inner\.getActiveToolNames\(\);/);
  assert.match(
    startupSource,
    /resolveActiveToolNames\(inner, selectedToolNames \?\? initialToolNames, initialToolNames\)/,
  );
});

test("reload keeps the tools that were active and those an extension activated while it restarted", async (t) => {
  const { wrapper, state } = makeWrapper({
    active: ["read", "bash", "codemode", "lookup"],
    reload: async () => {
      // An extension's session_start activates tool_search; nothing activates the others.
      state.active = [...state.active, "ask", "tool_search"];
    },
  });
  t.after(() => wrapper.destroy());

  await wrapper.send({ type: "reload" });

  assert.deepEqual(state.activations.at(-1), ["read", "bash", "codemode", "lookup", "ask", "tool_search"]);
});

test("reload keeps the coding selection but not a tool an extension switched off while it restarted", async (t) => {
  const { wrapper, state } = makeWrapper({
    active: ["read", "grep", "find", "ls", "codemode", "searchable", "lookup"],
    reload: async () => {
      // pi rebuilds from the tools active before; then an extension's session_start withdraws
      // the deferred tool from the declared set, and something turns write on.
      state.active = ["read", "grep", "find", "ls", "write", "codemode", "lookup", "ask"];
    },
  });
  t.after(() => wrapper.destroy());

  await wrapper.send({ type: "reload" });

  assert.deepEqual(state.activations.at(-1), ["read", "grep", "find", "ls", "codemode", "lookup", "ask"]);
});

test("reload does not activate tools registered with defaultActive: false", async (t) => {
  const { wrapper, state } = makeWrapper({ active: ["read", "bash", "lookup", "ask"] });
  t.after(() => wrapper.destroy());

  await wrapper.send({ type: "reload" });

  assert.deepEqual(state.activations.at(-1), ["read", "bash", "lookup", "ask"]);
});

test("a direct or model-only tool an extension switched off stays off after reload and set_tools", async (t) => {
  const { wrapper, state } = makeWrapper({
    active: ["read", "bash", "lookup", "ask"],
    reload: async () => {
      // An extension's session_start(reload) keeps both extension tools out of the loadout.
      state.active = ["read", "bash"];
    },
  });
  t.after(() => wrapper.destroy());

  await wrapper.send({ type: "reload" });
  assert.deepEqual(state.activations.at(-1), ["read", "bash"]);

  await wrapper.send({ type: "set_tools", toolNames: READ_ONLY });
  assert.deepEqual(state.activations.at(-1), ["read", "grep", "find", "ls"]);
});

test("navigating the tree re-applies the pinned selection over the branch's restored tools", async (t) => {
  const made = makeWrapper({
    active: ["read", "grep", "find", "ls", "lookup", "codemode", "searchable"],
    entries: [pin(["read", "bash", "edit", "write"]), pin(READ_ONLY)],
    navigateTree: async () => {
      // pi restores the older branch's loadout from its transcript.
      made.state.active = ["read", "bash", "edit", "write", "lookup"];
      return { cancelled: false };
    },
  });
  t.after(() => made.wrapper.destroy());

  assert.deepEqual(await made.wrapper.send({ type: "navigate_tree", targetId: "older" }), { cancelled: false });

  // Read-only stays read-only, codemode stays on, and a tool loaded on the other branch is not.
  assert.deepEqual(made.state.active, ["read", "grep", "find", "ls", "lookup", "codemode"]);
});

test("navigating an unpinned session keeps the branch's restored tools", async (t) => {
  const made = makeWrapper({
    active: ["read", "bash", "edit", "write", "lookup", "tool_search", "searchable"],
    navigateTree: async () => {
      made.state.active = ["read", "bash", "lookup", "scripted"];
      return { cancelled: false };
    },
  });
  t.after(() => made.wrapper.destroy());

  await made.wrapper.send({ type: "navigate_tree", targetId: "older" });

  assert.deepEqual(made.state.active, ["read", "bash", "lookup", "scripted", "tool_search"]);
});

test("navigation keeps an extension tool off when the branch's loadout leaves it out", async (t) => {
  const made = makeWrapper({
    active: ["read", "grep", "find", "ls", "lookup", "ask"],
    entries: [pin(READ_ONLY)],
    navigateTree: async () => {
      // The branch was recorded while an extension kept both of its tools switched off.
      made.state.active = ["read", "bash", "edit", "write"];
      return { cancelled: false };
    },
  });
  t.after(() => made.wrapper.destroy());

  await made.wrapper.send({ type: "navigate_tree", targetId: "older" });

  assert.deepEqual(made.state.active, ["read", "grep", "find", "ls"]);
});

test("navigation keeps pi-web's subagent tools, which the session switched on after the branch was recorded", async (t) => {
  const agentTools = ["Agent", "get_subagent_result", "steer_subagent"].map((name) => ({ name, description: name, exposure: "model-only" }));
  const made = makeWrapper({
    definitions: [...DEFINITIONS, ...agentTools],
    active: ["read", "grep", "find", "ls", "lookup", "Agent", "get_subagent_result", "steer_subagent"],
    entries: [pin(READ_ONLY)],
    navigateTree: async () => {
      // The branch predates enabling built-in subagents and the reload that registered them.
      made.state.active = ["read", "bash", "edit", "write", "lookup"];
      return { cancelled: false };
    },
  });
  t.after(() => made.wrapper.destroy());

  await made.wrapper.send({ type: "navigate_tree", targetId: "older" });

  assert.deepEqual(made.state.active, ["read", "grep", "find", "ls", "lookup", "Agent", "get_subagent_result", "steer_subagent"]);
});

test("navigation from an extension command re-applies the selection too", async (t) => {
  const made = makeWrapper({
    active: ["read", "grep", "find", "ls", "lookup"],
    entries: [pin(READ_ONLY)],
    navigateTree: async (_targetId, options) => {
      assert.deepEqual(options, { summarize: true });
      made.state.active = ["read", "bash", "edit", "write", "lookup"];
      return { cancelled: false };
    },
  });
  t.after(() => made.wrapper.destroy());

  const actions = made.wrapper.createExtensionCommandContextActions();
  assert.deepEqual(await actions.navigateTree("older", { summarize: true }), { cancelled: false });

  assert.deepEqual(made.state.active, ["read", "grep", "find", "ls", "lookup"]);
});

test("cancelled navigation, Chat only, and subagents keep the tools pi restored", async (t) => {
  const restored = ["read", "bash", "edit", "write"];
  const cases = [
    {
      name: "cancelled",
      options: { entries: [pin(READ_ONLY)], navigateTree: async () => ({ cancelled: true }) },
      wrapperOptions: {},
      expected: { cancelled: true },
    },
    {
      name: "Chat only",
      options: { active: [], entries: [pin([])] },
      wrapperOptions: { chatOnly: true },
      expected: { cancelled: false },
    },
    {
      name: "subagent",
      options: {
        entries: [{
          type: "custom",
          customType: SUBAGENT_META_TYPE,
          data: {
            version: 1,
            parentSessionId: "parent",
            parentSessionPath: "/tmp/parent.jsonl",
            resourceSnapshot: { version: 1, appendSystemPrompt: [], tools: ["read"], loadSkills: false, loadExtensions: false },
          },
        }],
      },
      wrapperOptions: {},
      expected: { cancelled: false },
    },
  ];

  for (const { name, options, wrapperOptions, expected } of cases) {
    const made = makeWrapper({
      navigateTree: async () => {
        made.state.active = [...restored];
        return { cancelled: false };
      },
      ...options,
    }, wrapperOptions);
    t.after(() => made.wrapper.destroy());

    assert.deepEqual(await made.wrapper.send({ type: "navigate_tree", targetId: "older" }), expected, name);
    assert.deepEqual(made.state.activations, [], name);
  }
});

test("get_tools reports the descriptions declared to the model", async (t) => {
  const { wrapper } = makeWrapper({
    active: ["read", "codemode"],
    // pi's prepareLoadout hooks rewrite declared descriptions; inactive tools keep the definition's.
    agent: {
      state: {
        tools: [
          { name: "read", description: "read\n\ncodemode tool declaration: …" },
          { name: "codemode", description: "Run JavaScript … ## mcp (2 tools)" },
        ],
      },
    },
  });
  t.after(() => wrapper.destroy());

  const tools = await wrapper.send({ type: "get_tools" });
  const description = (name) => tools.find((tool) => tool.name === name).description;

  assert.equal(description("codemode"), "Run JavaScript … ## mcp (2 tools)");
  assert.equal(description("read"), "read\n\ncodemode tool declaration: …");
  assert.equal(description("bash"), "bash");
  assert.equal(description("scripted"), "codemode");
});

test("get_tools leaves out withdrawn tools and reports each tool's exposure", async (t) => {
  const { wrapper } = makeWrapper();
  t.after(() => wrapper.destroy());

  const tools = await wrapper.send({ type: "get_tools" });

  assert.deepEqual(
    tools.map(({ name, exposure, active }) => ({ name, exposure, active })),
    [
      { name: "read", exposure: undefined, active: true },
      { name: "bash", exposure: undefined, active: false },
      { name: "edit", exposure: undefined, active: false },
      { name: "write", exposure: undefined, active: false },
      { name: "grep", exposure: undefined, active: false },
      { name: "find", exposure: undefined, active: false },
      { name: "ls", exposure: undefined, active: false },
      { name: "lookup", exposure: undefined, active: true },
      { name: "ask", exposure: "model-only", active: true },
      { name: "codemode", exposure: "model-only", active: false },
      { name: "tool_search", exposure: "model-only", active: false },
      { name: "scripted", exposure: "codemode", active: false },
      { name: "searchable", exposure: "deferred", active: false },
    ],
  );
});
