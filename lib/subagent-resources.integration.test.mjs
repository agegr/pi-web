import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, access, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const sandbox = await mkdtemp(join(tmpdir(), "pi-resource-sdk-"));
const oldHome = process.env.HOME;
const oldAgent = process.env.PI_CODING_AGENT_DIR;
process.env.HOME = join(sandbox, "home");
process.env.PI_CODING_AGENT_DIR = join(sandbox, "agent");
await mkdir(process.env.HOME, { recursive: true });
await mkdir(process.env.PI_CODING_AGENT_DIR, { recursive: true });
after(async () => {
  if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome;
  if (oldAgent === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = oldAgent;
  await rm(sandbox, { recursive: true, force: true });
});
const { DefaultPackageManager, SettingsManager, ModelRuntime, SessionManager, ProjectTrustStore, createAgentSessionFromServices } = await import("@earendil-works/pi-coding-agent");
const { fauxProvider } = await import("@earendil-works/pi-ai");
const jiti = createJiti(import.meta.url);
const { createSubagentMemorySettings, createSubagentSessionServices } = await jiti.import("./subagent-resources.ts");
const { readSubagentResourceCatalog, selectCatalogResources, addExplicitResources, uniqueResourceDiagnostics } = await jiti.import("./subagent-resource-catalog.ts");
const { saveSubagentProfile, readSubagentSessionResources, SUBAGENT_META_TYPE } = await jiti.import("./subagents.ts");
const { createSubagentController } = await jiti.import("./subagent-runtime.ts");

async function file(path, contents) { await mkdir(join(path, ".."), { recursive: true }); await writeFile(path, contents); return path; }
async function exists(path) { try { await access(path); return true; } catch { return false; } }
function skill(name) { return `---\nname: ${name}\ndescription: Skill ${name}\n---\nInstructions for ${name}.\n`; }
async function fixture(t) {
  const dir = await mkdtemp(join(sandbox, "case-"));
  const cwd = join(dir, "cwd"), agentDir = join(dir, "agent");
  await mkdir(cwd); await mkdir(agentDir);
  const npmLog = join(dir, "npm.log");
  const npm = await file(join(dir, "npm.cjs"), `require('fs').appendFileSync(${JSON.stringify(npmLog)}, JSON.stringify(process.argv.slice(2))+'\\n'); if(process.argv.includes('root')) console.log(${JSON.stringify(join(dir, "global-node-modules"))}); else throw Error('installation/network forbidden');`);
  const markers = {};
  const ext = async (path, name, dynamic) => {
    const marker = join(dir, `${name}.marker`); markers[name] = marker;
    return file(path, `import fs from 'node:fs';\nfs.appendFileSync(${JSON.stringify(marker)}, 'top\\n');\nexport default function(pi) { fs.appendFileSync(${JSON.stringify(marker)}, 'factory\\n'); pi.registerTool({name:${JSON.stringify(name)},label:${JSON.stringify(name)},description:'Marker',parameters:{type:'object',properties:{}},execute:async()=>({content:[],details:undefined})});${dynamic ? `pi.on('resources_discover',()=>({skillPaths:[${JSON.stringify(dynamic)}]}));` : ""} }`);
  };
  const dynamic = await file(join(dir, "dynamic", "SKILL.md"), skill("dynamic"));
  const allowed = await ext(join(agentDir, "extensions", "allowed.ts"), "allowed", dynamic);
  const excluded = await ext(join(agentDir, "extensions", "excluded.ts"), "excluded");
  const project = await ext(join(cwd, ".pi", "extensions", "project", "index.ts"), "project");
  const one = await file(join(agentDir, "skills", "directory-one", "SKILL.md"), skill("effective-one"));
  const two = await file(join(cwd, ".agents", "skills", "two", "SKILL.md"), skill("two"));
  const packageRoot = join(agentDir, "npm", "node_modules", "@fixture", "short-package");
  const packaged = await ext(join(packageRoot, "src", "index.ts"), "package_tool");
  await file(join(packageRoot, "package.json"), JSON.stringify({ name: "@fixture/short-package", version: "1.0.0", pi: { extensions: ["src/index.ts"] } }));
  const global = { cacheWarming: "off", transport: "websocket", defaultTools: ["read"], shellPath: "/global-shell", extensions: [], skills: [], packages: ["npm:@fixture/short-package@1.0.0", "npm:@fixture/nonselected-missing@1.0.0"], npmCommand: [process.execPath, npm] };
  const local = { cacheWarming: "idle", transport: "sse", defaultTools: ["+grep"], shellCommandPrefix: "project-prefix" };
  await file(join(agentDir, "settings.json"), JSON.stringify(global));
  await file(join(cwd, ".pi", "settings.json"), JSON.stringify(local));
  const faux = fauxProvider({ models: [{ id: "resource-faux" }] });
  const runtime = await ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: null, refreshOnCreate: false });
  runtime.registerNativeProvider(faux.provider);
  t.after(() => runtime.dispose?.());
  const trust = new ProjectTrustStore(agentDir);
  const services = async (skills, extensions) => createSubagentSessionServices({ cwd, agentDir, modelRuntime: runtime, settingsManager: SettingsManager.create(cwd, agentDir, { projectTrusted: trust.get(cwd) === true }), resourceLoaderOptions: { noPromptTemplates: true, noThemes: true, noContextFiles: true } }, { skills, extensions, loadSkills: skills !== false, loadExtensions: extensions !== false });
  const count = async (name, phase = "factory") => (await exists(markers[name])) ? (await readFile(markers[name], "utf8")).split("\n").filter((line) => line === phase).length : 0;
  return { cwd, agentDir, dir, global, local, one, two, allowed, excluded, project, dynamic, packaged, markers, services, count, runtime, faux, trust, npmLog, ext };
}

test("scoped transient settings preserve global-only semantics and never write resource configuration", async () => {
  const global = { cacheWarming: "off", shellPath: "global", transport: "websocket", packages: ["npm:missing"], extensions: ["global.ts"], skills: ["global.md"] };
  const project = { cacheWarming: "idle", shellPath: "project", transport: "sse", extensions: ["project.ts"], themes: ["x"] };
  const source = SettingsManager.fromStorage({ withLock(scope, fn) { fn(JSON.stringify(scope === "global" ? global : project)); } });
  const transient = createSubagentMemorySettings(source);
  for (const scope of ["Global", "Project"]) {
    const actual = transient[`get${scope}Settings`](), expected = source[`get${scope}Settings`]();
    for (const key of ["packages", "extensions", "skills", "prompts", "themes"]) { assert.deepEqual(actual[key], []); delete actual[key]; delete expected[key]; }
    assert.deepEqual(actual, expected);
  }
  assert.equal(transient.getCacheWarmingMode(), source.getCacheWarmingMode());
  assert.equal(transient.getTransport(), source.getTransport());
  transient.setDefaultModel("transient"); transient.setPackages(["npm:forbidden"]); transient.setProjectExtensionPaths(["forbidden.ts"]);
  await transient.flush(); await transient.reload();
  assert.equal(transient.getDefaultModel(), "transient");
  assert.deepEqual(transient.getPackages(), []); assert.deepEqual(transient.getExtensionPaths(), []);
  assert.equal(source.getDefaultModel(), undefined);
  const broken = SettingsManager.fromStorage({ withLock(_scope, fn) { fn("{"); } });
  assert.throws(() => createSubagentMemorySettings(broken), /settings/);
});

test("transient setter deltas survive refreshed scopes, deletions, nested siblings and trust cycles", async () => {
  const global = { transport: "websocket", shellPath: "old-shell", modelThinkingLevels: { "p/remove": "low", "p/keep": "high" }, terminal: { showImages: true, imageWidthCells: 40 } };
  const project = { shellCommandPrefix: "old-prefix", transport: "sse" };
  const source = SettingsManager.fromStorage({ withLock(scope, fn) { fn(JSON.stringify(scope === "global" ? global : project)); } });
  const transient = createSubagentMemorySettings(source);
  transient.setDefaultModel("local-model");
  transient.setTransport("websocket"); // No-op global setter does not pin the source baseline.
  transient.setShellPath(undefined);
  transient.removeModelThinkingLevel("p", "remove");
  transient.setShowImages(false);
  transient.setCompactionEnabled(false); // No initial object: future source siblings must still refresh.
  await transient.flush();
  global.transport = "auto"; global.shellPath = "new-shell";
  global.modelThinkingLevels = { "p/remove": "medium", "p/keep": "low", "p/new": "high" };
  global.terminal = { showImages: true, imageWidthCells: 90, trueColor: false };
  global.compaction = { enabled: true, reserveTokens: 2345 };
  global.defaultModel = "disk-model";
  project.shellCommandPrefix = "new-prefix";
  for (const settings of [global, project]) for (const key of ["packages", "extensions", "skills", "prompts", "themes"]) settings[key] = ["forbidden"];
  await source.reload(); await transient.reload();
  assert.equal(transient.getGlobalSettings().transport, "auto");
  assert.equal(transient.getShellCommandPrefix(), "new-prefix");
  assert.equal(transient.getDefaultModel(), "local-model");
  assert.equal(transient.getGlobalSettings().shellPath, undefined);
  assert.deepEqual(transient.getGlobalSettings().modelThinkingLevels, { "p/keep": "low", "p/new": "high" });
  assert.deepEqual(transient.getGlobalSettings().terminal, { showImages: false, imageWidthCells: 90, trueColor: false });
  assert.deepEqual(transient.getGlobalSettings().compaction, { enabled: false, reserveTokens: 2345 });
  transient.removeModelThinkingLevel("p", "keep"); transient.removeModelThinkingLevel("p", "new");
  await transient.flush();
  global.modelThinkingLevels = { "p/later": "high" };
  source.setProjectTrusted(false); await source.reload(); transient.setProjectTrusted(false); await transient.reload();
  assert.equal(transient.getTransport(), "auto");
  assert.equal(transient.getShellCommandPrefix(), undefined);
  assert.equal(transient.getGlobalSettings().modelThinkingLevels, undefined, "whole-object deletion is not resurrected");
  project.shellCommandPrefix = "regranted-prefix";
  source.setProjectTrusted(true); await source.reload(); transient.setProjectTrusted(true); await transient.reload();
  assert.equal(transient.getShellCommandPrefix(), "regranted-prefix");
  assert.equal(transient.getDefaultModel(), "local-model");
  for (const scope of [transient.getGlobalSettings(), transient.getProjectSettings()]) for (const key of ["packages", "extensions", "skills", "prompts", "themes"]) assert.deepEqual(scope[key], []);
  assert.equal(source.getDefaultModel(), "disk-model", "memory setters never reach the source");
  assert.equal(source.getGlobalSettings().shellPath, "new-shell");
});

test("explicit loader reload refreshes non-resource settings equally for All/All and restricted resources", async (t) => {
  const f = await fixture(t);
  const initialGlobal = { ...f.global, packages: [] };
  await file(join(f.agentDir, "settings.json"), JSON.stringify(initialGlobal));
  const all = await f.services(true, true);
  const restricted = await f.services(false, false);
  const globalPath = join(f.agentDir, "settings.json"), projectPath = join(f.cwd, ".pi", "settings.json");
  const beforeGlobal = await readFile(globalPath), beforeProject = await readFile(projectPath);
  restricted.settingsManager.setDefaultModel("local-model");
  restricted.settingsManager.setCompactionEnabled(false);
  restricted.settingsManager.setShellPath(undefined);
  restricted.settingsManager.setPackages(["npm:forbidden"]);
  await restricted.settingsManager.flush();
  assert.deepEqual(await readFile(globalPath), beforeGlobal); assert.deepEqual(await readFile(projectPath), beforeProject);
  const changedGlobal = { ...initialGlobal, transport: "auto", shellPath: "/new-shell", compaction: { enabled: true, reserveTokens: 1234 }, prompts: ["absent.md"], themes: ["absent.json"] };
  const changedProject = { ...f.local, shellCommandPrefix: "new-prefix", transport: "websocket" };
  await file(globalPath, JSON.stringify(changedGlobal)); await file(projectPath, JSON.stringify(changedProject));
  for (const services of [all, restricted]) await services.resourceLoader.reload();
  for (const services of [all, restricted]) assert.equal(services.settingsManager.getTransport(), "auto", "untrusted project cannot override refreshed global transport");
  f.trust.set(f.cwd, true);
  for (const services of [all, restricted]) await services.resourceLoader.reload();
  for (const services of [all, restricted]) {
    assert.equal(services.settingsManager.getTransport(), "websocket");
    assert.equal(services.settingsManager.getProjectSettings().shellCommandPrefix, "new-prefix");
    assert.equal(services.settingsManager.getCacheWarmingMode(), "off");
  }
  changedGlobal.transport = "sse"; changedProject.shellCommandPrefix = "second-prefix";
  await file(globalPath, JSON.stringify(changedGlobal)); await file(projectPath, JSON.stringify(changedProject));
  for (const services of [all, restricted]) await services.resourceLoader.reload();
  assert.equal(restricted.settingsManager.getGlobalSettings().transport, "sse");
  assert.equal(restricted.settingsManager.getShellCommandPrefix(), "second-prefix");
  assert.equal(restricted.settingsManager.getDefaultModel(), "local-model");
  assert.equal(restricted.settingsManager.getGlobalSettings().shellPath, undefined);
  assert.deepEqual(restricted.settingsManager.getGlobalSettings().compaction, { enabled: false, reserveTokens: 1234 });
  for (const scope of [restricted.settingsManager.getGlobalSettings(), restricted.settingsManager.getProjectSettings()]) for (const key of ["packages", "extensions", "skills", "prompts", "themes"]) assert.deepEqual(scope[key], []);
  assert.deepEqual(restricted.resourceLoader.getPrompts().prompts, []);
  assert.deepEqual(restricted.resourceLoader.getThemes().themes, []);
  f.trust.set(f.cwd, false);
  for (const services of [all, restricted]) await services.resourceLoader.reload();
  assert.equal(restricted.settingsManager.getTransport(), "sse");
  assert.equal(restricted.settingsManager.getShellCommandPrefix(), undefined);
  assert.equal(restricted.settingsManager.getDefaultModel(), "local-model");
  assert.equal(await readFile(globalPath, "utf8"), JSON.stringify(changedGlobal));
  assert.equal(await readFile(projectPath, "utf8"), JSON.stringify(changedProject));
});

test("explicit Markdown directories never expand skills, including wildcard + path", async (t) => {
  const f = await fixture(t);
  const directory = join(f.dir, "leak.md");
  const child = await file(join(directory, "nested", "SKILL.md"), skill("must-not-leak"));
  const directoryAlias = join(f.dir, "alias.md"); await symlink(directory, directoryAlias, "dir");
  const markdown = await file(join(f.dir, "standalone.md"), skill("explicit-file"));
  for (const selection of [[directory], ["*", directory, directoryAlias], [markdown]]) {
    const catalog = await readSubagentResourceCatalog(f.cwd, f.agentDir);
    addExplicitResources(catalog, { skills: selection, extensions: false }, f.cwd, f.agentDir);
    assert.ok(!catalog.skills.some((entry) => entry.path === child), "directory children never enter the wildcard catalog");
    const services = await f.services(selection, false);
    await services.resourceLoader.reload();
    assert.ok(!services.resourceLoader.getSkills().skills.some((entry) => entry.name === "must-not-leak"));
    if (selection[0] === markdown) assert.deepEqual(services.resourceLoader.getSkills().skills.map((entry) => entry.name), ["explicit-file"]);
    else assert.ok(services.resourceLoader.getSkills().diagnostics.some((entry) => entry.path === directory && entry.message.includes("Unknown resource")));
  }
});

test("skill diagnostics are stable and unique without losing collision losers or SDK winner evidence", async (t) => {
  const f = await fixture(t);
  const roots = await Promise.all(["winner", "loser-one", "loser-two"].map((name) => file(join(f.dir, name, "SKILL.md"), skill("Bad_Name"))));
  await file(join(f.agentDir, "settings.json"), JSON.stringify({ ...f.global, skills: roots }));
  const catalog = await readSubagentResourceCatalog(f.cwd, f.agentDir);
  for (const path of roots) {
    assert.ok(catalog.skills.some((entry) => entry.path === path), "per-root parsing retains a selectable loser");
    assert.equal(catalog.diagnostics.filter((entry) => entry.path === path && entry.message.includes("invalid characters")).length, 1);
  }
  const collisions = catalog.diagnostics.filter((entry) => entry.type === "collision" && entry.collision.name === "Bad_Name");
  assert.equal(collisions.length, 2);
  assert.deepEqual(collisions.map((entry) => entry.collision.loserPath), roots.slice(1));
  assert.ok(collisions.every((entry) => entry.collision.winnerPath === roots[0]));
  assert.deepEqual(uniqueResourceDiagnostics([...collisions, ...collisions]), collisions);
  assert.deepEqual((await readSubagentResourceCatalog(f.cwd, f.agentDir)).diagnostics, catalog.diagnostics);
  const services = await f.services([roots[1]], false);
  assert.deepEqual(services.resourceLoader.getSkills().skills.map((entry) => entry.filePath), [roots[1]]);
  for (const boundary of ["create", "reload"]) {
    if (boundary === "reload") await services.resourceLoader.reload();
    const diagnostics = services.resourceLoader.getSkills().diagnostics;
    assert.equal(diagnostics.filter((entry) => entry.path === roots[1] && entry.message.includes("invalid characters")).length, 1, "SDK runtime + static catalog warning is shown once");
    assert.deepEqual(diagnostics.filter((entry) => entry.type === "collision" && entry.collision.name === "Bad_Name"), collisions);
    assert.deepEqual(uniqueResourceDiagnostics(diagnostics), diagnostics);
  }
});

test("catalog executes neither module top-level nor factories and skips missing packages; names/collisions remain diagnostic", async (t) => {
  const f = await fixture(t);
  const alias = join(f.agentDir, "extensions", "alias.ts"); await symlink(f.allowed, alias);
  const catalog = await readSubagentResourceCatalog(f.cwd, f.agentDir);
  for (const name of Object.keys(f.markers)) { assert.equal(await f.count(name, "top"), 0); assert.equal(await f.count(name), 0); }
  assert.ok(catalog.diagnostics.some((d) => d.message.includes("not installed")));
  assert.ok(catalog.diagnostics.some((d) => d.message.includes("differs from its directory")));
  assert.deepEqual(selectCatalogResources(catalog.skills, ["EFFECTIVE-ONE"], f.cwd).items.map((x) => x.path), [f.one]);
  assert.deepEqual(selectCatalogResources(catalog.extensions, ["SHORT-PACKAGE"], f.cwd).items.map((x) => x.path), [f.packaged]);
  assert.deepEqual(selectCatalogResources(catalog.extensions, ["project"], f.cwd).items.map((x) => x.path), [f.project]);
  assert.equal(selectCatalogResources(catalog.extensions, ["unknown"], f.cwd).items.length, 0);
  await f.ext(join(f.agentDir, "extensions", "nested", "allowed.ts"), "collision");
  await f.ext(join(f.agentDir, "extensions", "other", "allowed.ts"), "collision_other");
  await file(join(f.agentDir, "settings.json"), JSON.stringify({ ...f.global, extensions: ["./extensions/nested/allowed.ts", "./extensions/other/allowed.ts"] }));
  const collision = await readSubagentResourceCatalog(f.cwd, f.agentDir);
  assert.equal(selectCatalogResources(collision.extensions, ["allowed"], f.cwd).items.length, 0, JSON.stringify(collision.extensions));
  const npmCalls = await readFile(f.npmLog, "utf8"); assert.doesNotMatch(npmCalls, /install|view|update/);
});

test("offline catalog diagnoses missing and incomplete scoped packages even when SDK onMissing is never called", async (t) => {
  const f = await fixture(t);
  const previousOffline = process.env.PI_OFFLINE;
  const originalResolve = DefaultPackageManager.prototype.resolve;
  let onMissingCalls = 0;
  DefaultPackageManager.prototype.resolve = function (onMissing) {
    return originalResolve.call(this, async (source) => {
      onMissingCalls += 1;
      return onMissing ? onMissing(source) : "skip";
    });
  };
  t.after(() => {
    DefaultPackageManager.prototype.resolve = originalResolve;
    if (previousOffline === undefined) delete process.env.PI_OFFLINE; else process.env.PI_OFFLINE = previousOffline;
  });
  const partialRoot = join(f.agentDir, "npm", "node_modules", "@fixture", "partial");
  await mkdir(partialRoot, { recursive: true });
  const mismatchRoot = join(f.agentDir, "npm", "node_modules", "@fixture", "mismatch");
  await file(join(mismatchRoot, "package.json"), JSON.stringify({ name: "@fixture/mismatch", version: "0.5.0" }));
  const corruptRoot = join(f.agentDir, "npm", "node_modules", "@fixture", "corrupt");
  await file(join(corruptRoot, "package.json"), "{");
  const emptyRoot = join(f.agentDir, "npm", "node_modules", "@fixture", "empty");
  await file(join(emptyRoot, "package.json"), JSON.stringify({ name: "@fixture/empty", version: "1.0.0", pi: {} }));
  const installedButDisabled = "npm:@fixture/short-package@1.0.0";
  await file(join(f.agentDir, "settings.json"), JSON.stringify({ ...f.global, packages: [
    { source: installedButDisabled, extensions: [], skills: [], prompts: [], themes: [] },
    "npm:@fixture/nonselected-missing@1.0.0", "./absent-local", "npm:@fixture/partial@1.0.0",
    "npm:@fixture/mismatch@1.0.0", "npm:@fixture/corrupt@1.0.0", "npm:@fixture/empty@latest",
  ] }));
  await file(join(f.cwd, ".pi", "settings.json"), JSON.stringify({ ...f.local, packages: ["npm:@fixture/project-missing@1.0.0"] }));

  process.env.PI_OFFLINE = "1";
  const offline = await readSubagentResourceCatalog(f.cwd, f.agentDir);
  assert.equal(onMissingCalls, 0, "real SDK offline skip happens before the supplied callback");
  const packageDiagnostics = (catalog) => catalog.diagnostics.filter((d) => d.message.startsWith("Package unavailable locally"));
  const offlineDiagnostics = packageDiagnostics(offline);
  assert.equal(offlineDiagnostics.length, 6);
  assert.equal(offlineDiagnostics.filter((d) => d.message.includes("nonselected-missing")).length, 1);
  assert.ok(offlineDiagnostics.some((d) => d.message.includes("not installed, project scope") && d.message.includes("project-missing")));
  assert.ok(offlineDiagnostics.some((d) => d.message.includes("not installed, user scope") && d.message.includes("absent-local")));
  assert.ok(offlineDiagnostics.some((d) => d.path === partialRoot && d.message.includes("not ready")));
  assert.ok(offlineDiagnostics.some((d) => d.path === mismatchRoot && d.message.includes("configured range")));
  assert.ok(offlineDiagnostics.some((d) => d.path === corruptRoot && d.message.includes("manifest is unreadable")));
  assert.ok(!offlineDiagnostics.some((d) => d.message.includes("@fixture/empty") || d.message.includes("@fixture/short-package")), "empty/disabled installed packages are not missing");

  // Only this isolated process changes its flag; the rejecting fixture npm command prevents network/install.
  delete process.env.PI_OFFLINE;
  const online = await readSubagentResourceCatalog(f.cwd, f.agentDir);
  assert.ok(onMissingCalls > 0);
  assert.deepEqual(packageDiagnostics(online), offlineDiagnostics, "readiness diagnostics do not depend on the offline callback");
  for (const name of Object.keys(f.markers)) { assert.equal(await f.count(name, "top"), 0); assert.equal(await f.count(name), 0); }
  assert.doesNotMatch(await readFile(f.npmLog, "utf8"), /install|view|update/);
  t.diagnostic(JSON.stringify({ phase: "offline-static-catalog", offlineOnMissingCalls: 0, unavailablePackages: offlineDiagnostics.length, sameDiagnosticsOnline: true, moduleTopLevel: 0, extensionFactory: 0, installOrNetworkCalls: 0 }));
});

test("strict startup catalog does not execute project npmCommand before the missing-package callback", async (t) => {
  const f = await fixture(t);
  const marker = join(f.dir, "project-npm.marker");
  const script = await file(join(f.cwd, "npm.cjs"), `require('fs').appendFileSync(${JSON.stringify(marker)}, 'executed\\n'); throw Error('untrusted project command');`);
  await file(join(f.cwd, ".pi", "settings.json"), JSON.stringify({ ...f.local, npmCommand: [process.execPath, script] }));
  f.trust.set(f.cwd, false);
  const services = await f.services(false, [f.allowed]);
  assert.equal(await exists(marker), false);
  assert.equal(services.settingsManager.isProjectTrusted(), false);
  assert.equal(await f.count("allowed", "top"), 1); assert.equal(await f.count("allowed"), 1);
  assert.equal(await f.count("project", "top"), 0); assert.equal(await f.count("project"), 0);
  assert.doesNotMatch(await readFile(f.npmLog, "utf8"), /install|view|update/);
});

test("untrusted outside file symlink cannot import a real project extension", async (t) => {
  const f = await fixture(t);
  const arbitrary = await f.ext(join(f.cwd, "arbitrary.ts"), "arbitrary");
  const alias = join(f.dir, "outside-link.ts"); await symlink(arbitrary, alias);
  f.trust.set(f.cwd, false);
  const services = await f.services(false, [alias]);
  assert.equal(await f.count("arbitrary", "top"), 0); assert.equal(await f.count("arbitrary"), 0);
  assert.equal(services.resourceLoader.getExtensions().extensions.length, 0);
  await services.resourceLoader.reload();
  assert.equal(await f.count("arbitrary", "top"), 0); assert.equal(await f.count("arbitrary"), 0);
});

test("user-scope discovery and project selection aliases cannot disguise a project extension's canonical ownership", async (t) => {
  const f = await fixture(t);
  const arbitrary = await f.ext(join(f.cwd, "arbitrary.ts"), "arbitrary");
  const userAlias = join(f.agentDir, "extensions", "user-alias.ts"); await symlink(arbitrary, userAlias);
  const projectAlias = join(f.cwd, "global-alias.ts"); await symlink(f.allowed, projectAlias);
  f.trust.set(f.cwd, false);
  const catalog = await readSubagentResourceCatalog(f.cwd, f.agentDir);
  assert.ok(catalog.extensions.some((entry) => entry.path === userAlias && entry.metadata.scope === "user"));
  const services = await f.services(false, [userAlias, projectAlias]);
  assert.equal(await f.count("arbitrary", "top"), 0); assert.equal(await f.count("arbitrary"), 0);
  assert.equal(await f.count("allowed", "top"), 0); assert.equal(await f.count("allowed"), 0, "a project-owned alias is gated even when identity matching found the user entry first");
  assert.equal(services.resourceLoader.getExtensions().extensions.length, 0);
});

test("untrusted symlink cwd cannot import an extension selected by its real absolute project path", async (t) => {
  const f = await fixture(t);
  const arbitrary = await f.ext(join(f.cwd, "arbitrary.ts"), "arbitrary");
  const cwd = join(f.dir, "cwd-link"); await symlink(f.cwd, cwd, "dir");
  f.trust.set(f.cwd, false);
  const services = await createSubagentSessionServices({ cwd, agentDir: f.agentDir, modelRuntime: f.runtime, settingsManager: SettingsManager.create(cwd, f.agentDir, { projectTrusted: false }), resourceLoaderOptions: { noPromptTemplates: true, noThemes: true, noContextFiles: true } }, { skills: false, extensions: [arbitrary], loadSkills: false, loadExtensions: true });
  assert.equal(await f.count("arbitrary", "top"), 0); assert.equal(await f.count("arbitrary"), 0);
  assert.equal(services.settingsManager.isProjectTrusted(), false);
  assert.equal(services.resourceLoader.getExtensions().extensions.length, 0);
});

test("bare project explicit extension needs a genuine trust decision on creation and every reload", async (t) => {
  const f = await fixture(t);
  await rm(join(f.cwd, ".pi"), { recursive: true, force: true });
  await rm(join(f.cwd, ".agents"), { recursive: true, force: true });
  const arbitrary = await f.ext(join(f.cwd, "arbitrary.ts"), "arbitrary");
  const { getProjectTrustStatus } = await jiti.import("./project-trust.ts");
  f.trust.set(f.cwd, false);
  assert.equal(getProjectTrustStatus(f.cwd, f.agentDir).requiresTrust, false);
  assert.equal(getProjectTrustStatus(f.cwd, f.agentDir).trusted, true, "normal-agent clean-folder semantics are unchanged");
  const services = await f.services(false, [arbitrary]);
  assert.equal(await f.count("arbitrary", "top"), 0); assert.equal(await f.count("arbitrary"), 0);
  assert.equal(services.settingsManager.isProjectTrusted(), false);
  f.trust.set(f.cwd, null);
  await services.resourceLoader.reload();
  assert.equal(await f.count("arbitrary", "top"), 0); assert.equal(await f.count("arbitrary"), 0, "absence of protected standard directories is not execution approval");
  f.trust.set(f.cwd, true);
  await services.resourceLoader.reload();
  assert.equal(services.settingsManager.isProjectTrusted(), true);
  assert.equal(await f.count("arbitrary", "top"), 1); assert.equal(await f.count("arbitrary"), 1);
  f.trust.set(f.cwd, false);
  await services.resourceLoader.reload();
  assert.equal(services.settingsManager.isProjectTrusted(), false);
  assert.equal(services.resourceLoader.getExtensions().extensions.length, 0);
  assert.equal(await f.count("arbitrary", "top"), 1); assert.equal(await f.count("arbitrary"), 1, "denied reload does not execute again");
  t.diagnostic(JSON.stringify({ phase: "bare-project-explicit-trust", initialFalseTop: 0, initialFalseFactory: 0, missingDecisionFactory: 0, genuineTrueFactory: 1, deniedReloadAdditionalExecutions: 0 }));
});

test("strict pre-import SDK loading: excluded top-level/factory 0, metadata retained, all skill dynamic discovery stays available", async (t) => {
  const f = await fixture(t);
  const services = await f.services(true, ["ALLOWED", "short-package"]);
  const { session } = await createAgentSessionFromServices({ services, sessionManager: SessionManager.inMemory(f.cwd), model: f.faux.getModel("resource-faux"), tools: ["read", "allowed", "package_tool"] });
  t.after(() => session.dispose());
  await session.bindExtensions({ onError: (error) => { throw Error(error.message); } });
  assert.equal(await f.count("allowed"), 1); assert.equal(await f.count("package_tool"), 1);
  assert.equal(await f.count("excluded", "top"), 0); assert.equal(await f.count("excluded"), 0);
  assert.equal(await f.count("project", "top"), 0);
  assert.ok(services.resourceLoader.getSkills().skills.some((x) => x.name === "dynamic"));
  assert.ok(!services.resourceLoader.getSkills().skills.some((x) => x.name === "two"), "automatic project skill still requires trust");
  const packaged = services.resourceLoader.getExtensions().extensions.find((x) => x.path === f.packaged);
  assert.equal(packaged.sourceInfo.origin, "package"); assert.equal(packaged.sourceInfo.source, "npm:@fixture/short-package@1.0.0");
  const { selectSubagentExtensionTools } = await jiti.import("./subagents.ts");
  // Existing ext: matcher receives the original SDK source metadata.
  assert.deepEqual(selectSubagentExtensionTools([packaged], ["ext:short-package/package_tool"]), ["package_tool"]);
  await file(join(f.agentDir, "skills", "new", "SKILL.md"), skill("new"));
  await session.reload();
  assert.ok(services.resourceLoader.getSkills().skills.some((x) => x.name === "new"));
  assert.ok(services.resourceLoader.getSkills().skills.some((x) => x.name === "dynamic"));
  assert.equal(await f.count("excluded", "top"), 0); assert.equal(await f.count("excluded"), 0);
  assert.doesNotMatch(await readFile(f.npmLog, "utf8"), /install|view|update/);
  t.diagnostic(JSON.stringify({ sdk: "1.0.0", phase: "strict-create-bind-reload", approvedFactory: await f.count("allowed"), excludedTopLevel: await f.count("excluded", "top"), excludedFactory: await f.count("excluded"), missingPackageInstallCalls: 0, dynamicSkillAvailable: true }));
});

test("none and selected skills enforce dynamic identity after binding/extendResources; explicit Markdown remains editable without trust", async (t) => {
  const f = await fixture(t);
  for (const selection of [false, ["effective-one"], [f.two], []]) {
    const services = await f.services(selection, [f.allowed]);
    const { session } = await createAgentSessionFromServices({ services, sessionManager: SessionManager.inMemory(f.cwd), model: f.faux.getModel("resource-faux") });
    await session.bindExtensions({ onError: (error) => { throw Error(error.message); } });
    services.resourceLoader.extendResources({ skillPaths: [{ path: f.dynamic, metadata: { source: "extension", scope: "temporary", origin: "top-level" } }] });
    const expected = selection === false || selection.length === 0 ? [] : selection[0] === f.two ? ["two"] : ["effective-one"];
    assert.deepEqual(services.resourceLoader.getSkills().skills.map((x) => x.name), expected);
    await session.reload();
    assert.deepEqual(services.resourceLoader.getSkills().skills.map((x) => x.name), expected);
    session.dispose();
  }
  assert.equal(await f.count("excluded", "top"), 0);
});

test("extension paths cannot bypass project trust on create/reload false → true → false; wildcard + path loads concrete approved files only", async (t) => {
  const f = await fixture(t);
  const outside = await f.ext(join(f.dir, "outside.ts"), "outside");
  const services = await f.services(false, ["*", outside, f.project.replaceAll("/", "\\")]);
  assert.equal(await f.count("project", "top"), 0);
  assert.equal(await f.count("outside"), 1);
  assert.equal(services.settingsManager.isProjectTrusted(), false);
  f.trust.set(f.cwd, true);
  await services.resourceLoader.reload();
  assert.equal(services.settingsManager.isProjectTrusted(), true);
  assert.equal(services.settingsManager.getTransport(), "sse");
  assert.equal(services.settingsManager.getCacheWarmingMode(), "off");
  assert.equal(services.settingsManager.getProjectSettings().shellCommandPrefix, "project-prefix");
  assert.equal(services.settingsManager.getGlobalSettings().shellPath, "/global-shell");
  assert.equal(await f.count("project"), 1);
  f.trust.set(f.cwd, false);
  const before = await f.count("project"); await services.resourceLoader.reload();
  assert.equal(services.settingsManager.isProjectTrusted(), false);
  assert.equal(await f.count("project"), before);
  assert.ok(!services.resourceLoader.getExtensions().extensions.some((x) => x.path === f.project));
  assert.doesNotMatch(await readFile(f.npmLog, "utf8"), /install|view|update/);
});

test("real controller creation snapshots resource selections; cold rpc restoration and explicit reload never re-read a widened profile", async (t) => {
  const f = await fixture(t);
  // Profiles and sessions use the SDK's agentDir environment, not a real user's files.
  const previousAgent = process.env.PI_CODING_AGENT_DIR; process.env.PI_CODING_AGENT_DIR = f.agentDir;
  t.after(() => { process.env.PI_CODING_AGENT_DIR = previousAgent; });
  await file(f.allowed, `export default function(pi) { pi.on('session_start', async () => { await new Promise(r => setTimeout(r, 20)); pi.registerTool({name:'browser_mock',label:'Browser mock',description:'Late mock, no browser',parameters:{type:'object',properties:{}},execute:async()=>({content:[],details:undefined})}); }); }`);
  saveSubagentProfile(f.cwd, "project", { name: "whitelist", displayName: "Whitelist", description: "Fixture", systemPrompt: "Fixture prompt", tools: ["read"], loadSkills: true, loadExtensions: true, skills: ["effective-one"], extensions: [f.allowed], inheritContext: false, runInBackground: false, promptMode: "append", enabled: true });
  const parentManager = SessionManager.create(f.cwd, join(f.dir, "sessions"));
  parentManager.appendMessage({ role: "user", content: "Fixture", timestamp: Date.now() });
  const parent = { inner: { sessionManager: parentManager, modelRuntime: f.runtime, model: f.faux.getModel("resource-faux"), agent: { state: { thinkingLevel: "off" } } }, sessionFile: parentManager.getSessionFile(), cwd: f.cwd, isAlive: () => true };
  let created, childWrapper;
  const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");
  const controller = createSubagentController({ getSession: (id) => id === parentManager.getSessionId() ? parent : childWrapper, registerSession(inner) {
    created = inner;
    childWrapper = new AgentSessionWrapper(inner, { suppressCompletionNotifications: true, subagentResources: readSubagentSessionResources(inner.sessionManager.getEntries()) });
    t.after(() => childWrapper.destroy());
    childWrapper.beginExtensionBinding();
    inner.prompt = async () => { assert.ok(inner.getActiveToolNames().includes("browser_mock"), "controller waits for the single wrapper bind before prompt"); };
    return childWrapper.waitUntilReady();
  }, reopenSession: async () => { throw Error("not used"); }, resolveSessionPath: async () => null, invalidateSessionList() {}, isBuiltInSubagentsEnabled: () => true });
  const run = await controller.extensionRuntime.start({ parentContext: parent.inner, parentToolCallId: "fixture-call", profile: "whitelist", task: "fixture", description: "Fixture" });
  const firstTools = await childWrapper.send({ type: "get_tools" });
  assert.equal(firstTools.find((tool) => tool.name === "browser_mock")?.active, true);
  assert.ok((await childWrapper.send({ type: "get_state" })).activeToolNames.includes("browser_mock"));
  assert.equal((await run.completion).status, "completed");
  // SDK does not flush metadata-only sessions until an assistant entry exists. No provider request.
  created.sessionManager.appendMessage({ role: "assistant", content: [{ type: "text", text: "Fixture" }], api: "faux", provider: "faux", model: "resource-faux", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp: Date.now() });
  const entries = created.sessionManager.getEntries();
  const snapshot = entries.find((e) => e.type === "custom" && e.customType === SUBAGENT_META_TYPE).data.resourceSnapshot;
  assert.equal(snapshot.version, 3);
  assert.equal(snapshot.codeMode, false);
  assert.equal(snapshot.loadMcp, false);
  assert.deepEqual(snapshot.mcpServers, []);
  assert.deepEqual(snapshot.builtinTools, ["read"]);
  assert.deepEqual(snapshot.toolPolicy, { mode: "implicitAll", selectors: [], deny: [] });
  assert.ok(created.getActiveToolNames().includes("browser_mock"));
  assert.deepEqual(snapshot.skills, ["effective-one"]); assert.deepEqual(snapshot.extensions, [f.allowed]);
  assert.ok(snapshot.appendSystemPrompt.some((text) => text.includes("Fixture prompt")));
  assert.deepEqual(readSubagentSessionResources(entries).skills, ["effective-one"]);
  const childFile = created.sessionFile;
  childWrapper.destroy();
  // Widen the profile and shell/default loadout on disk.
  await file(join(f.agentDir, "settings.json"), JSON.stringify({ ...f.global, defaultTools: ["powershell", "write", "+codemode"] }));
  // Widen the profile on disk. Restore must use the persisted snapshot, not the profile.
  await file(join(f.cwd, ".pi", "agents", "whitelist.md"), "---\nskills: true\nextensions: true\n---\nWidened.\n");
  // Inject only a no-refresh in-process model runtime; real startRpcSession/services/loader/session stay intact.
  const originalCreate = ModelRuntime.create;
  ModelRuntime.create = async () => f.runtime;
  t.after(() => { ModelRuntime.create = originalCreate; });
  const { startRpcSession } = await jiti.import("./rpc-manager.ts");
  const { session: wrapper } = await startRpcSession(run.run.sessionId, childFile, f.cwd);
  t.after(() => wrapper.destroy());
  assert.equal((await wrapper.send({ type: "get_tools" })).find((tool) => tool.name === "browser_mock")?.active, true);
  assert.ok((await wrapper.send({ type: "get_state" })).activeToolNames.includes("browser_mock"));
  await wrapper.waitUntilReady();
  assert.ok(wrapper.inner.getActiveToolNames().includes("browser_mock"));
  assert.ok(wrapper.inner.getActiveToolNames().includes("read"));
  assert.match(wrapper.inner.systemPrompt, /Fixture prompt/);
  assert.doesNotMatch(wrapper.inner.systemPrompt, /Widened/);
  assert.ok(!wrapper.inner.getAllTools().some((tool) => ["powershell", "write", "Agent", "get_subagent_result", "steer_subagent"].includes(tool.name)));
  assert.deepEqual(wrapper.inner.resourceLoader.getSkills().skills.map((x) => x.name), ["effective-one"]);
  assert.equal(await f.count("excluded", "top"), 0);
  await wrapper.send({ type: "reload" });
  assert.ok(wrapper.inner.getActiveToolNames().includes("browser_mock"));
  assert.equal((await wrapper.send({ type: "get_tools" })).find((tool) => tool.name === "browser_mock")?.active, true);
  assert.ok((await wrapper.send({ type: "get_state" })).activeToolNames.includes("browser_mock"));
  assert.ok(!wrapper.inner.getAllTools().some((tool) => ["powershell", "write"].includes(tool.name)));
  assert.match(wrapper.inner.systemPrompt, /Fixture prompt/);
  assert.doesNotMatch(wrapper.inner.systemPrompt, /Widened/);
  assert.deepEqual(wrapper.inner.resourceLoader.getSkills().skills.map((x) => x.name), ["effective-one"]);
  assert.equal(await f.count("excluded", "top"), 0); assert.equal(await f.count("excluded"), 0);
  assert.doesNotMatch(await readFile(f.npmLog, "utf8"), /install|view|update/);
  t.diagnostic(JSON.stringify({ phase: "controller-create-cold-rpc-reload", restoredSkills: wrapper.inner.resourceLoader.getSkills().skills.map((x) => x.name), excludedTopLevel: await f.count("excluded", "top"), excludedFactory: await f.count("excluded"), missingPackageInstallCalls: 0, providerRequests: 0 }));
  const invalid = SessionManager.create(f.cwd, join(f.dir, "invalid-sessions"));
  invalid.appendCustomEntry(SUBAGENT_META_TYPE, { version: 1, parentSessionId: "parent", parentSessionPath: "/parent.jsonl", resourceSnapshot: { version: 1, tools: [], appendSystemPrompt: [], loadExtensions: true, extensions: { invalid: true } } });
  invalid.appendMessage({ role: "assistant", content: [], api: "faux", provider: "faux", model: "resource-faux", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp: Date.now() });
  await assert.rejects(startRpcSession(invalid.getSessionId(), invalid.getSessionFile(), f.cwd), /invalid resource snapshot/);
});
