import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const { persistExplicitStartupPreferences } = await createJiti(import.meta.url)
  .import("./startup-preferences.ts");

async function withSettings(run) {
  const root = await mkdtemp(join(tmpdir(), "pi-web-startup-preferences-"));
  const cwd = join(root, "cwd");
  const agentDir = join(root, "agent");
  await mkdir(cwd);
  await mkdir(agentDir);

  try {
    const settings = SettingsManager.create(cwd, agentDir);
    await run({ settings, settingsPath: join(agentDir, "settings.json") });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("does not persist explicit model/thinking selections into global defaults", async () => {
  await withSettings(async ({ settings }) => {
    settings.setDefaultModelAndProvider("saved", "saved-model");
    settings.setDefaultThinkingLevel("medium");
    await settings.flush();

    const result = await persistExplicitStartupPreferences(
      settings,
      {
        model: { provider: "deepseek", modelId: "deepseek-chat" },
        thinkingLevel: "xhigh",
      },
      {
        model: { provider: "deepseek", modelId: "deepseek-chat" },
        thinkingLevel: "high",
        supportsThinking: true,
      },
    );

    assert.equal(settings.getDefaultProvider(), "saved");
    assert.equal(settings.getDefaultModel(), "saved-model");
    assert.equal(settings.getDefaultThinkingLevel(), "medium");
    assert.equal(result.modelDefaultChanged, false);
  });
});

test("does not persist when only an implicit scope model is effective", async () => {
  await withSettings(async ({ settings }) => {
    settings.setDefaultModelAndProvider("saved", "saved-model");
    settings.setDefaultThinkingLevel("medium");
    await settings.flush();

    const result = await persistExplicitStartupPreferences(
      settings,
      {},
      {
        model: { provider: "scoped", modelId: "scoped-model" },
        thinkingLevel: "high",
        supportsThinking: true,
      },
    );

    assert.equal(settings.getDefaultProvider(), "saved");
    assert.equal(settings.getDefaultModel(), "saved-model");
    assert.equal(settings.getDefaultThinkingLevel(), "medium");
    assert.equal(result.modelDefaultChanged, false);
  });
});

test("does not persist when startup resolved a different model than requested", async () => {
  await withSettings(async ({ settings }) => {
    const result = await persistExplicitStartupPreferences(
      settings,
      { model: { provider: "requested", modelId: "requested-model" } },
      {
        model: { provider: "fallback", modelId: "fallback-model" },
        thinkingLevel: "off",
        supportsThinking: false,
      },
    );

    assert.equal(settings.getDefaultProvider(), undefined);
    assert.equal(settings.getDefaultModel(), undefined);
    assert.equal(result.modelDefaultChanged, false);
  });
});

test("does not replace a reasoning default when a non-thinking model starts", async () => {
  await withSettings(async ({ settings }) => {
    settings.setDefaultThinkingLevel("high");
    await settings.flush();

    await persistExplicitStartupPreferences(
      settings,
      { thinkingLevel: "off" },
      { thinkingLevel: "off", supportsThinking: false },
    );

    assert.equal(settings.getDefaultThinkingLevel(), "high");
  });
});
