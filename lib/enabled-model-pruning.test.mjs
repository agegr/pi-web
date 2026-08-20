import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  pruneRemovedEnabledModelPatterns,
  pruneRemovedEnabledModels,
} = await jiti.import("./enabled-model-pruning.ts");

const previousConfig = {
  providers: {
    acme: {
      models: [
        { id: "removed" },
        { id: "nested/model" },
        { id: "openrouter/model:exacto" },
        { id: "remaining" },
      ],
    },
  },
};

const nextConfig = {
  providers: {
    acme: {
      models: [{ id: "remaining" }],
    },
  },
};

test("prunes only canonical references to models removed by the saved config", () => {
  const patterns = [
    "acme/removed",
    "ACME/nested/model:high",
    "acme/openrouter/model:exacto",
    "acme/remaining",
    "acme/*",
    "removed",
    "future/provider-model",
    "acme/removed:not-a-thinking-level",
  ];

  assert.deepEqual(
    pruneRemovedEnabledModelPatterns(patterns, previousConfig, nextConfig),
    [
      "acme/remaining",
      "acme/*",
      "removed",
      "future/provider-model",
      "acme/removed:not-a-thinking-level",
    ],
  );
});

test("persists a pruned global scope and reports how many entries changed", async () => {
  const calls = [];
  const settings = {
    getGlobalSettings: () => ({
      enabledModels: ["acme/removed", "acme/remaining"],
    }),
    setEnabledModels: (patterns) => calls.push(["set", patterns]),
    flush: async () => calls.push(["flush"]),
  };

  assert.equal(
    await pruneRemovedEnabledModels(settings, previousConfig, nextConfig),
    1,
  );
  assert.deepEqual(calls, [
    ["set", ["acme/remaining"]],
    ["flush"],
  ]);
});

test("clears enabledModels when every exact entry belonged to removed models", async () => {
  const calls = [];
  const settings = {
    getGlobalSettings: () => ({ enabledModels: ["acme/removed"] }),
    setEnabledModels: (patterns) => calls.push(["set", patterns]),
    flush: async () => calls.push(["flush"]),
  };

  assert.equal(
    await pruneRemovedEnabledModels(settings, previousConfig, nextConfig),
    1,
  );
  assert.deepEqual(calls, [["set", undefined], ["flush"]]);
});

test("does not write settings when config changes removed no referenced model", async () => {
  const calls = [];
  const settings = {
    getGlobalSettings: () => ({ enabledModels: ["acme/remaining", "acme/*"] }),
    setEnabledModels: (patterns) => calls.push(["set", patterns]),
    flush: async () => calls.push(["flush"]),
  };

  assert.equal(
    await pruneRemovedEnabledModels(settings, previousConfig, nextConfig),
    0,
  );
  assert.deepEqual(calls, []);
});
