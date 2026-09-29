import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const { isThinkingLevel, shadowingProjectKeys, writeDefaultPreferences } = await createJiti(import.meta.url)
  .import("./default-preferences.ts");

async function withSettings(run, { project } = {}) {
  const root = await mkdtemp(join(tmpdir(), "pi-web-default-preferences-"));
  const cwd = join(root, "cwd");
  const agentDir = join(root, "agent");
  await mkdir(cwd);
  await mkdir(agentDir);
  if (project) {
    await mkdir(join(cwd, ".pi"));
    await writeFile(join(cwd, ".pi", "settings.json"), JSON.stringify(project));
  }

  try {
    const settings = SettingsManager.create(cwd, agentDir);
    await run({ settings, settingsPath: join(agentDir, "settings.json") });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("writes the saved default model without touching the thinking default", async () => {
  await withSettings(async ({ settings, settingsPath }) => {
    settings.setDefaultThinkingLevel("medium");
    await settings.flush();

    await writeDefaultPreferences(settings, { model: { provider: "deepseek", modelId: "deepseek-chat" } });

    const saved = JSON.parse(await readFile(settingsPath, "utf8"));
    assert.equal(saved.defaultProvider, "deepseek");
    assert.equal(saved.defaultModel, "deepseek-chat");
    assert.equal(saved.defaultThinkingLevel, "medium");
  });
});

test("writes the saved default thinking level without touching the model default", async () => {
  await withSettings(async ({ settings, settingsPath }) => {
    settings.setDefaultModelAndProvider("saved", "saved-model");
    await settings.flush();

    await writeDefaultPreferences(settings, { thinkingLevel: "high" });

    const saved = JSON.parse(await readFile(settingsPath, "utf8"));
    assert.equal(saved.defaultProvider, "saved");
    assert.equal(saved.defaultModel, "saved-model");
    assert.equal(saved.defaultThinkingLevel, "high");
  });
});

test("refuses to write when the global settings file could not be loaded", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-web-default-preferences-"));
  try {
    const agentDir = join(root, "agent");
    await mkdir(agentDir);
    await writeFile(join(agentDir, "settings.json"), "{ not json");
    const settings = SettingsManager.create(root, agentDir);

    await assert.rejects(writeDefaultPreferences(settings, { thinkingLevel: "high" }));
    assert.equal(await readFile(join(agentDir, "settings.json"), "utf8"), "{ not json");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reports project keys that would hide the edited global default", async () => {
  await withSettings(async ({ settings }) => {
    assert.deepEqual(
      shadowingProjectKeys(settings, { model: { provider: "a", modelId: "b" }, thinkingLevel: "low" }),
      ["defaultModel", "defaultThinkingLevel"],
    );
    // A project value for a field this edit does not write is irrelevant.
    assert.deepEqual(shadowingProjectKeys(settings, { model: { provider: "a", modelId: "b" } }), ["defaultModel"]);
  }, { project: { defaultModel: "project-model", defaultThinkingLevel: "off" } });

  await withSettings(async ({ settings }) => {
    assert.deepEqual(shadowingProjectKeys(settings, { thinkingLevel: "low" }), []);
  }, { project: { defaultProvider: "p" } });
});

test("accepts only pi thinking levels", () => {
  for (const level of ["off", "minimal", "low", "medium", "high", "xhigh", "max"]) {
    assert.equal(isThinkingLevel(level), true);
  }
  assert.equal(isThinkingLevel("auto"), false);
  assert.equal(isThinkingLevel(undefined), false);
});
