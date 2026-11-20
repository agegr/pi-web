import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { parseSubagentModel } = await createJiti(import.meta.url).import("./subagent-runtime.ts");

const models = [
  { provider: "openrouter", id: "anthropic/claude-sonnet" },
  { provider: "gateway", id: "zai/glm-5" },
  { provider: "anthropic", id: "claude-opus" },
];
const runtime = {
  getModels: () => models,
  getModel: (provider, id) => models.find((model) => model.provider === provider && model.id === id),
};

test("a subagent model reference may be a bare id that contains a slash", () => {
  assert.equal(parseSubagentModel(runtime, "zai/glm-5")?.model, models[1]);
  assert.equal(parseSubagentModel(runtime, "anthropic/claude-sonnet")?.model, models[0]);
  assert.equal(parseSubagentModel(runtime, "zai/glm-5:high")?.thinkingLevel, "high");
});

test("provider/modelId still names the provider first", () => {
  assert.equal(parseSubagentModel(runtime, "openrouter/anthropic/claude-sonnet")?.model, models[0]);
  assert.equal(parseSubagentModel(runtime, "anthropic/claude-opus")?.model, models[2]);
});
