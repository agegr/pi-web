import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const dir = await mkdtemp(join(tmpdir(), "pi-late-tools-sdk-"));
const oldHome = process.env.HOME, oldAgent = process.env.PI_CODING_AGENT_DIR;
process.env.HOME = join(dir, "home"); process.env.PI_CODING_AGENT_DIR = join(dir, "agent");
await mkdir(process.env.HOME); await mkdir(process.env.PI_CODING_AGENT_DIR);
after(async () => {
  if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome;
  if (oldAgent === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = oldAgent;
  await rm(dir, { recursive: true, force: true });
});
const { AgentSession, ModelRuntime, SettingsManager, SessionManager, createAgentSessionFromServices } = await import("@earendil-works/pi-coding-agent");
const { fauxProvider, fauxAssistantMessage, fauxToolCall, fauxText } = await import("@earendil-works/pi-ai");
const jiti = createJiti(import.meta.url);
const { createSubagentSessionServices } = await jiti.import("./subagent-resources.ts");
const { subagentToolExclusions, subagentToolPolicy } = await jiti.import("./subagent-tool-policy.ts");
const { listSubagentProfiles, readSubagentSessionResources, SUBAGENT_META_TYPE } = await jiti.import("./subagents.ts");
const { AgentSessionWrapper, startRpcSession } = await jiti.import("./rpc-manager.ts");

async function exists(path) { try { await access(path); return true; } catch { return false; } }
async function setup(t, selectors, deny = [], discovery = false) {
  const root = await mkdtemp(join(dir, "case-")), cwd = join(root, "cwd"), agentDir = join(root, "agent");
  await mkdir(cwd); await mkdir(agentDir); await mkdir(join(agentDir, "extensions"));
  const marker = join(root, "denied.marker"), allowedMarker = join(root, "browser.marker");
  const path = join(agentDir, "extensions", "browser.ts");
  await writeFile(path, `import fs from 'node:fs';
export default function(pi) {
  ${discovery ? `const registerLate = () => pi.registerTool({name:'discovery_denied',label:'Denied discovery',description:'Denied discovery',parameters:{type:'object',properties:{}},execute:async()=>{fs.appendFileSync(${JSON.stringify(marker)}, 'DISCOVERY EXECUTED');return {content:[],details:undefined};}});
  pi.on('resources_discover', () => { registerLate(); return {}; });
  pi.registerCommand('fixture-register-denied', {handler:async()=>{registerLate(); pi.setActiveTools([...pi.getActiveTools(), 'discovery_denied']);}});
  pi.registerCommand('fixture-reload', {handler:async(_args,ctx)=>{await ctx.reload();}});` : ""}
  pi.on('session_start', async () => {
    await new Promise(r => setTimeout(r, 25));
    const tool = (name, exposure, execute) => pi.registerTool({name,label:name,description:name,exposure,parameters:{type:'object',properties:{target:{type:'string'},file:{type:'string'}}},execute});
    const denied = async () => { fs.appendFileSync(${JSON.stringify(marker)}, 'executed\\n'); return {content:[],details:undefined}; };
    tool('browser_mock','direct',async (_id,args,_signal,_update,ctx) => {
      if (args.target) {
        try { return await ctx.executeTool(args.target, args.file ? {path:args.file,content:'DENIED'} : {}); }
        catch(error) { return {content:[{type:'text',text:error.message}],details:undefined}; }
      }
      fs.appendFileSync(${JSON.stringify(allowedMarker)}, 'executed\\n');
      return {content:[{type:'text',text:'browser mock ok'}],details:undefined};
    });
    tool('denied_deferred','deferred',denied);
    tool('denied_codemode','codemode',denied);
    tool('optional_hidden','hidden',denied);
    for(const name of ['Agent','get_subagent_result','steer_subagent','write','bash','powershell']) tool(name,'direct',denied);
  });
}`);
  const faux = fauxProvider({ models: [{ id: "late-faux" }] });
  const runtime = await ModelRuntime.create({ authPath: join(root, "auth.json"), modelsPath: null, refreshOnCreate: false });
  runtime.registerNativeProvider(faux.provider); t.after(() => runtime.dispose?.());
  const toolPolicy = { mode: selectors === undefined ? "implicitAll" : "selectors", selectors: selectors ?? [], deny };
  const resources = { version: 2, builtinTools: ["read"], tools: ["read"], toolPolicy, loadExtensions: true, loadSkills: false, extensions: [path], skills: false, appendSystemPrompt: ["Fixture"] };
  const services = await createSubagentSessionServices({ cwd, agentDir, modelRuntime: runtime, settingsManager: SettingsManager.create(cwd, agentDir), resourceLoaderOptions: { noPromptTemplates: true, noThemes: true, noContextFiles: true } }, resources);
  const { session } = await createAgentSessionFromServices({ services, sessionManager: SessionManager.inMemory(cwd), model: faux.getModel("late-faux"), noTools: "builtin", excludeTools: subagentToolExclusions(resources.builtinTools) });
  session.setActiveToolsByName([...resources.builtinTools, ...session.getActiveToolNames()]);
  const snapshot = structuredClone(resources); delete snapshot.tools;
  session.sessionManager.appendCustomEntry(SUBAGENT_META_TYPE, { version: 1, parentSessionId: "parent", parentSessionPath: "/parent", resourceSnapshot: snapshot });
  const wrapper = new AgentSessionWrapper(session, { subagentResources: readSubagentSessionResources(session.sessionManager.getEntries()) });
  t.after(() => wrapper.destroy());
  let binds = 0;
  const bind = session.bindExtensions.bind(session);
  session.bindExtensions = (...args) => { binds++; return bind(...args); };
  wrapper.beginExtensionBinding();
  return { root, cwd, agentDir, path, marker, allowedMarker, faux, runtime, session, wrapper, resources, binds: () => binds };
}

async function calls(f, calls) {
  f.faux.setResponses([
    () => fauxAssistantMessage(calls.map(([name, args]) => fauxToolCall(name, args)), { stopReason: "toolUse" }),
    () => fauxAssistantMessage([fauxText("done")]),
  ]);
  await f.session.prompt("fixture tools only");
  return f.session.messages.filter((message) => message.role === "toolResult").slice(-calls.length);
}

test("late approved browser is visible on first public read, directly and nested callable; denied execution markers stay zero", async (t) => {
  const f = await setup(t, undefined, ["ext:browser/denied_deferred", "ext:browser/denied_codemode"]);
  // No explicit wait before the first Tools page read: send waits for the existing bind.
  const tools = await f.wrapper.send({ type: "get_tools" });
  assert.equal(tools.find((tool) => tool.name === "browser_mock")?.active, true);
  assert.ok((await f.wrapper.send({ type: "get_state" })).activeToolNames.includes("browser_mock"));
  assert.equal(f.binds(), 1);
  assert.ok(!f.session.getActiveToolNames().some((name) => ["denied_deferred", "denied_codemode", "optional_hidden"].includes(name)));
  // Deferred/codemode remain registered and nested-callable despite being inactive.
  assert.ok(f.session.getCallableToolNames().includes("denied_deferred"));
  const direct = await calls(f, [["browser_mock", {}]]); assert.equal(direct[0].isError, false);
  const nested = await calls(f, [["browser_mock", { target: "browser_mock" }]]); assert.equal(nested[0].isError, false);
  assert.equal((await readFile(f.allowedMarker, "utf8")).trim().split("\n").length, 2);
  for (const target of ["denied_deferred", "denied_codemode", "write", "bash", "powershell", "Agent", "get_subagent_result", "steer_subagent"]) {
    const results = await calls(f, [[target, { path: join(f.root, "write.marker"), content: "DENIED" }], ["browser_mock", { target, file: join(f.root, "write.marker") }]]);
    assert.equal(results[0].isError, true, target);
    assert.equal(results[1].isError, true, target);
    assert.match(results[1].nestedCalls.calls[0].error, /denied|not found|not callable|not available/i, target);
  }
  assert.equal(await exists(f.marker), false); assert.equal(await exists(join(f.root, "write.marker")), false);
  assert.ok(!f.session.getAllTools().some((tool) => ["write", "bash", "powershell", "Agent", "get_subagent_result", "steer_subagent"].includes(tool.name)));
  t.diagnostic(JSON.stringify({ sdk: "1.0.0", lateBrowserActiveOnFirstGetTools: true, singleBind: f.binds(), browserDirectAndNested: 2, deniedDirectAndNestedMarker: 0, externalProviderRequests: 0, browserDaemonStarts: 0 }));
});

test("implicit All deny, cancelled explicit allow, None and late source collision never widen", async (t) => {
  for (const [selectors, deny] of [[undefined, ["ext:browser"]], [["ext:browser"], ["EXT:BROWSER/*"]], [[], []]]) {
    const f = await setup(t, selectors, deny);
    assert.equal((await f.wrapper.send({ type: "get_tools" })).find((tool) => tool.name === "browser_mock")?.active, false);
    const [result] = await calls(f, [["browser_mock", {}]]); assert.equal(result.isError, true);
    assert.equal(await exists(f.allowedMarker), false);
    await f.wrapper.send({ type: "reload" });
    assert.equal((await f.wrapper.send({ type: "get_tools" })).find((tool) => tool.name === "browser_mock")?.active, false);
  }
  const f = await setup(t, ["ext:winner"]);
  const collision = join(f.agentDir, "extensions", "winner.ts");
  await writeFile(collision, `import fs from 'node:fs'; export default function(pi) { pi.on('session_start',()=>pi.registerTool({name:'browser_mock',label:'Collision',description:'Collision',parameters:{type:'object',properties:{}},execute:async()=>{fs.appendFileSync(${JSON.stringify(f.marker)},'WINNER');return {content:[],details:undefined};}})); }`);
  f.resources.extensions.push(collision);
  // Recreate under the same creation policy; neither the winning name nor another grant authorizes it.
  const services = await createSubagentSessionServices({ cwd: f.cwd, agentDir: f.agentDir, modelRuntime: f.runtime, settingsManager: SettingsManager.create(f.cwd, f.agentDir) }, f.resources);
  const { session } = await createAgentSessionFromServices({ services, sessionManager: SessionManager.inMemory(f.cwd), model: f.faux.getModel("late-faux"), noTools: "builtin", excludeTools: subagentToolExclusions(["read"]) });
  t.after(() => session.dispose()); await session.bindExtensions({});
  assert.equal(session.getAllTools().find((tool) => tool.name === "browser_mock").sourceInfo.path, f.path, "SDK's first registered source wins, not the selected same-name loser");
  assert.ok(!session.getActiveToolNames().includes("browser_mock"));
  f.session = session;
  assert.equal((await calls(f, [["browser_mock", {}]]))[0].isError, true);
  assert.equal(await exists(f.marker), false);
  assert.equal(await exists(f.allowedMarker), false);
});

test("parse-time fully denied allow stays explicit; tools none stays None even with loaded extensions", async (t) => {
  const f = await setup(t);
  await mkdir(join(f.cwd, ".pi", "agents"), { recursive: true });
  for (const [name, tools, deny] of [["cancelled", "read, ext:browser", "ext:browser"], ["none", "none", ""]]) {
    await writeFile(join(f.cwd, ".pi", "agents", `${name}.md`), `---\ntools: ${tools}\nload_extensions: true\ndisallowed_tools: ${deny}\n---\nFixture`);
    const profile = listSubagentProfiles(f.cwd).find((profile) => profile.name === name);
    const policy = subagentToolPolicy(profile);
    assert.equal(policy.mode, name === "none" ? "none" : "selectors");
    assert.deepEqual(policy.selectors, name === "none" ? [] : ["ext:browser"]);
  }
});

test("v1 cold restore/reload retains hardallow and never adds late browser; malformed v2 refuses restore", async (t) => {
  const f = await setup(t);
  await f.wrapper.waitUntilReady();
  const manager = SessionManager.create(f.cwd, join(f.root, "sessions"));
  const meta = { version: 1, parentSessionId: "parent", parentSessionPath: "/parent", resourceSnapshot: { version: 1, tools: ["read"], appendSystemPrompt: [], loadSkills: false, loadExtensions: true, extensions: [f.path] } };
  manager.appendCustomEntry(SUBAGENT_META_TYPE, meta);
  manager.appendMessage(fauxAssistantMessage([fauxText("persist fixture")]));
  const originalCreate = ModelRuntime.create, oldAgent = process.env.PI_CODING_AGENT_DIR;
  ModelRuntime.create = async () => f.runtime; process.env.PI_CODING_AGENT_DIR = f.agentDir;
  t.after(() => { ModelRuntime.create = originalCreate; process.env.PI_CODING_AGENT_DIR = oldAgent; });
  const { session: wrapper } = await startRpcSession(manager.getSessionId(), manager.getSessionFile(), f.cwd);
  t.after(() => wrapper.destroy());
  assert.ok(!(await wrapper.send({ type: "get_tools" })).some((tool) => tool.name === "browser_mock"));
  await wrapper.send({ type: "reload" });
  assert.ok(!(await wrapper.send({ type: "get_tools" })).some((tool) => tool.name === "browser_mock"));
  const invalid = SessionManager.create(f.cwd, join(f.root, "invalid"));
  invalid.appendCustomEntry(SUBAGENT_META_TYPE, { ...meta, resourceSnapshot: { ...f.resources, toolPolicy: { mode: "implicitAll" } } });
  invalid.appendMessage(fauxAssistantMessage([fauxText("persist invalid")]));
  assert.equal(readSubagentSessionResources(invalid.getEntries()), null);
  await assert.rejects(startRpcSession(invalid.getSessionId(), invalid.getSessionFile(), f.cwd), /invalid resource snapshot/);
});

test("v2 cold restore freezes explicit denial and builtins despite wider profile/default settings", async (t) => {
  const f = await setup(t, ["ext:browser"], ["ext:browser/browser_mock"]);
  await f.wrapper.waitUntilReady();
  const manager = SessionManager.create(f.cwd, join(f.root, "sessions"));
  const snapshot = structuredClone(f.resources); delete snapshot.tools;
  manager.appendCustomEntry(SUBAGENT_META_TYPE, { version: 1, parentSessionId: "parent", parentSessionPath: "/parent", profile: "widened", resourceSnapshot: snapshot });
  manager.appendMessage(fauxAssistantMessage([fauxText("persist fixture")]));
  await mkdir(join(f.cwd, ".pi", "agents"), { recursive: true });
  await writeFile(join(f.cwd, ".pi", "agents", "widened.md"), "---\ntools: all, ext:*\nextensions: true\n---\nNew profile.");
  await writeFile(join(f.agentDir, "settings.json"), JSON.stringify({ defaultTools: ["powershell", "write", "+codemode"] }));
  const originalCreate = ModelRuntime.create, oldAgent = process.env.PI_CODING_AGENT_DIR;
  ModelRuntime.create = async () => f.runtime; process.env.PI_CODING_AGENT_DIR = f.agentDir;
  t.after(() => { ModelRuntime.create = originalCreate; process.env.PI_CODING_AGENT_DIR = oldAgent; });
  const { session: wrapper } = await startRpcSession(manager.getSessionId(), manager.getSessionFile(), f.cwd);
  t.after(() => wrapper.destroy());
  for (const reload of [false, true]) {
    if (reload) await wrapper.send({ type: "reload" });
    const tools = await wrapper.send({ type: "get_tools" });
    assert.equal(tools.find((tool) => tool.name === "browser_mock")?.active, false);
    assert.ok(!tools.some((tool) => ["powershell", "write"].includes(tool.name)));
    assert.deepEqual((await wrapper.send({ type: "get_state" })).activeToolNames, ["read"]);
  }
});

test("v2 reload rechecks real project trust for late tools and restores source metadata", async (t) => {
  const f = await setup(t, ["ext:project-browser"]);
  await f.wrapper.waitUntilReady();
  const { ProjectTrustStore } = await import("@earendil-works/pi-coding-agent");
  const trust = new ProjectTrustStore(f.agentDir);
  await mkdir(join(f.cwd, ".pi", "extensions"), { recursive: true });
  const project = join(f.cwd, ".pi", "extensions", "project-browser.ts");
  await writeFile(project, await readFile(f.path, "utf8"));
  f.resources.extensions = [project];
  trust.set(f.cwd, true);
  const services = await createSubagentSessionServices({ cwd: f.cwd, agentDir: f.agentDir, modelRuntime: f.runtime, settingsManager: SettingsManager.create(f.cwd, f.agentDir, { projectTrusted: true }) }, f.resources);
  const { session } = await createAgentSessionFromServices({ services, sessionManager: SessionManager.inMemory(f.cwd), model: f.faux.getModel("late-faux"), noTools: "builtin", excludeTools: subagentToolExclusions(["read"]) });
  t.after(() => session.dispose()); session.setActiveToolsByName(["read"]);
  await session.bindExtensions({ onError: (error) => { throw Error(error.message ?? error.error); } });
  assert.ok(session.getActiveToolNames().includes("browser_mock"));
  assert.equal(session.getAllTools().find((tool) => tool.name === "browser_mock").sourceInfo.scope, "project");
  trust.set(f.cwd, false); await session.reload();
  assert.ok(!session.getAllTools().some((tool) => tool.name === "browser_mock"));
  trust.set(f.cwd, true); await session.reload();
  assert.ok(session.getActiveToolNames().includes("browser_mock"));
  assert.equal(session.getAllTools().find((tool) => tool.name === "browser_mock").sourceInfo.scope, "project");
});

test("resources_discover tools reconcile after ready, cold restore, both reload paths and each public read without rebinding", async (t) => {
  const f = await setup(t, ["ext:browser/browser_mock"], [], true);
  const verify = async (wrapper) => {
    // Assert the completion boundary itself, BEFORE a public read can repair the loadout.
    assert.ok(wrapper.inner.getAllTools().some((tool) => tool.name === "discovery_denied"));
    assert.ok(!wrapper.inner.getActiveToolNames().includes("discovery_denied"));
    assert.ok(wrapper.inner.getActiveToolNames().includes("browser_mock"));
    const tools = await wrapper.send({ type: "get_tools" });
    assert.equal(tools.find((tool) => tool.name === "discovery_denied")?.active, false);
    assert.equal(tools.find((tool) => tool.name === "browser_mock")?.active, true);
    const state = await wrapper.send({ type: "get_state" });
    assert.ok(!state.activeToolNames.includes("discovery_denied"));
    assert.ok(state.activeToolNames.includes("browser_mock"));
    assert.equal(await exists(f.marker), false);
  };
  await f.wrapper.waitUntilReady(); await verify(f.wrapper);
  assert.equal(f.binds(), 1);

  // A late registration/activation AFTER readiness is reconciled by each read boundary.
  for (const type of ["get_tools", "get_state"]) {
    await f.session.prompt("/fixture-register-denied");
    assert.ok(f.session.getActiveToolNames().includes("discovery_denied"));
    const response = await f.wrapper.send({ type });
    if (type === "get_tools") assert.equal(response.find((tool) => tool.name === "discovery_denied")?.active, false);
    else assert.ok(!response.activeToolNames.includes("discovery_denied"));
    await verify(f.wrapper);
  }
  await f.wrapper.send({ type: "reload" }); await verify(f.wrapper);
  await f.session.prompt("/fixture-reload"); await verify(f.wrapper);
  assert.equal(f.binds(), 1, "reload uses the existing bindings, never a second bind");

  // Persist only the original validated creation snapshot, not current profile/settings.
  const manager = SessionManager.create(f.cwd, join(f.root, "discovery-sessions"));
  const metadata = f.session.sessionManager.getEntries().find((entry) => entry.type === "custom" && entry.customType === SUBAGENT_META_TYPE).data;
  manager.appendCustomEntry(SUBAGENT_META_TYPE, structuredClone(metadata));
  manager.appendMessage(fauxAssistantMessage([fauxText("persist fixture")]));
  const originalCreate = ModelRuntime.create, originalBind = AgentSession.prototype.bindExtensions;
  const previousAgent = process.env.PI_CODING_AGENT_DIR;
  let coldBinds = 0;
  ModelRuntime.create = async () => f.runtime; process.env.PI_CODING_AGENT_DIR = f.agentDir;
  AgentSession.prototype.bindExtensions = function (...args) {
    if (this.sessionId === manager.getSessionId()) coldBinds++;
    return originalBind.apply(this, args);
  };
  t.after(() => { ModelRuntime.create = originalCreate; AgentSession.prototype.bindExtensions = originalBind; process.env.PI_CODING_AGENT_DIR = previousAgent; });
  const { session: cold } = await startRpcSession(manager.getSessionId(), manager.getSessionFile(), f.cwd);
  t.after(() => cold.destroy());
  await cold.waitUntilReady(); await verify(cold);
  await cold.send({ type: "reload" }); await verify(cold);
  assert.equal(coldBinds, 1);
  f.session = cold.inner;
  assert.equal((await calls(f, [["browser_mock", {}]]))[0].isError, false);
  assert.equal((await calls(f, [["browser_mock", { target: "browser_mock" }]]))[0].isError, false);
  const [denied] = await calls(f, [["discovery_denied", {}]]);
  assert.equal(denied.isError, true); assert.equal(await exists(f.marker), false);
  t.diagnostic(JSON.stringify({ phase: "post-resources-discover", readyDeniedInactive: true, coldDeniedInactive: true, reloadDeniedInactive: true, latePublicReadsReconciled: true, initialBinds: f.binds(), coldBinds, deniedMarker: 0, externalProviderRequests: 0 }));
});
