import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fauxProvider, fauxAssistantMessage, fauxText, getCurrentSystemPrompt } from "@earendil-works/pi-ai";
import { createAgentSessionServices, createAgentSessionFromServices, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";
const { createSubagentSkillsBinding } = await createJiti(import.meta.url).import("./subagent-skills.ts");

async function fixture(t, options, tools = [], project = false, contribute = false) {
  const dir = await mkdtemp(join(tmpdir(), "skill-provider-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  async function skill(name, body, disabled = false) {
    const path = join(dir, "skills", name, "SKILL.md");
    await mkdir(join(dir, "skills", name), { recursive: true });
    await writeFile(path, `---\nname: ${name}\ndescription: ${name} routing\ndisable-model-invocation: ${disabled}\n---\n${body}`);
    return path;
  }
  const selectedPath = await skill("review", "SELECTED_BODY_V1", true);
  const contributedPath = join(dir, "EXTRA.md");
  if (contribute) await writeFile(contributedPath, "---\nname: extra\ndescription: Extra routing\n---\nEXTENSION_BODY");
  await skill("other", "UNSELECTED_BODY");
  const faux = fauxProvider({ models: [{ id: "faux-model" }] });
  const modelRuntime = await ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: null, refreshOnCreate: false });
  modelRuntime.registerNativeProvider(faux.provider);
  const binding = createSubagentSkillsBinding(options);
  const { projectTrustReloadOptions, trustProject } = await createJiti(import.meta.url).import("./project-trust.ts");
  if (project) {
    await mkdir(join(dir, ".agents", "skills", "project-only"), { recursive: true });
    await writeFile(join(dir, ".agents", "skills", "project-only", "SKILL.md"), "---\nname: project-only\ndescription: Project skill\n---\nTRUSTED_PROJECT_BODY");
  }
  const services = await createAgentSessionServices({ cwd: dir, agentDir: dir, modelRuntime,
    settingsManager: SettingsManager.inMemory(), resourceLoaderOptions: {
      noExtensions: true, noThemes: true, noPromptTemplates: true, noContextFiles: true,
      appendSystemPrompt: ["PROFILE_BODY"], ...binding.loaderOptions,
      extensionFactories: [
        ...(binding.loaderOptions.extensionFactories ?? []),
        ...(contribute ? [(pi) => { pi.on("resources_discover", () => ({ skillPaths: [contributedPath] })); }] : []),
      ],
    },
    ...(project ? { resourceLoaderReloadOptions: projectTrustReloadOptions(dir, dir) } : {}),
  });
  const { session } = await createAgentSessionFromServices({ services, sessionManager: SessionManager.inMemory(dir), model: faux.getModel("faux-model"), tools });
  binding.setActiveToolsGetter(() => session.getActiveToolNames());
  await session.bindExtensions({});
  t.after(() => session.dispose());
  async function prompt() {
    let captured;
    faux.setResponses([(context) => {
      captured = getCurrentSystemPrompt(context.messages);
      return fauxAssistantMessage([fauxText("completed")]);
    }]);
    await session.prompt("Do the task");
    assert.equal(session.getLastAssistantText(), "completed");
    return captured;
  }
  return { prompt, session, services, selectedPath, skill, binding, dir, faux, modelRuntime, trustProject };
}

for (const replace of [false, true]) {
  test(`named ${replace ? "replace" : "append"} reaches provider once without a read tool or public catalog`, async (t) => {
    const f = await fixture(t, { loadSkills: true, skills: ["review"], ...(replace ? { exactSystemPrompt: "REPLACE_PROFILE" } : {}) });
    const input = await f.prompt();
    assert.equal(input.split("SELECTED_BODY_V1").length - 1, 1);
    assert.ok(!input.includes("UNSELECTED_BODY"));
    assert.ok(!input.includes("<available_skills>"));
    assert.ok(!input.includes("disable-model-invocation:"));
    assert.ok(input.includes(f.selectedPath));
    assert.ok(input.includes(join(f.selectedPath, "..")));
    assert.ok(input.includes(replace ? "REPLACE_PROFILE" : "PROFILE_BODY"));
    assert.equal(input.includes("You are an expert coding assistant"), !replace);
    assert.deepEqual(f.services.resourceLoader.getSkills().skills, []);
  });
}

test("named files reread on each logical run and failures remain per-name nonfatal", async (t) => {
  const f = await fixture(t, { loadSkills: true, skills: ["review", "missing", "../unsafe", "later"] });
  let input = await f.prompt();
  assert.match(input, /missing.*not found/i);
  assert.match(input, /\.\.\/unsafe.*not found/i);
  await writeFile(f.selectedPath, "---\nname: review\ndescription: Updated\n---\nSELECTED_BODY_V2");
  input = await f.prompt();
  assert.ok(input.includes("SELECTED_BODY_V2"));
  assert.ok(!input.includes("SELECTED_BODY_V1"));
  await unlink(f.selectedPath);
  input = await f.prompt();
  assert.match(input, /review.*unreadable/i);
  await f.skill("later", "NEWLY_DISCOVERED");
  await f.session.reload();
  input = await f.prompt();
  assert.ok(input.includes("NEWLY_DISCOVERED"));
});

for (const replace of [false, true]) {
  test(`unbounded ${replace ? "replace" : "append"} advertises on demand without all bodies`, async (t) => {
    const f = await fixture(t, { loadSkills: true, ...(replace ? { exactSystemPrompt: "REPLACE_PROFILE" } : {}) }, ["read"]);
    const input = await f.prompt();
    assert.ok(input.includes("<available_skills>"));
    assert.ok(input.includes("other routing"));
    assert.ok(!input.includes("review routing"));
    assert.ok(!input.includes("UNSELECTED_BODY"));
    assert.ok(!input.includes("SELECTED_BODY_V1"));
  });
}

test("eligible extension-provided skills resolve privately for named preloads", async (t) => {
  const f = await fixture(t, { loadSkills: true, skills: ["extra"] }, [], false, true);
  const input = await f.prompt();
  assert.equal(input.split("EXTENSION_BODY").length - 1, 1);
  assert.ok(!input.includes("<available_skills>"));
  assert.deepEqual(f.services.resourceLoader.getSkills().skills, []);
});

test("mixed valid, missing, unreadable and path-like names complete together", async (t) => {
  const f = await fixture(t, { loadSkills: true, skills: ["review", "other", "missing", "../other/SKILL.md"] });
  await unlink(f.selectedPath);
  const input = await f.prompt();
  assert.ok(input.includes("UNSELECTED_BODY")); // other is explicitly selected in this case
  assert.equal(input.split("UNSELECTED_BODY").length - 1, 1); // a path is never resolved to a file
  assert.match(input, /review.*unreadable/i);
  assert.match(input, /missing.*not found/i);
  assert.match(input, /\.\.\/other\/SKILL\.md.*not found/i);
});

test("named reload follows the normal project trust gate", async (t) => {
  const f = await fixture(t, { loadSkills: true, skills: ["project-only"] }, [], true);
  const denied = await f.prompt();
  assert.match(denied, /project-only.*not found/i);
  assert.ok(!denied.includes("TRUSTED_PROJECT_BODY"));
  const previousDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = f.dir;
  t.after(() => { if (previousDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previousDir; });
  const { AgentSessionWrapper } = await createJiti(import.meta.url).import("./rpc-manager.ts");
  const wrapper = new AgentSessionWrapper(f.session);
  wrapper.start(); wrapper.beginExtensionBinding();
  t.after(() => wrapper.shutdown());
  await wrapper.waitUntilReady();
  f.trustProject(f.dir, f.dir);
  await wrapper.send({ type: "reload" });
  assert.ok((await f.prompt()).includes("TRUSTED_PROJECT_BODY"));
});

test("explicit off and empty selections never preload or advertise", async (t) => {
  for (const options of [{ loadSkills: false, skills: ["review"] }, { loadSkills: true, skills: [] }]) {
    const f = await fixture(t, options, ["read"]);
    const input = await f.prompt();
    assert.ok(!input.includes("SELECTED_BODY_V1"));
    assert.ok(!input.includes("<available_skills>"));
  }
});

for (const [mode, skills] of [["append", ["review"]], ["replace", ["review"]], ["append", []], ["replace", []]]) {
  test(`fresh child, live resume and RPC reopen retain ${mode} ${skills.length ? "named" : "empty"} scope and current bodies`, async (t) => {
    const f = await fixture(t, { loadSkills: false });
    const previousDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = f.dir;
    t.after(() => { if (previousDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previousDir; });
    const jiti = createJiti(import.meta.url);
    const { createSubagentController } = await jiti.import("./subagent-runtime.ts");
    const { saveProjectSubagentProfile, readSubagentSessionResources } = await jiti.import("./subagents.ts");
    const { AgentSessionWrapper, startRpcSession } = await jiti.import("./rpc-manager.ts");
    saveProjectSubagentProfile(f.dir, { name: "scoped", displayName: "Scoped", description: "Scoped",
      systemPrompt: "CHILD_PROFILE", tools: [], skills, loadSkills: true, loadExtensions: false,
      enabled: true, inheritContext: false, runInBackground: false, promptMode: mode });
    const parentId = f.session.sessionId;
    const wrappers = new Map();
    const parent = { inner: f.session, cwd: f.dir, sessionFile: join(f.dir, "parent.jsonl"), isAlive: () => true, isRunning: () => false };
    let child;
    const controller = createSubagentController({
      getSession: (id) => id === parentId ? parent : wrappers.get(id),
      registerSession(inner, options) {
        child = new AgentSessionWrapper(inner, options);
        child.start(); child.beginExtensionBinding(); wrappers.set(inner.sessionId, child);
      },
      reopenSession: async () => { throw new Error("unused"); }, resolveSessionPath: async () => child.sessionFile,
      invalidateSessionList() {}, isBuiltInSubagentsEnabled: () => true,
    });
    let input;
    function response() { f.faux.setResponses([(context) => { input = getCurrentSystemPrompt(context.messages); return fauxAssistantMessage([fauxText("completed")]); }]); }
    response();
    const execution = await controller.extensionRuntime.start({ parentContext: f.session, parentToolCallId: "start", profile: "scoped", task: "work", description: "work" });
    t.after(async () => { if (child?.isAlive()) await child.shutdown(); });
    assert.equal((await execution.completion).status, "completed");
    assert.equal(input.includes("SELECTED_BODY_V1"), skills.length > 0);
    assert.ok(!input.includes("<available_skills>"));
    assert.equal(input.includes("You are an expert coding assistant"), mode === "append");
    const resources = readSubagentSessionResources(child.inner.sessionManager.getEntries());
    assert.deepEqual(resources.skills, skills);
    assert.equal(resources.exactSystemPrompt, mode === "replace" ? "CHILD_PROFILE" : undefined);
    await writeFile(f.selectedPath, "---\nname: review\ndescription: Updated\n---\nRESUMED_BODY");
    response();
    const resumed = await controller.extensionRuntime.resume({ parentContext: f.session, parentToolCallId: "resume", sessionId: child.inner.sessionId, task: "again", description: "again" });
    assert.equal((await resumed.completion).status, "completed");
    assert.equal(input.includes("RESUMED_BODY"), skills.length > 0);
    assert.ok(!input.includes("SELECTED_BODY_V1"));
    const id = child.inner.sessionId, file = child.sessionFile;
    await child.shutdown();
    if (mode === "replace" && skills.length) {
      const original = await readFile(file, "utf8");
      const malformed = original.split("\n").filter(Boolean).map((line) => {
        const entry = JSON.parse(line);
        if (entry.customType === "pi-web:subagent") entry.data.resourceSnapshot.skills = [42];
        return JSON.stringify(entry);
      }).join("\n") + "\n";
      await writeFile(file, malformed);
      // A malformed list narrows to nothing; it never falls back to the whole catalog.
      const narrowed = await startRpcSession(id, file);
      assert.deepEqual(readSubagentSessionResources(narrowed.session.inner.sessionManager.getEntries()).skills, []);
      await narrowed.session.shutdown();
      await writeFile(file, original);
    }
    // Only replace provider construction: keep RPC resource discovery, persisted scope and prompt wiring real.
    const originalCreate = ModelRuntime.create;
    ModelRuntime.create = async (...args) => { const runtime = await originalCreate.apply(ModelRuntime, args); runtime.registerNativeProvider(f.faux.provider); return runtime; };
    t.after(() => { ModelRuntime.create = originalCreate; });
    await writeFile(f.selectedPath, "---\nname: review\ndescription: Updated\n---\nREOPENED_BODY");
    child = (await startRpcSession(id, file)).session;
    await child.waitUntilReady();
    response();
    await child.inner.prompt("reopened");
    assert.equal(input.includes("REOPENED_BODY"), skills.length > 0);
    assert.ok(!input.includes("RESUMED_BODY"));
    assert.deepEqual(readSubagentSessionResources(child.inner.sessionManager.getEntries()).skills, skills);
  });
}

test("unbounded replace catalog follows active read/bash tools", async (t) => {
  const f = await fixture(t, { loadSkills: true, exactSystemPrompt: "REPLACE_PROFILE" }, ["bash"]);
  f.session.setActiveToolsByName([]);
  assert.equal(await f.prompt(), "REPLACE_PROFILE");
  f.session.setActiveToolsByName(["bash"]);
  assert.ok((await f.prompt()).includes("<available_skills>"));
});
