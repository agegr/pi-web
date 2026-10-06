import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { createJiti } from "jiti";

const root = await mkdtemp(join(tmpdir(), "pi-child-capabilities-"));
const previous = { HOME: process.env.HOME, PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR };
process.env.HOME = join(root, "home"); process.env.PI_CODING_AGENT_DIR = join(root, "agent");
await mkdir(process.env.HOME); await mkdir(process.env.PI_CODING_AGENT_DIR);
const keepAlive = setInterval(() => {}, 1000);
after(async () => { clearInterval(keepAlive); for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } await rm(root, { recursive: true, force: true }); });
const sdk = await import("@earendil-works/pi-coding-agent");
const { fauxProvider, fauxAssistantMessage, fauxToolCall, fauxText } = await import("@earendil-works/pi-ai");
const jiti = createJiti(import.meta.url);
const { createSubagentSessionServices } = await jiti.import("./subagent-resources.ts");
const { AgentSessionWrapper, startRpcSession } = await jiti.import("./rpc-manager.ts");
const { createSubagentController } = await jiti.import("./subagent-runtime.ts");
const { readSubagentSessionResources, saveSubagentProfile, listSubagentProfiles, SUBAGENT_META_TYPE } = await jiti.import("./subagents.ts");
const { subagentToolExclusions } = await jiti.import("./subagent-tool-policy.ts");
const { loadPiSdkInternals } = await jiti.import("./pi-sdk-internals.ts");
const { McpHost, MCP_HOST_EXTENSION_PATH } = await jiti.import("./mcp-host.ts");
const internals = await loadPiSdkInternals(); assert.equal(internals.ok, true);
const connections = [], calls = [], paused = new Set();
let resolutions = 0;
class FakeTransport {
  listeners = new Set(); closeListeners = new Set(); closed = false; requests = [];
  constructor(entry) { this.entry = structuredClone(entry); connections.push(this); }
  onMessage(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  onClose(fn) { this.closeListeners.add(fn); return () => this.closeListeners.delete(fn); }
  onError() { return () => {}; }
  async start() {}
  async close() { this.closed = true; for (const fn of this.closeListeners) fn(); }
  async send(message) {
    if (message.id === undefined || this.closed) return;
    this.requests.push(message.method);
    let result;
    switch (message.method) {
      case "initialize": result = { protocolVersion: "2025-06-18", capabilities: { tools: {}, resources: {} }, serverInfo: { name: "fake", version: "1" } }; break;
      case "tools/list":
        if (paused.has(this.entry.name)) return;
        result = { tools: [
          { name: "inspect", description: "Fixture read", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } },
          { name: "mutate", description: "Fixture write", inputSchema: { type: "object", properties: {} } },
        ] }; break;
      case "resources/list": result = { resources: [{ uri: "fixture://item", name: "item" }] }; break;
      case "resources/templates/list": result = { resourceTemplates: [] }; break;
      case "resources/read": calls.push([this.entry.name, "resource"]); result = { contents: [{ uri: "fixture://item", text: "fixture resource" }] }; break;
      case "tools/call": calls.push([this.entry.name, message.params.name]); result = { content: [{ type: "text", text: "fixture executed" }] }; break;
      default: result = {};
    }
    queueMicrotask(() => { if (!this.closed) for (const fn of this.listeners) fn({ jsonrpc: "2.0", id: message.id, result }); });
  }
}
// Replace only the existing pi-web adapter result, never SDK internals/private methods.
const fakeInternals = { ...internals, createDefaultTransport: (entry) => { resolutions++; return new FakeTransport(entry); } };
globalThis[Symbol.for("pi-web.piSdkInternals")] = Promise.resolve(fakeInternals);
const config = (exposure = "direct") => ({ url: "https://fixture.invalid/mcp", exposure });
const snapshot = (overrides = {}) => ({ version: 3, builtinTools: ["read"], toolPolicy: { mode: "none", selectors: [], deny: [] }, appendSystemPrompt: ["Fixture"], loadSkills: false, loadExtensions: false, codeMode: false, loadMcp: false, mcpServers: [], ...overrides });
const metadata = (resourceSnapshot) => ({ version: 1, parentSessionId: "parent", parentSessionPath: "/parent", resourceSnapshot });
async function until(fn) { for (let i = 0; i < 200; i++) { if (fn()) return; await delay(5); } throw Error("fixture timed out"); }
async function fixture(t, resources = snapshot(), settings = {}, files = { selected: config(), excluded: config() }) {
  const dir = await mkdtemp(join(root, "case-")), cwd = join(dir, "cwd"), agentDir = join(dir, "agent");
  await mkdir(cwd); await mkdir(agentDir);
  await writeFile(join(agentDir, "settings.json"), JSON.stringify({ cacheWarming: "off", ...settings }));
  await writeFile(join(agentDir, "mcp.json"), JSON.stringify({ mcpServers: files }));
  const faux = fauxProvider({ models: [{ id: "child-faux" }] });
  const runtime = await sdk.ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: null, refreshOnCreate: false });
  runtime.registerNativeProvider(faux.provider);
  const services = await createSubagentSessionServices({ cwd, agentDir, modelRuntime: runtime, settingsManager: sdk.SettingsManager.create(cwd, agentDir), resourceLoaderOptions: { noPromptTemplates: true, noThemes: true, noContextFiles: true } }, resources);
  const manager = sdk.SessionManager.inMemory(cwd); manager.appendCustomEntry(SUBAGENT_META_TYPE, metadata(resources));
  const { session } = await sdk.createAgentSessionFromServices({ services, sessionManager: manager, model: faux.getModel("child-faux"), ...(resources.version === 1 ? { tools: resources.tools } : { noTools: "builtin", excludeTools: subagentToolExclusions(resources.builtinTools) }) });
  if (resources.version !== 1) session.setActiveToolsByName([...resources.builtinTools, ...session.getActiveToolNames()]);
  const wrapper = new AgentSessionWrapper(session, { subagentResources: readSubagentSessionResources(manager.getEntries()), mcpHost: services.mcpHost });
  let binds = 0; const bind = session.bindExtensions.bind(session); session.bindExtensions = (...args) => { binds++; return bind(...args); };
  wrapper.beginExtensionBinding(); await wrapper.waitUntilReady();
  t.after(async () => { await wrapper.destroy(); runtime.dispose?.(); });
  return { cwd, agentDir, dir, services, session, wrapper, faux, runtime, resources, binds: () => binds };
}
async function execute(f, toolCalls) {
  f.faux.setResponses([() => fauxAssistantMessage(toolCalls.map(([name, args]) => fauxToolCall(name, args)), { stopReason: "toolUse" }), () => fauxAssistantMessage([fauxText("done")])]);
  await f.wrapper.promptDelegated("fixture");
  return f.session.messages.filter((m) => m.role === "toolResult").slice(-toolCalls.length);
}

test("default/off and old snapshots ignore global defaults, restore/reload never create host connections", async (t) => {
  for (const resources of [snapshot(), { ...snapshot(), version: 2, codeMode: undefined, loadMcp: undefined, mcpServers: undefined }, { version: 1, tools: ["read"], appendSystemPrompt: [], loadSkills: false, loadExtensions: false }]) {
    const before = resolutions, f = await fixture(t, resources, { defaultTools: ["+codemode", "+tool_search"] });
    assert.equal(f.services.mcpHost, undefined);
    assert.ok(!f.session.getAllTools().some((tool) => ["codemode", "tool_search"].includes(tool.name)));
    f.faux.setResponses([() => fauxAssistantMessage([fauxText("off")])]); await f.wrapper.promptDelegated("off");
    await f.wrapper.send({ type: "reload" }); assert.equal(resolutions, before); assert.equal(f.binds(), 1);
  }
});

test("all four independent role combinations execute real builtin scripts/MCP; excluded marker stays zero", async (t) => {
  for (const codeMode of [false, true]) for (const loadMcp of [false, true]) {
    const before = connections.length;
    const f = await fixture(t, snapshot({ codeMode, loadMcp, mcpServers: [{ scope: "global", name: "selected" }] }));
    assert.equal(Boolean(f.services.mcpHost), loadMcp);
    assert.equal(f.session.getActiveToolNames().includes("codemode"), codeMode);
    if (codeMode) {
      const [result] = await execute(f, [["codemode", { code: "return [6 * 7, typeof models]" }]]);
      assert.equal(result.isError, false); assert.match(JSON.stringify(result.content), /42.*undefined/);
      assert.ok(!f.session.agent.state.tools.find((tool) => tool.name === "codemode").description.includes("models.classify"));
    } else {
      f.faux.setResponses([() => fauxAssistantMessage([fauxText("ready")])]); await f.wrapper.promptDelegated("ready");
    }
    if (loadMcp) {
      await until(() => f.session.getAllTools().some((tool) => tool.name === "mcp__selected__inspect"));
      assert.equal((await execute(f, [["mcp__selected__inspect", {}]]))[0].isError, false);
    }
    assert.deepEqual(connections.slice(before).map((transport) => transport.entry.name), loadMcp ? ["selected"] : []);
    assert.ok(!calls.some(([server]) => server === "excluded"));
  }
});

test("MCP without Code mode converts codemode to discoverable deferred; None and disabled tool-search never activate executable codemode", async (t) => {
  const f = await fixture(t, snapshot({ loadMcp: true, mcpServers: [{ scope: "global", name: "selected" }] }), {}, { selected: config("codemode") });
  const result = await execute(f, [["tool_search", { query: "inspect" }]]);
  assert.equal(result[0].isError, false);
  assert.equal(f.session.getAllTools().find((tool) => tool.name === "mcp__selected__inspect").exposure, "deferred");
  assert.equal((await execute(f, [["mcp__selected__inspect", {}]]))[0].isError, false);
  assert.ok(!f.session.getAllTools().some((tool) => tool.name === "codemode"));
  const before = resolutions;
  const none = await fixture(t, snapshot({ loadMcp: true }));
  none.faux.setResponses([() => fauxAssistantMessage([fauxText("none")])]); await none.wrapper.promptDelegated("none");
  assert.equal(resolutions, before);
  const disabled = await fixture(t, snapshot({ loadMcp: true, mcpServers: [{ scope: "global", name: "selected" }] }), { extensions: ["-builtin:tool-search"] }, { selected: config("codemode") });
  assert.ok(!disabled.session.getAllTools().some((tool) => ["tool_search", "codemode"].includes(tool.name)));
  disabled.faux.setResponses([() => fauxAssistantMessage([fauxText("unreachable")])]); await disabled.wrapper.promptDelegated("unreachable");
  await until(() => disabled.session.getAllTools().some((tool) => tool.name === "mcp__selected__inspect"));
  assert.equal(disabled.session.getAllTools().find((tool) => tool.name === "mcp__selected__inspect").exposure, "deferred");
});

test("read-only MCP tools and resources are allowed, direct and nested mutation/foreign resources have zero execution", async (t) => {
  const f = await fixture(t, snapshot({ codeMode: true, loadMcp: true, mcpServers: [{ scope: "global", name: "selected" }] }));
  let before = calls.length;
  const results = await execute(f, [["mcp__selected__mutate", {}], ["codemode", { code: "return await tools.mcp__selected__mutate({})" }], ["read_mcp_resource", { server: "excluded", uri: "fixture://item" }]]);
  assert.ok(results.every((result) => result.isError)); assert.equal(calls.length, before);
  const allowed = await execute(f, [["codemode", { code: "return await tools.mcp__selected__inspect({})" }], ["read_mcp_resource", { server: "selected", uri: "fixture://item" }], ["list_mcp_resources", {}]]);
  assert.ok(allowed.every((result) => !result.isError)); assert.equal(calls.length, before + 2);
  before = calls.length;
  await writeFile(join(f.agentDir, "mcp.json"), JSON.stringify({ mcpServers: { excluded: config() } }));
  // Do not prepare: test synchronous authorization during the revocation sync window.
  f.faux.setResponses([() => fauxAssistantMessage([fauxToolCall("read_mcp_resource", { server: "selected", uri: "fixture://item" }), fauxToolCall("codemode", { code: "return await tools.mcp__selected__inspect({})" })], { stopReason: "toolUse" }), () => fauxAssistantMessage([fauxText("done")])]);
  await f.session.prompt("revoked"); assert.equal(calls.length, before);
});

test("builtin switches read un-cleared scoped source; global disable, trusted project override, untrusted override, reload", async (t) => {
  const f = await fixture(t, snapshot({ codeMode: true, loadMcp: true, mcpServers: [{ scope: "global", name: "selected" }] }), { extensions: ["-builtin:codemode", "-builtin:mcp"] });
  assert.ok(!f.session.getAllTools().some((tool) => tool.name === "codemode"));
  f.faux.setResponses([() => fauxAssistantMessage([fauxText("disabled")])]); const before = resolutions; await f.wrapper.promptDelegated("disabled"); assert.equal(resolutions, before);
  await mkdir(join(f.cwd, ".pi")); await writeFile(join(f.cwd, ".pi", "settings.json"), JSON.stringify({ extensions: ["+builtin:codemode", "+builtin:mcp"] }));
  await f.wrapper.send({ type: "reload" }); assert.ok(!f.session.getAllTools().some((tool) => tool.name === "codemode"));
  new sdk.ProjectTrustStore(f.agentDir).set(f.cwd, true);
  await f.wrapper.send({ type: "reload" }); assert.ok(f.session.getActiveToolNames().includes("codemode"));
  assert.equal((await execute(f, [["mcp__selected__inspect", {}]]))[0].isError, false);
  new sdk.ProjectTrustStore(f.agentDir).set(f.cwd, false);
  await f.wrapper.send({ type: "reload" }); assert.ok(!f.session.getAllTools().some((tool) => tool.name === "codemode"));
});

test("profile v3 strict validation, case-sensitive references, legacy save and clone preserve managed/foreign fields", async () => {
  const cwd = await mkdtemp(join(root, "profiles-"));
  const profile = { name: "original", displayName: "Original", description: "Fixture", systemPrompt: "Fixture", tools: ["read"], loadSkills: false, loadExtensions: false, inheritContext: false, runInBackground: false, promptMode: "append", enabled: true, codeMode: true, loadMcp: true, mcpServers: [{ scope: "project", name: "Case-ID" }] };
  const saved = saveSubagentProfile(cwd, "project", profile);
  await writeFile(saved.filePath, (await readFile(saved.filePath, "utf8")).replace("---\n\n", "foreign: preserved\n---\n\n"));
  const old = { ...profile }; delete old.codeMode; delete old.loadMcp; delete old.mcpServers;
  const retained = saveSubagentProfile(cwd, "project", old);
  assert.equal(retained.codeMode, true); assert.deepEqual(retained.mcpServers, profile.mcpServers);
  const clone = saveSubagentProfile(cwd, "project", { ...old, name: "clone" }, retained);
  assert.match(await readFile(clone.filePath, "utf8"), /foreign: preserved/); assert.equal(clone.loadMcp, true);
  assert.deepEqual(listSubagentProfiles(cwd).find((p) => p.name === "clone").mcpServers, profile.mcpServers);
  for (const invalid of [{ codeMode: "true" }, { loadMcp: 1 }, { mcpServers: ["Case-ID"] }, { mcpServers: [{ scope: "project", name: "Case-ID", hash: "no" }] }]) assert.throws(() => saveSubagentProfile(cwd, "project", { ...profile, ...invalid }));
  for (const invalid of [{ version: 4 }, { codeMode: undefined }, { loadMcp: undefined }, { mcpServers: undefined }, { mcpServers: [{ scope: "extension", name: "x" }] }]) assert.equal(readSubagentSessionResources([{ type: "custom", customType: SUBAGENT_META_TYPE, data: metadata({ ...snapshot(), ...invalid }) }]), null);
  assert.deepEqual(readSubagentSessionResources([{ type: "custom", customType: SUBAGENT_META_TYPE, data: metadata(snapshot({ mcpServers: profile.mcpServers })) }]).mcpServers, profile.mcpServers);
});

test("SDK merge winner scope, shadowing, lost-project no fallback, namespace collision and case remain exact", async (t) => {
  const f = await fixture(t, snapshot({ loadMcp: true, mcpServers: [{ scope: "global", name: "selected" }] }));
  await mkdir(join(f.cwd, ".pi"));
  await writeFile(join(f.cwd, ".pi", "mcp.json"), JSON.stringify({ mcpServers: { selected: config() } }));
  const trust = new sdk.ProjectTrustStore(f.agentDir); trust.set(f.cwd, true);
  let before = resolutions;
  f.faux.setResponses([() => fauxAssistantMessage([fauxText("shadow")])]); await f.wrapper.promptDelegated("shadow");
  assert.equal(resolutions, before, "selected global shadowed by trusted project is not connected separately or promoted");
  const g = await fixture(t, snapshot({ loadMcp: true, mcpServers: [{ scope: "project", name: "selected" }] }));
  await mkdir(join(g.cwd, ".pi")); await writeFile(join(g.cwd, ".pi", "mcp.json"), JSON.stringify({ mcpServers: { selected: config() } }));
  new sdk.ProjectTrustStore(g.agentDir).set(g.cwd, true);
  assert.equal((await execute(g, [["mcp__selected__inspect", {}]]))[0].isError, false);
  before = resolutions;
  await rm(join(g.cwd, ".pi", "mcp.json"));
  g.faux.setResponses([() => fauxAssistantMessage([fauxText("lost")])]); await g.wrapper.promptDelegated("lost");
  assert.equal(resolutions, before, "lost selected project never falls back to same-name global");
  const collision = await fixture(t, snapshot({ loadMcp: true, mcpServers: [{ scope: "global", name: "a_b" }] }), {}, { "a-b": config(), a_b: config() });
  before = resolutions; collision.faux.setResponses([() => fauxAssistantMessage([fauxText("collision")])]); await collision.wrapper.promptDelegated("collision"); assert.equal(resolutions, before);
  const caseSensitive = await fixture(t, snapshot({ loadMcp: true, mcpServers: [{ scope: "global", name: "selected" }] }), {}, { Selected: config() });
  before = resolutions; caseSensitive.faux.setResponses([() => fauxAssistantMessage([fauxText("case")])]); await caseSensitive.wrapper.promptDelegated("case"); assert.equal(resolutions, before);
});

test("same selected ID accepts current config; new IDs never connect, and children hold independent transports with idle/disposal", async (t) => {
  const resources = snapshot({ loadMcp: true, mcpServers: [{ scope: "global", name: "selected" }] });
  const a = await fixture(t, resources), b = await fixture(t, resources);
  await execute(a, [["mcp__selected__inspect", {}]]); const first = connections.at(-1);
  await execute(b, [["mcp__selected__inspect", {}]]); const second = connections.at(-1);
  assert.notEqual(first, second);
  assert.equal(first.closed, false); assert.equal(second.closed, false);
  const before = connections.length;
  await writeFile(join(a.agentDir, "mcp.json"), JSON.stringify({ mcpServers: { selected: { ...config(), url: "https://fixture.invalid/updated", headers: { Authorization: "fixture-updated" } }, newId: config() } }));
  assert.equal((await execute(a, [["mcp__selected__inspect", {}]]))[0].isError, false);
  assert.equal(connections.length, before + 1); assert.equal(connections.at(-1).entry.config.url, "https://fixture.invalid/updated");
  assert.equal(first.closed, true); assert.equal(second.closed, false);
  await a.services.mcpHost.release(); await until(() => connections.at(-1).closed);
  const released = connections.length; await execute(a, [["mcp__selected__inspect", {}]]); assert.equal(connections.length, released + 1);
  await a.wrapper.shutdown(); assert.equal(connections.at(-1).closed, true); assert.equal(second.closed, false);
});

test("child factory refuses unadmitted registration/late owner/old released closure before DefaultFactory resolution", async (t) => {
  const cwd = join(root, "unit-cwd"), agentDir = join(root, "unit-agent");
  let registration, refused = false, defaultCalls = 0;
  const hooks = new Map();
  const pi = {
    on: (event, fn) => hooks.set(event, fn),
    getCommands: () => [{ name: "mcp", sourceInfo: { path: "builtin:mcp", source: "builtin" } }],
    getAllTools: () => [],
    getActiveTools: () => [],
    setActiveTools: () => {},
    getMcpServers: () => registration ? [structuredClone(registration)] : [],
    registerMcpServer: (name, value) => { if (refused) throw Error('is already registered by extension "foreign"'); registration = { name, config: structuredClone(value), extensionPath: MCP_HOST_EXTENSION_PATH }; },
    unregisterMcpServer: () => { registration = undefined; },
  };
  const host = new McpHost({ agentDir, internals: { loadMcpConfig: () => ({ servers: [{ name: "selected", config: config(), scope: "global", source: join(agentDir, "mcp.json") }], errors: [] }) }, selection: { cwd, servers: [{ scope: "global", name: "selected" }] }, codemodeAvailable: () => false, idleMs: 0, replaceWaitMs: 1 });
  const factory = host.wrapTransportFactory(() => { defaultCalls++; return new FakeTransport({ name: "unit" }); }, true);
  host.extension().factory(pi); hooks.get("session_start")({}, { cwd, sessionManager: { getSessionId: () => "unit" }, isIdle: () => true });
  const entry = { name: "selected", config: config(), scope: "extension", source: MCP_HOST_EXTENSION_PATH };
  assert.throws(() => factory(entry, cwd), /not admitted/);
  registration = { name: "selected", config: config(), extensionPath: "foreign" }; refused = true;
  await host.prepareForPrompt(new AbortController().signal, { wait: false });
  assert.throws(() => factory(entry, cwd), /not admitted/); assert.equal(defaultCalls, 0, "same-config registration collision cannot run value resolution");
  refused = false; registration = undefined; await host.prepareForPrompt(new AbortController().signal, { wait: false });
  registration.extensionPath = "late-foreign";
  assert.throws(() => factory(entry, cwd), /not admitted/); assert.equal(defaultCalls, 0);
  registration.extensionPath = MCP_HOST_EXTENSION_PATH;
  assert.throws(() => factory({ ...entry, scope: "global" }, cwd), /not admitted/);
  assert.throws(() => factory({ ...entry, source: "<inline:other>" }, cwd), /not admitted/);
  factory(entry, cwd); assert.equal(defaultCalls, 1, "copy objects are admitted by public owner/config, not WeakSet");
  await host.release(); assert.throws(() => factory(entry, cwd), /not admitted/); assert.equal(defaultCalls, 1);
  host.dispose(); assert.throws(() => factory(entry, cwd), /not admitted/); assert.equal(defaultCalls, 1);
  const nextFactory = host.wrapTransportFactory(() => { defaultCalls++; return new FakeTransport({ name: "unit-next" }); }, true);
  host.extension().factory(pi); hooks.get("session_start")({}, { cwd, sessionManager: { getSessionId: () => "unit" }, isIdle: () => true });
  await host.prepareForPrompt(new AbortController().signal, { wait: false });
  assert.throws(() => factory(entry, cwd), /not admitted/, "late old closure cannot claim the same-config new runtime attempt"); assert.equal(defaultCalls, 1);
  nextFactory(entry, cwd); assert.equal(defaultCalls, 2); host.dispose();
  t.diagnostic(JSON.stringify({ foreignAndReleasedDefaultFactoryResolution: 0, network: 0 }));
});

test("first actual controller request and resume declare selected direct MCP; preparation Stop/parent abort make zero provider requests and bind once", async (t) => {
  const cwd = await mkdtemp(join(root, "controller-")), agentDir = process.env.PI_CODING_AGENT_DIR;
  await mkdir(join(cwd, ".pi", "agents"), { recursive: true });
  await writeFile(join(cwd, ".pi", "agents", "mcp-child.md"), "---\ntools: read\nload_mcp: true\nmcp_servers:\n  - scope: global\n    name: controller\n---\nFixture");
  await writeFile(join(agentDir, "mcp.json"), JSON.stringify({ mcpServers: { controller: config(), unselected: config() } }));
  const faux = fauxProvider({ models: [{ id: "controller-faux" }] });
  const runtime = await sdk.ModelRuntime.create({ authPath: join(cwd, "auth.json"), modelsPath: null, refreshOnCreate: false }); runtime.registerNativeProvider(faux.provider);
  const manager = sdk.SessionManager.inMemory(cwd), wrappers = new Map();
  const parent = { cwd, sessionFile: join(cwd, "parent.jsonl"), isAlive: () => true, isRunning: () => false, waitUntilReady: async () => {}, inner: { sessionManager: manager, modelRuntime: runtime, model: faux.getModel("controller-faux"), agent: { state: {} } } };
  wrappers.set(manager.getSessionId(), parent);
  let requests = 0, binds = 0;
  const controller = createSubagentController({ getSession: (id) => wrappers.get(id), registerSession(inner, options) {
    const bind = inner.bindExtensions.bind(inner); inner.bindExtensions = (...args) => { binds++; return bind(...args); };
    const wrapper = new AgentSessionWrapper(inner, { ...options, subagentResources: readSubagentSessionResources(inner.sessionManager.getEntries()) }); wrappers.set(inner.sessionId, wrapper); wrapper.beginExtensionBinding(); return wrapper.waitUntilReady();
  }, reopenSession: async (id) => wrappers.get(id), resolveSessionPath: async () => null, invalidateSessionList: () => {}, isBuiltInSubagentsEnabled: () => true });
  t.after(async () => { paused.clear(); for (const wrapper of wrappers.values()) if (wrapper !== parent) await wrapper.destroy(); runtime.dispose?.(); });
  const response = (context) => {
    requests++;
    const declarations = context.messages.filter((m) => m.role === "system").flatMap((m) => m.toolsAdded ?? []);
    assert.ok(declarations.some((tool) => tool.name === "mcp__controller__inspect"), "selected direct MCP must be declared in the first actual SDK request");
    assert.ok(!declarations.some((tool) => tool.name.startsWith("mcp__unselected")));
    return fauxAssistantMessage([fauxToolCall("mcp__controller__inspect", {})], { stopReason: "toolUse" });
  };
  faux.setResponses([response, () => fauxAssistantMessage([fauxText("finished")])]);
  const request = { parentContext: parent.inner, profile: "mcp-child", parentToolCallId: "parent-call", description: "Fixture", task: "Fixture" };
  const executionsBefore = calls.filter(([server, tool]) => server === "controller" && tool === "inspect").length;
  const first = await controller.extensionRuntime.start(request); assert.equal((await first.completion).status, "completed"); assert.equal(requests, 1); assert.equal(binds, 1);
  assert.equal(calls.filter(([server, tool]) => server === "controller" && tool === "inspect").length, executionsBefore + 1);
  assert.ok(connections.some((transport) => transport.entry.name === "controller"));
  assert.ok(!connections.some((transport) => transport.entry.name === "unselected"));
  faux.setResponses([response, () => fauxAssistantMessage([fauxText("resumed")])]);
  const resumed = await controller.extensionRuntime.resume({ ...request, sessionId: first.run.sessionId }); assert.equal((await resumed.completion).status, "completed"); assert.equal(requests, 2); assert.equal(binds, 1);
  assert.equal(calls.filter(([server, tool]) => server === "controller" && tool === "inspect").length, executionsBefore + 2);
  for (const cancel of ["Stop", "parent"]) {
    paused.add("controller"); const before = requests, beforeConnections = connections.length, signal = new AbortController();
    const run = await controller.extensionRuntime.start({ ...request, signal: signal.signal });
    await until(() => connections.length > beforeConnections);
    if (cancel === "Stop") await controller.abort(run.run.sessionId); else signal.abort();
    assert.equal((await run.completion).status, "aborted"); assert.equal(requests, before); paused.delete("controller");
    for (const transport of connections.slice(beforeConnections)) await transport.close();
  }
  assert.equal(binds, 3);
  t.diagnostic(JSON.stringify({ firstAndResumeSDKRequests: requests, actualSelectedToolExecutions: 2, cancelledRequests: 0, singleBindPerChild: true, excludedServerFactory: 0 }));
});

test("cold v1/v2 restoration and reload ignore new profile/settings capability flags; v3 stays frozen and malformed fails closed", async (t) => {
  const f = await fixture(t), oldAgent = process.env.PI_CODING_AGENT_DIR, createRuntime = sdk.ModelRuntime.create;
  process.env.PI_CODING_AGENT_DIR = f.agentDir; sdk.ModelRuntime.create = async () => f.runtime;
  t.after(() => { process.env.PI_CODING_AGENT_DIR = oldAgent; sdk.ModelRuntime.create = createRuntime; });
  await mkdir(join(f.cwd, ".pi", "agents"), { recursive: true });
  await writeFile(join(f.cwd, ".pi", "agents", "widened.md"), "---\ntools: all\ncode_mode: true\nload_mcp: true\nmcp_servers: [{scope: global, name: selected}]\n---\nWidened");
  await writeFile(join(f.agentDir, "settings.json"), JSON.stringify({ defaultTools: ["+codemode", "+tool_search", "+powershell"], cacheWarming: "off" }));
  const persist = (value) => {
    const manager = sdk.SessionManager.create(f.cwd, join(f.dir, `sessions-${Math.random()}`));
    manager.appendCustomEntry(SUBAGENT_META_TYPE, { ...metadata(value), profile: "widened" });
    manager.appendMessage(fauxAssistantMessage([fauxText("persist fixture")])); return manager;
  };
  for (const version of [1, 2]) {
    const manager = persist(version === 1 ? { ...snapshot({ codeMode: true, loadMcp: true }), version: 1, tools: ["read"] } : { ...snapshot({ codeMode: true, loadMcp: true }), version: 2 });
    const before = resolutions;
    const { session: cold } = await startRpcSession(manager.getSessionId(), manager.getSessionFile(), f.cwd); t.after(() => cold.destroy());
    await cold.waitUntilReady(); assert.equal(cold.inner.getAllTools().some((tool) => ["codemode", "tool_search"].includes(tool.name)), false);
    f.faux.setResponses([() => fauxAssistantMessage([fauxText("old")])]); await cold.promptDelegated("old");
    await cold.send({ type: "reload" }); assert.equal(resolutions, before);
  }
  const resources = snapshot({ codeMode: true, loadMcp: true, mcpServers: [{ scope: "global", name: "selected" }] });
  const manager = persist(resources);
  await writeFile(join(f.cwd, ".pi", "agents", "widened.md"), "---\ntools: all\ncode_mode: false\nload_mcp: false\n---\nChanged");
  const { session: cold } = await startRpcSession(manager.getSessionId(), manager.getSessionFile(), f.cwd); t.after(() => cold.destroy()); await cold.waitUntilReady();
  f.faux.setResponses([() => fauxAssistantMessage([fauxToolCall("mcp__selected__inspect", {})], { stopReason: "toolUse" }), () => fauxAssistantMessage([fauxText("done")])]); await cold.promptDelegated("frozen");
  assert.equal(cold.inner.messages.filter((m) => m.role === "toolResult").at(-1).isError, false);
  assert.equal(cold.inner.getActiveToolNames().includes("powershell"), false); assert.equal(cold.inner.getActiveToolNames().includes("codemode"), true);
  await cold.send({ type: "reload" }); assert.equal(cold.inner.getActiveToolNames().includes("codemode"), true);
  const invalid = persist({ ...resources, loadMcp: undefined }); const before = resolutions;
  await assert.rejects(startRpcSession(invalid.getSessionId(), invalid.getSessionFile(), f.cwd), /invalid resource snapshot/); assert.equal(resolutions, before);
});

test("host capabilities with extensions None never import excluded modules; external replacement needs explicit resource/tool policy", async (t) => {
  const f = await fixture(t), path = join(f.agentDir, "extensions", "replacement.ts");
  await mkdir(join(f.agentDir, "extensions"));
  globalThis.__childExcludedModule = 0; globalThis.__childReplacementCalls = 0;
  t.after(() => { delete globalThis.__childExcludedModule; delete globalThis.__childReplacementCalls; });
  await writeFile(path, `globalThis.__childExcludedModule++; export default function(pi) { pi.registerTool({ name:'codemode',label:'External',description:'External replacement',parameters:{type:'object',properties:{}},execute:async()=>{globalThis.__childReplacementCalls++;return {content:[{type:'text',text:'external'}],details:undefined};} }); }`);
  const create = async (resources) => {
    const services = await createSubagentSessionServices({ cwd: f.cwd, agentDir: f.agentDir, modelRuntime: f.runtime, settingsManager: sdk.SettingsManager.create(f.cwd, f.agentDir) }, resources);
    const { session } = await sdk.createAgentSessionFromServices({ services, sessionManager: sdk.SessionManager.inMemory(f.cwd), model: f.faux.getModel("child-faux"), noTools: "builtin", excludeTools: subagentToolExclusions(resources.builtinTools) });
    const wrapper = new AgentSessionWrapper(session, { subagentResources: { ...resources, tools: resources.builtinTools }, mcpHost: services.mcpHost }); wrapper.beginExtensionBinding(); await wrapper.waitUntilReady(); t.after(() => wrapper.destroy()); return { ...f, session, wrapper, services };
  };
  const isolated = await create(snapshot({ codeMode: true, loadMcp: true })); await execute(isolated, [["codemode", { code: "return 42" }]]);
  assert.equal(globalThis.__childExcludedModule, 0); assert.equal(globalThis.__childReplacementCalls, 0);
  const granted = await create(snapshot({ codeMode: true, loadExtensions: true, extensions: [path], toolPolicy: { mode: "selectors", selectors: ["ext:replacement"], deny: [] } }));
  assert.equal(granted.session.getAllTools().find((tool) => tool.name === "codemode").sourceInfo.path, path);
  assert.equal((await execute(granted, [["codemode", {}]]))[0].isError, false); assert.equal(globalThis.__childReplacementCalls, 1);
  const denied = await create(snapshot({ codeMode: true, loadExtensions: true, extensions: [path], toolPolicy: { mode: "none", selectors: [], deny: [] } }));
  assert.equal((await execute(denied, [["codemode", {}]]))[0].isError, true); assert.equal(globalThis.__childReplacementCalls, 1, "role Code mode grants no foreign replacement execution");
});

test("builtin only-mode description and discovery list permitted tools only; models.classify/generateImages are unavailable with zero catalog/provider calls", async (t) => {
  const f = await fixture(t, snapshot({ codeMode: true, loadMcp: true, mcpServers: [{ scope: "global", name: "selected" }], toolPolicy: { mode: "none", selectors: [], deny: ["ext:builtin:mcp/mcp__selected__mutate"] } }), { codemode: { mode: "only" } });
  let catalogCalls = 0;
  for (const name of ["getModelsOfType", "getAvailableOfType", "getModelOfType"]) if (typeof f.runtime[name] === "function") t.mock.method(f.runtime, name, () => { catalogCalls++; throw Error("models API forbidden"); });
  const [result] = await execute(f, [["codemode", { code: "return { tools: ALL_TOOLS.map(t => t.name), classifier: typeof models === 'undefined' ? 'unavailable' : await models.classify({}, {}), image: typeof models === 'undefined' ? 'unavailable' : await models.generateImages({}, {}) }" }]]);
  assert.equal(result.isError, false); const text = JSON.stringify(result.content); assert.match(text, /unavailable/); assert.ok(text.includes("mcp__selected__inspect")); assert.ok(!text.includes("mcp__selected__mutate")); assert.equal(catalogCalls, 0);
  const description = f.session.agent.state.tools.find((tool) => tool.name === "codemode").description;
  assert.ok(description.includes("mcp__selected")); assert.ok(!description.includes("mutate")); assert.ok(!description.includes("models.classify"));
  const before = calls.length; const [denied] = await execute(f, [["codemode", { code: "return await tools.mcp__selected__mutate({})" }]]); assert.equal(denied.isError, true); assert.equal(calls.length, before);
});

test("v3 capabilities reject missing delegated/readiness/host boundaries with zero real provider/tool requests", async (t) => {
  const f = await fixture(t), parentManager = sdk.SessionManager.inMemory(f.cwd);
  const parent = { cwd: f.cwd, sessionFile: join(f.cwd, "parent.jsonl"), isAlive: () => true, isRunning: () => false, waitUntilReady: async () => {}, inner: { sessionManager: parentManager, modelRuntime: f.runtime, model: f.faux.getModel("child-faux"), agent: { state: {} } } };
  await mkdir(join(f.cwd, ".pi", "agents"), { recursive: true });
  let providers = 0, tools = 0, bypasses = 0;
  for (const mode of ["code-no-wrapper", "mcp-no-wrapper", "code-no-ready", "mcp-wrapper-no-host"]) {
    const mcp = mode.startsWith("mcp");
    await writeFile(join(f.cwd, ".pi", "agents", "missing.md"), `---\ntools: read\ncode_mode: ${!mcp}\nload_mcp: ${mcp}\nmcp_servers: []\n---\nFixture`);
    const wrappers = new Map([[parentManager.getSessionId(), parent]]);
    f.faux.setResponses([() => { providers++; return fauxAssistantMessage([fauxText("must not run")]); }]);
    const controller = createSubagentController({ getSession: (id) => wrappers.get(id), registerSession(inner, options) {
      t.after(() => inner.dispose()); inner.subscribe((event) => { if (event.type === "tool_execution_start") tools++; });
      if (mode.endsWith("no-wrapper")) return;
      if (mode === "code-no-ready") { wrappers.set(inner.sessionId, { inner, isAlive: () => true, isRunning: () => false, promptDelegated: async () => { bypasses++; } }); return; }
      assert.ok(options.mcpHost, "actual services supplied a host; the faulty registration omits it");
      const wrapper = new AgentSessionWrapper(inner, { subagentResources: readSubagentSessionResources(inner.sessionManager.getEntries()) });
      wrappers.set(inner.sessionId, wrapper); wrapper.beginExtensionBinding(); t.after(() => wrapper.destroy()); return wrapper.waitUntilReady();
    }, reopenSession: async (id) => wrappers.get(id), resolveSessionPath: async () => null, invalidateSessionList: () => {}, isBuiltInSubagentsEnabled: () => true });
    const run = await controller.extensionRuntime.start({ parentContext: parent.inner, parentToolCallId: "missing", profile: "missing", description: "Missing", task: "must not run" });
    const result = await run.completion; assert.equal(result.status, "failed", mode); assert.match(result.error, /require.*(preparation|host)/i);
    assert.equal(providers, 0); assert.equal(tools, 0); assert.equal(bypasses, 0);
  }
  t.diagnostic(JSON.stringify({ missingBoundaryCases: 4, actualProviderRequests: providers, actualToolExecutions: tools, fakeDelegatedBypasses: bypasses }));
});

test("aggregate resources fail closed while registry revocation precedes SDK catalog reconciliation", async (t) => {
  const f = await fixture(t), path = join(f.agentDir, "barrier.ts");
  let entered, release;
  const enteredPromise = new Promise((resolve) => { entered = resolve; });
  const barrier = new Promise((resolve) => { release = resolve; });
  globalThis.__childResourceBarrier = { enabled: false, entered, barrier };
  await writeFile(path, `export default function(pi) { pi.on('mcp_servers_change', async () => { const gate=globalThis.__childResourceBarrier; if(gate?.enabled) { gate.entered(); await gate.barrier; } }); }`);
  const resources = snapshot({ loadMcp: true, loadExtensions: true, extensions: [path], mcpServers: [{ scope: "global", name: "kept" }, { scope: "global", name: "revoked" }] });
  await writeFile(join(f.agentDir, "mcp.json"), JSON.stringify({ mcpServers: { kept: config(), revoked: config() } }));
  const services = await createSubagentSessionServices({ cwd: f.cwd, agentDir: f.agentDir, modelRuntime: f.runtime, settingsManager: sdk.SettingsManager.create(f.cwd, f.agentDir) }, resources);
  const { session } = await sdk.createAgentSessionFromServices({ services, sessionManager: sdk.SessionManager.inMemory(f.cwd), model: f.faux.getModel("child-faux"), noTools: "builtin", excludeTools: subagentToolExclusions(resources.builtinTools) });
  const wrapper = new AgentSessionWrapper(session, { subagentResources: { ...resources, tools: resources.builtinTools }, mcpHost: services.mcpHost }); wrapper.beginExtensionBinding(); await wrapper.waitUntilReady();
  t.after(async () => { release(); delete globalThis.__childResourceBarrier; await wrapper.destroy(); });
  const target = { ...f, services, session, wrapper };
  assert.equal((await execute(target, [["list_mcp_resources", {}]]))[0].isError, false);
  globalThis.__childResourceBarrier.enabled = true;
  await writeFile(join(f.agentDir, "mcp.json"), JSON.stringify({ mcpServers: { kept: config() } }));
  const preparing = services.mcpHost.prepareForPrompt(new AbortController().signal, { wait: false });
  try {
    await enteredPromise; await preparing;
    // The ordinary registry now contains only kept, but the earlier handler holds
    // the SDK's resource catalog at kept+revoked. Do not replace that catalog.
    const requestsBefore = connections.reduce((sum, transport) => sum + transport.requests.length, 0);
    f.faux.setResponses([() => fauxAssistantMessage([fauxToolCall("list_mcp_resources", {})], { stopReason: "toolUse" }), () => fauxAssistantMessage([fauxText("done")])]);
    await session.prompt("aggregate revocation window");
    assert.equal(connections.reduce((sum, transport) => sum + transport.requests.length, 0), requestsBefore, "blocked aggregate executes zero remote requests");
    const result = session.messages.filter((message) => message.role === "toolResult").at(-1);
    assert.equal(result.isError, true, JSON.stringify(result.content));
  } finally { globalThis.__childResourceBarrier.enabled = false; release(); }
  await until(() => connections.filter((transport) => transport.entry.name === "revoked").every((transport) => transport.closed));
  // Declaration never consults the consumed roster, so the catalog lag must not prune
  // the aggregate into a dead state; recovery comes from the SDK's own catalog reload.
  assert.ok(session.getActiveToolNames().includes("list_mcp_resources"), "catalog lag does not prune the aggregate");
  await delay(30);
  const [recovered] = await execute(target, [["list_mcp_resources", {}]]);
  assert.equal(recovered.isError, false); assert.ok(!JSON.stringify(recovered.content).includes("revoked"));
  t.diagnostic(JSON.stringify({ aggregateRevocationWindowRequests: 0, recoveredViaSdkCatalog: true, catalogMutation: false }));
});

test("explicitly disabled aggregate during a held catalog reconciliation stays off with zero extra requests", async (t) => {
  const f = await fixture(t), path = join(f.agentDir, "off-barrier.ts");
  let entered, release;
  const enteredPromise = new Promise((resolve) => { entered = () => {
    assert.equal(session.getActiveToolNames().includes("list_mcp_resources"), true, "active before explicit off");
    session.setActiveToolsByName(session.getActiveToolNames().filter((name) => name !== "list_mcp_resources"));
    assert.equal(session.getActiveToolNames().includes("list_mcp_resources"), false, "explicit off took effect");
    resolve();
  }; });
  const barrier = new Promise((resolve) => { release = resolve; });
  globalThis.__childResourceBarrier = { enabled: false, entered, barrier };
  await writeFile(path, `export default function(pi) { pi.on('mcp_servers_change', async () => { const gate=globalThis.__childResourceBarrier; if(gate?.enabled) { gate.entered(); await gate.barrier; } }); }`);
  const resources = snapshot({ loadMcp: true, loadExtensions: true, extensions: [path], mcpServers: [{ scope: "global", name: "kept" }, { scope: "global", name: "revoked" }] });
  await writeFile(join(f.agentDir, "mcp.json"), JSON.stringify({ mcpServers: { kept: config(), revoked: config() } }));
  const services = await createSubagentSessionServices({ cwd: f.cwd, agentDir: f.agentDir, modelRuntime: f.runtime, settingsManager: sdk.SettingsManager.create(f.cwd, f.agentDir) }, resources);
  const { session } = await sdk.createAgentSessionFromServices({ services, sessionManager: sdk.SessionManager.inMemory(f.cwd), model: f.faux.getModel("child-faux"), noTools: "builtin", excludeTools: subagentToolExclusions(resources.builtinTools) });
  const wrapper = new AgentSessionWrapper(session, { subagentResources: { ...resources, tools: resources.builtinTools }, mcpHost: services.mcpHost }); wrapper.beginExtensionBinding(); await wrapper.waitUntilReady();
  t.after(async () => { release(); delete globalThis.__childResourceBarrier; await wrapper.destroy(); });
  const target = { ...f, services, session, wrapper };
  assert.equal((await execute(target, [["list_mcp_resources", {}]]))[0].isError, false);
  globalThis.__childResourceBarrier.enabled = true;
  await writeFile(join(f.agentDir, "mcp.json"), JSON.stringify({ mcpServers: { kept: config() } }));
  const preparing = services.mcpHost.prepareForPrompt(new AbortController().signal, { wait: false });
  try { await enteredPromise; await preparing; }
  finally { globalThis.__childResourceBarrier.enabled = false; release(); }
  await until(() => connections.filter((transport) => transport.entry.name === "revoked").every((transport) => transport.closed));
  await delay(30);
  assert.equal(session.getActiveToolNames().includes("list_mcp_resources"), false, "an explicit off survives catalog consumption without replay");
  const remoteBefore = connections.reduce((sum, transport) => sum + transport.requests.length, 0);
  const [rejected] = await execute(target, [["list_mcp_resources", {}]]);
  assert.equal(rejected.isError, true, "a disabled aggregate is not directly callable");
  assert.equal(connections.reduce((sum, transport) => sum + transport.requests.length, 0), remoteBefore, "a disabled aggregate executes zero remote requests");
  t.diagnostic(JSON.stringify({ explicitOffPreserved: true, directCallIsError: true, subsequentRemoteRequests: 0 }));
});
