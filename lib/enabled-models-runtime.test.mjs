import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, sep } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const agentDir = await mkdtemp(join(tmpdir(), "pi-web-enabled-models-"));
const projectDir = await mkdtemp(join(tmpdir(), "pi-web-enabled-models-project-"));

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const {
  buildEnabledModelsInput,
  resolveProviderGlobs,
  buildEnabledModelsView,
  customProviderIds,
  readEnabledModelsSettings,
  resolvePatternMatches,
  writeEnabledModels,
} = await jiti.import("./enabled-models-runtime.ts");
const { SettingsManager } = await jiti.import("@earendil-works/pi-coding-agent");

after(async () => {
  await rm(agentDir, { recursive: true, force: true });
  await rm(projectDir, { recursive: true, force: true });
});

const model = (provider, id, name = id) => ({
  provider,
  id,
  name,
  api: "anthropic-messages",
  reasoning: false,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 1000,
  maxTokens: 100,
  input: ["text"],
});

const MODELS = [
  model("anthropic", "claude-sonnet-4-6", "Claude Sonnet 4.6"),
  model("anthropic", "claude-opus-4-1", "Claude Opus 4.1"),
  model("openai", "gpt-5.5", "GPT-5.5"),
  model("my-gateway", "house-model", "House Model"),
];

test("each pattern is resolved on its own, with its thinking pin", async () => {
  const resolutions = await resolvePatternMatches(
    ["anthropic/*:high", "openai/gpt-5.5", "gone/*"],
    MODELS,
  );
  assert.deepEqual(resolutions, [
    {
      pattern: "anthropic/*:high",
      matched: ["anthropic/claude-sonnet-4-6", "anthropic/claude-opus-4-1"],
      pin: "high",
    },
    { pattern: "openai/gpt-5.5", matched: ["openai/gpt-5.5"] },
    { pattern: "gone/*", matched: [] },
  ]);
});

test("a bare id shared by two providers resolves to a single owner", async () => {
  // `lib/model-scope.ts` rejects this entry for the selector; the panel still
  // has to show something, and any edit rewrites it to an explicit reference.
  const twins = [model("a", "same-id"), model("b", "same-id")];
  const [resolution] = await resolvePatternMatches(["same-id"], twins);
  assert.equal(resolution.matched.length, 1);
  assert.ok(["a/same-id", "b/same-id"].includes(resolution.matched[0]));
});

test("the view groups models by provider and marks custom ones", async () => {
  const input = await buildEnabledModelsInput(["anthropic/claude-opus-4-1", "my-gateway/*"], MODELS);
  const view = buildEnabledModelsView({
    input,
    models: MODELS,
    providerNames: new Map([["anthropic", "Anthropic"], ["openai", "OpenAI"]]),
    customProviders: new Set(["my-gateway"]),
    scope: "global",
    settingsPath: "~/.pi/agent/settings.json",
  });

  assert.equal(view.allEnabled, false);
  assert.equal(view.enabledTotal, 2);
  assert.equal(view.availableTotal, 4);
  assert.deepEqual(view.providers.map((provider) => [provider.id, provider.kind, provider.enabledCount]), [
    ["anthropic", "builtin", 1],
    ["my-gateway", "custom", 1],
    ["openai", "builtin", 0],
  ]);
  // Falls back to the provider id when the runtime has no display name.
  assert.equal(view.providers[1].name, "my-gateway");
  assert.deepEqual(
    view.providers[0].models.map((entry) => [entry.id, entry.enabled]),
    [["claude-opus-4-1", true], ["claude-sonnet-4-6", false]],
  );
  assert.equal(view.editable, true);
});

test("a stale-only scope reads as everything enabled", async () => {
  const input = await buildEnabledModelsInput(["gone/*"], MODELS);
  const view = buildEnabledModelsView({
    input,
    models: MODELS,
    providerNames: new Map(),
    customProviders: new Set(),
    scope: "global",
    settingsPath: "~/.pi/agent/settings.json",
  });
  assert.equal(view.allEnabled, true);
  assert.equal(view.enabledTotal, 4);
  assert.deepEqual(view.stalePatterns, ["gone/*"]);
  assert.ok(view.providers.every((provider) => provider.models.every((entry) => entry.enabled)));
});

test("thinking pins reach the view read-only", async () => {
  const input = await buildEnabledModelsInput(["anthropic/*:xhigh"], MODELS);
  const view = buildEnabledModelsView({
    input,
    models: MODELS,
    providerNames: new Map(),
    customProviders: new Set(),
    scope: "global",
    settingsPath: "~/.pi/agent/settings.json",
  });
  const anthropic = view.providers.find((provider) => provider.id === "anthropic");
  assert.ok(anthropic.models.every((entry) => entry.thinkingPin === "xhigh"));
});

test("a provider glob is verified, so nested model ids are not dropped", async () => {
  // minimatch's `*` stops at `/`, so `commandcode/*` matches only `gpt-5.5`.
  const nested = [
    model("commandcode", "gpt-5.5"),
    model("commandcode", "sakana/fugu-ultra"),
    model("openai", "gpt-5.5"),
  ];
  assert.deepEqual(await resolveProviderGlobs(nested), {
    commandcode: "commandcode/**",
    openai: "openai/*",
  });

  const [shallow, deep] = await resolvePatternMatches(
    ["commandcode/*", "commandcode/**"],
    nested,
  );
  assert.deepEqual(shallow.matched, ["commandcode/gpt-5.5"]);
  assert.equal(deep.matched.length, 2);
});

test("a glob is rejected when another provider's model id wears it as a prefix", async () => {
  // pi matches a pattern against the bare model id too, so `stepfun/*` reaches
  // commandcode's `stepfun/Step-5-Preview`. Neither candidate glob is clean.
  const mixed = [
    model("stepfun", "aaa"),
    model("stepfun", "ddd"),
    model("commandcode", "stepfun/Step-5-Preview"),
  ];
  const globs = await resolveProviderGlobs(mixed);
  assert.equal(globs.stepfun, undefined);
  assert.equal(globs.commandcode, "commandcode/**");

  const [shallow] = await resolvePatternMatches(["stepfun/*"], mixed);
  assert.ok(shallow.matched.includes("commandcode/stepfun/Step-5-Preview"));
});

test("provider globs are only resolved for an edit", async () => {
  const read = await buildEnabledModelsInput(["anthropic/*"], MODELS);
  assert.equal(read.providerGlobs, undefined);
  const edit = await buildEnabledModelsInput(["anthropic/*"], MODELS, { withProviderGlobs: true });
  assert.equal(edit.providerGlobs.anthropic, "anthropic/*");
});

test("providers defined only by models.json count as custom", () => {
  const runtime = {
    getProviders: () => [{ id: "anthropic" }, { id: "my-gateway" }, { id: "ext-provider" }],
    getRegisteredProviderIds: () => ["ext-provider"],
  };
  assert.deepEqual([...customProviderIds(runtime)], ["my-gateway"]);
});

test("a project-level value is reported as shadowing the global one", async () => {
  await writeFile(join(agentDir, "settings.json"), JSON.stringify({ enabledModels: ["anthropic/*"] }));
  const paths = { cwd: projectDir, agentDir };
  let manager = SettingsManager.create(projectDir, agentDir);
  assert.deepEqual(readEnabledModelsSettings(manager, paths), {
    patterns: ["anthropic/*"],
    scope: "global",
    path: join(agentDir, "settings.json"),
  });

  const { mkdir } = await import("node:fs/promises");
  await mkdir(join(projectDir, ".pi"), { recursive: true });
  await writeFile(
    join(projectDir, ".pi", "settings.json"),
    JSON.stringify({ enabledModels: ["openai/*"] }),
  );
  manager = SettingsManager.create(projectDir, agentDir);
  assert.deepEqual(readEnabledModelsSettings(manager, paths), {
    patterns: ["openai/*"],
    scope: "project",
    path: join(projectDir, ".pi", "settings.json"),
  });
});

test("the banner's path shortens the home directory to a tilde", async () => {
  // A directory with no project settings, so the global file is the one named.
  const plainDir = await mkdtemp(join(tmpdir(), "pi-web-enabled-models-plain-"));
  const home = homedir();
  const manager = SettingsManager.create(plainDir, agentDir);
  assert.equal(
    readEnabledModelsSettings(manager, { cwd: plainDir, agentDir: join(home, ".pi", "agent") }).path,
    `~${sep}.pi${sep}agent${sep}settings.json`,
  );
  // A path that only starts with the same characters is left alone.
  assert.equal(
    readEnabledModelsSettings(manager, { cwd: plainDir, agentDir: `${home}-backup` }).path,
    join(`${home}-backup`, "settings.json"),
  );
  await rm(plainDir, { recursive: true, force: true });
});

test("writing keeps unrelated settings and drops the key when unscoped", async () => {
  const settingsPath = join(agentDir, "settings.json");
  await writeFile(settingsPath, JSON.stringify({ theme: "dark", enabledModels: ["anthropic/*"] }));

  let manager = SettingsManager.create(projectDir, agentDir);
  await writeEnabledModels(manager, ["openai/*", "anthropic/claude-opus-4-1:high"]);
  assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), {
    theme: "dark",
    enabledModels: ["openai/*", "anthropic/claude-opus-4-1:high"],
  });

  manager = SettingsManager.create(projectDir, agentDir);
  await writeEnabledModels(manager, undefined);
  assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), { theme: "dark" });
});

test("a malformed settings file fails the write instead of silently dropping it", async () => {
  const brokenAgentDir = await mkdtemp(join(tmpdir(), "pi-web-enabled-models-broken-"));
  const settingsPath = join(brokenAgentDir, "settings.json");
  await writeFile(settingsPath, "{ not json");
  const manager = SettingsManager.create(projectDir, brokenAgentDir);
  await assert.rejects(() => writeEnabledModels(manager, ["openai/*"]));
  assert.equal(await readFile(settingsPath, "utf8"), "{ not json");
  await rm(brokenAgentDir, { recursive: true, force: true });
});
