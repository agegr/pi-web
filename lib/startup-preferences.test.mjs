import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Settings } from "@oh-my-pi/pi-coding-agent";
import { createJiti } from "jiti";

const { persistExplicitStartupPreferences } = await createJiti(import.meta.url)
  .import("./startup-preferences.ts");

async function withSettings(run) {
  const root = await mkdtemp(join(tmpdir(), "omp-web-startup-preferences-"));
  const cwd = join(root, "cwd");
  const agentDir = join(root, "agent");
  await mkdir(cwd);
  await mkdir(agentDir);

  try {
    await run({ settings: await Settings.loadIsolated({ cwd, agentDir, inMemory: true }) });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("stores an explicit browser model as omp's default model role", async () => {
  await withSettings(async ({ settings }) => {
    const result = await persistExplicitStartupPreferences(
      settings,
      {
        model: { provider: "deepseek", modelId: "deepseek-chat" },
        thinkingLevel: "high",
      },
      {
        model: { provider: "deepseek", modelId: "deepseek-chat" },
        thinkingLevel: "high",
        supportsThinking: true,
      },
    );

    assert.equal(result.modelDefaultChanged, true);
    assert.equal(settings.getModelRole("default"), "deepseek/deepseek-chat");
    assert.equal(settings.get("defaultThinkingLevel"), "high");
  });
});

test("does not persist a model the session could not honor", async () => {
  await withSettings(async ({ settings }) => {
    const result = await persistExplicitStartupPreferences(
      settings,
      { model: { provider: "deepseek", modelId: "deepseek-chat" } },
      {
        model: { provider: "anthropic", modelId: "claude-sonnet-4-6" },
        thinkingLevel: "off",
        supportsThinking: false,
      },
    );

    assert.equal(result.modelDefaultChanged, false);
    assert.equal(settings.getModelRole("default"), undefined);
  });
});

test("persists nothing when the browser made no explicit choice", async () => {
  await withSettings(async ({ settings }) => {
    const result = await persistExplicitStartupPreferences(
      settings,
      {},
      {
        model: { provider: "anthropic", modelId: "claude-sonnet-4-6" },
        thinkingLevel: "high",
        supportsThinking: true,
      },
    );

    assert.equal(result.modelDefaultChanged, false);
    assert.equal(settings.getModelRole("default"), undefined);
  });
});
