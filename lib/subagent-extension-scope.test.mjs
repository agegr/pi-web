import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { createAgentSessionFromServices, DefaultPackageManager, ProjectTrustStore, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";

// This test process never refreshes provider catalogs or uses the operator's agent directory.
process.env.PI_OFFLINE = "1";
const jiti = createJiti(import.meta.url);
const { resolveSubagentProfile, readSubagentSessionResources, selectSubagentExtensionTools, SUBAGENT_CONTROL_TOOL_NAMES, withSubagentExtensionTools } = await jiti.import("./subagents.ts");
const { createExactSystemPromptExtension } = await jiti.import("./exact-system-prompt.ts");
const { subagentSkillsOverride } = await jiti.import("./subagent-skills.ts");
const { createScopedAgentSessionServices } = await jiti.import("./subagent-extension-scope.ts");

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "pi-web-extension-scope-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cwd = join(root, "project");
  const agentDir = join(root, "agent");
  await mkdir(cwd, { recursive: true });
  await mkdir(agentDir, { recursive: true });
  async function put(path, text) { await mkdir(dirname(path), { recursive: true }); await writeFile(path, text); }
  async function extension(path, name) {
    await put(path, `import { appendFileSync } from 'node:fs';
appendFileSync(${JSON.stringify(join(root, name + ".import"))}, 'import\\n');
export default function(pi) {
 appendFileSync(${JSON.stringify(join(root, name + ".factory"))}, 'factory\\n');
 pi.registerProvider(${JSON.stringify("scope-" + name)}, { baseUrl: 'https://invalid.example', apiKey: 'test', api: 'openai-completions', models: [] });
}
`);
  }
  const settingsManager = SettingsManager.create(cwd, agentDir);
  const options = { cwd, agentDir, settingsManager, resourceLoaderOptions: { noSkills: true, noThemes: true, noPromptTemplates: true, noContextFiles: true } };
  return { root, cwd, agentDir, settingsManager, options, put, extension };
}
function resources(scope) {
  const snapshot = { version: 1, tools: ["read"], appendSystemPrompt: [], loadSkills: false, loadExtensions: true, ...(scope !== undefined ? { extensionScope: scope } : {}) };
  return readSubagentSessionResources([{ type: "custom", customType: "pi-web:subagent", data: { version: 1, parentSessionId: "parent", parentSessionPath: "/parent.jsonl", resourceSnapshot: snapshot } }]);
}

test("profile scopes preserve empty/none, unbounded keywords, and explicit disable", async (t) => {
  const f = await fixture(t);
  for (const [value, expected] of [["[codegraph, pi-mcp-adapter]", ["codegraph", "pi-mcp-adapter"]], ["[]", []], ["none", []], ["false", []], ["true", undefined], ["all", undefined], ['"*"', undefined]]) {
    await f.put(join(f.cwd, ".pi/agents/scoped.md"), `---\nextensions: ${value}\nload_extensions: true\n---\nTask`);
    assert.deepEqual(resolveSubagentProfile(f.cwd, "scoped").extensionScope, expected, value);
  }
  await f.put(join(f.cwd, ".pi/agents/scoped.md"), "---\nextensions: [codegraph]\nload_extensions: false\n---\nTask");
  assert.equal(resolveSubagentProfile(f.cwd, "scoped").loadExtensions, false);
});

test("snapshot copies scopes, preserves empty/missing, and fails closed on malformed scope", () => {
  const scope = ["codegraph"];
  const restored = resources(scope);
  assert.deepEqual(restored.extensionScope, ["codegraph"]);
  scope.push("other");
  assert.deepEqual(restored.extensionScope, ["codegraph"]);
  assert.deepEqual(resources([]).extensionScope, []);
  assert.equal(resources(undefined).extensionScope, undefined);
  assert.throws(() => resources([42]), /Invalid subagent extension scope/);
});

test("legacy snapshots containing control tools stay isolated and strip those tools on restore", () => {
  const restored = readSubagentSessionResources([{ type: "custom", customType: "pi-web:subagent", data: {
    version: 1, parentSessionId: "parent", parentSessionPath: "/parent.jsonl",
    resourceSnapshot: { version: 1, tools: ["read", "SubagentWorkflow", "Agent", "get_subagent_result", "steer_subagent"], appendSystemPrompt: [], loadSkills: false, loadExtensions: true, extensionScope: [] },
  } }]);
  assert.notEqual(restored, null, "null would reopen the child as an ordinary unscoped session");
  assert.deepEqual(restored.tools, ["read"]);
  assert.deepEqual(restored.extensionScope, []);
});

test("selectors use exact file/directory/npm aliases before splitting a tool suffix", () => {
  const extensions = [
    { path: "/extensions/codegraph/index.ts", tools: new Map([["query", {}], ["node", {}]]) },
    { path: "/extensions/single.ts", tools: new Map([["single", {}]]) },
    { path: "/npm/@team/adapter/src/index.ts", sourceInfo: { source: "npm:@team/adapter" }, tools: new Map([["mcp", {}], ["other", {}]]) },
  ];
  assert.deepEqual(selectSubagentExtensionTools(extensions, ["ext:single"]), ["single"]);
  assert.deepEqual(selectSubagentExtensionTools(extensions, ["ext:@team/adapter"]), ["mcp", "other"]);
  assert.deepEqual(selectSubagentExtensionTools(extensions, ["ext:@team/adapter/mcp"]), ["mcp"]);
  assert.deepEqual(selectSubagentExtensionTools(extensions, ["ext:codegraph/query"]), ["query"]);
  assert.deepEqual(selectSubagentExtensionTools(extensions, ["ext:src", "ext:index", "ext:extensions", "ext:local"]), []);
  assert.deepEqual(withSubagentExtensionTools(["read"], ["SubagentWorkflow", "Agent", "get_subagent_result", "steer_subagent", "query"]), ["read", "query"]);
});

test("scopes prevent imports, factories, and provider registration before loading; inline prompt and skills survive", async (t) => {
  const f = await fixture(t);
  await f.extension(join(f.agentDir, "extensions/codegraph/index.ts"), "selected");
  await f.extension(join(f.agentDir, "extensions/unselected.ts"), "unselected");
  await f.extension(join(f.agentDir, "extensions/disabled.ts"), "disabled");
  await f.extension(join(f.cwd, ".pi/extensions/project.ts"), "project");
  await f.put(join(f.agentDir, "settings.json"), JSON.stringify({ extensions: ["-extensions/disabled.ts"] }));
  await f.put(join(f.agentDir, "skills/keep/SKILL.md"), "---\nname: keep\ndescription: Keep skill\n---\nKeep body");
  await f.put(join(f.agentDir, "skills/drop/SKILL.md"), "---\nname: drop\ndescription: Drop skill\n---\nDrop body");
  f.options.resourceLoaderOptions = { ...f.options.resourceLoaderOptions, noSkills: false, skillsOverride: subagentSkillsOverride(["keep"]), extensionFactories: [createExactSystemPromptExtension(() => "exact prompt")] };
  f.options.resourceLoaderReloadOptions = { resolveProjectTrust: async () => { throw new Error("scope must not bootstrap extensions"); } };
  const services = await createScopedAgentSessionServices(f.options, ["codegraph", "disabled", "project"]);
  assert.deepEqual(services.resourceLoader.getExtensions().errors, []);
  assert.ok(existsSync(join(f.root, "selected.import")));
  assert.ok(existsSync(join(f.root, "selected.factory")));
  for (const name of ["unselected", "disabled", "project"]) {
    assert.equal(existsSync(join(f.root, name + ".import")), false, name);
    assert.equal(existsSync(join(f.root, name + ".factory")), false, name);
    assert.equal(services.modelRuntime.getProvider("scope-" + name), undefined);
  }
  assert.ok(services.modelRuntime.getProvider("scope-selected"));
  assert.deepEqual(services.resourceLoader.getSkills().skills.map((s) => s.name), ["keep"]);
  const inline = services.resourceLoader.getExtensions().extensions.find((e) => e.handlers.has("before_agent_start"));
  assert.equal((await inline.handlers.get("before_agent_start")[0]({}, {})).systemPrompt, "exact prompt");
});

test("reload replaces retained paths after trust revocation and settings disable, including concurrent reloads", async (t) => {
  const f = await fixture(t);
  await f.extension(join(f.cwd, ".pi/extensions/project.ts"), "project");
  await f.extension(join(f.agentDir, "extensions/global.ts"), "global");
  new ProjectTrustStore(f.agentDir).set(f.cwd, true);
  const services = await createScopedAgentSessionServices(f.options, ["project", "global"]);
  assert.equal(services.resourceLoader.getExtensions().extensions.length, 2);
  const beforeProject = await readFile(join(f.root, "project.factory"), "utf8");
  const beforeGlobal = await readFile(join(f.root, "global.factory"), "utf8");
  new ProjectTrustStore(f.agentDir).set(f.cwd, false);
  await f.put(join(f.agentDir, "settings.json"), JSON.stringify({ extensions: ["-extensions/global.ts"] }));
  await Promise.all([services.resourceLoader.reload(), services.resourceLoader.reload({ resolveProjectTrust: async () => true })]);
  assert.deepEqual(services.resourceLoader.getExtensions().extensions, []);
  assert.equal(await readFile(join(f.root, "project.factory"), "utf8"), beforeProject);
  assert.equal(await readFile(join(f.root, "global.factory"), "utf8"), beforeGlobal);
  await f.put(join(f.agentDir, "settings.json"), "{}");
  await services.resourceLoader.reload();
  assert.equal(services.resourceLoader.getExtensions().extensions.length, 1);
});

test("empty, missing, disabled, and restored scopes share startup semantics", async (t) => {
  const f = await fixture(t);
  await f.extension(join(f.agentDir, "extensions/alpha.ts"), "alpha");
  for (const [scope, disabled, count] of [[[], false, 0], [["alpha"], true, 0], [["alpha"], false, 1], [undefined, false, 1]]) {
    const restored = resources(scope);
    const services = await createScopedAgentSessionServices({ ...f.options, resourceLoaderOptions: { ...f.options.resourceLoaderOptions, noExtensions: disabled } }, restored.extensionScope);
    assert.equal(services.resourceLoader.getExtensions().extensions.length, count);
    if (count === 0) assert.equal(existsSync(join(f.root, "alpha.import")), false);
  }
});

test("SDK child tool exclusion blocks every control tool even when an extension registers it", async (t) => {
  const f = await fixture(t);
  await f.put(join(f.agentDir, "extensions/control.ts"), `export default function(pi) {
    for (const name of ['Agent', 'SubagentWorkflow', 'get_subagent_result', 'steer_subagent', 'allowed']) {
      pi.registerTool({ name, label: name, description: name, parameters: { type: 'object', properties: {} }, async execute() { return { content: [], details: {} }; } });
    }
  }`);
  const services = await createScopedAgentSessionServices(f.options, ["control"]);
  const { session } = await createAgentSessionFromServices({ services, sessionManager: SessionManager.inMemory(f.cwd), excludeTools: [...SUBAGENT_CONTROL_TOOL_NAMES] });
  try {
    assert.ok(session.getAllTools().some((tool) => tool.name === "allowed"));
    for (const name of ["Agent", "SubagentWorkflow", "get_subagent_result", "steer_subagent"]) {
      assert.equal(session.getAllTools().some((tool) => tool.name === name), false, name);
    }
  } finally { session.dispose(); }
});

test("package sources select npm and scoped npm entrypoints without generic aliases", async (t) => {
  const f = await fixture(t);
  const packages = ["pi-mcp-adapter", "@team/adapter"];
  for (const name of packages) {
    const dir = join(f.agentDir, "npm/node_modules", name);
    await f.put(join(dir, "package.json"), JSON.stringify({ name, version: "1.0.0", pi: { extensions: ["src/index.ts"] } }));
    await f.extension(join(dir, "src/index.ts"), name === "pi-mcp-adapter" ? "mcp" : "scoped");
  }
  await f.put(join(f.agentDir, "settings.json"), JSON.stringify({ packages: packages.map((name) => "npm:" + name) }));
  await f.settingsManager.reload();
  const discovered = await new DefaultPackageManager({ cwd: f.cwd, agentDir: f.agentDir, settingsManager: f.settingsManager }).resolve();
  assert.equal(discovered.extensions.length, 2, "local npm fixture resolves without installation/network");
  const services = await createScopedAgentSessionServices(f.options, ["pi-mcp-adapter"]);
  assert.ok(existsSync(join(f.root, "mcp.factory")));
  assert.equal(existsSync(join(f.root, "scoped.import")), false);
  assert.equal(services.resourceLoader.getExtensions().extensions[0].sourceInfo.source, "npm:pi-mcp-adapter");
  const scoped = await createScopedAgentSessionServices(f.options, ["@team/adapter"]);
  assert.equal(scoped.resourceLoader.getExtensions().extensions[0].sourceInfo.source, "npm:@team/adapter");
});
