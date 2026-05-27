import test from "node:test";
import assert from "node:assert/strict";

async function loadModule() {
  return import(new URL("../lib/models-config-test-connection.ts", import.meta.url).href);
}

test("pickTestModelId prefers the first configured model id", async () => {
  const { pickTestModelId } = await loadModule();
  const modelId = pickTestModelId({
    models: [
      { id: "anthropic/claude-opus-4.7" },
      { id: "backup-model" },
    ],
  });

  assert.equal(modelId, "anthropic/claude-opus-4.7");
});

test("pickTestModelId falls back to provider-level modelId when models array is empty", async () => {
  const { pickTestModelId } = await loadModule();
  const modelId = pickTestModelId({
    modelId: "anthropic/claude-opus-4.7",
    models: [],
  });

  assert.equal(modelId, "anthropic/claude-opus-4.7");
});
