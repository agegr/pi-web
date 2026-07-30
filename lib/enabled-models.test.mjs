import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  try {
    const { createJiti } = await import("jiti");
    return createJiti(import.meta.url).import("./enabled-models.ts");
  } catch {
    return import("./enabled-models.ts");
  }
}

const { filterByEnabledModels, stripThinkingSuffix } = await loadSubject();

const available = [
  { provider: "opencode", id: "big-pickle" },
  { provider: "opencode", id: "deepseek-v3-free" },
  { provider: "openai-codex", id: "gpt-5.5" },
  { provider: "DeepSeek", id: "deepseek-chat" },
  { provider: "ollama", id: "qwen3:latest" },
];

test("filters enabled models by exact provider/model and model id", () => {
  assert.deepEqual(
    filterByEnabledModels(available, ["opencode/big-pickle", "qwen3:latest"]),
    [available[0], available[4]],
  );
});

test("supports wildcard enabled model refs", () => {
  assert.deepEqual(
    filterByEnabledModels(available, ["opencode/big-pickle", "opencode/*-free", "openai-codex/*", "DeepSeek/*"]),
    [available[0], available[1], available[2], available[3]],
  );
});

test("strips known thinking suffixes without stripping model ids that contain colons", () => {
  assert.equal(stripThinkingSuffix("openai-codex/gpt-5.5:high"), "openai-codex/gpt-5.5");
  assert.equal(stripThinkingSuffix("qwen3:latest"), "qwen3:latest");
});

test("falls back to all available models when enabled model refs match nothing", () => {
  assert.deepEqual(filterByEnabledModels(available, ["missing/*"]), available);
});
