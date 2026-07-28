import assert from "node:assert/strict";
import test from "node:test";

import { invalidateModelsCache, loadModelsWithCache, withModelRuntimeError } from "./models-cache.ts";

function modelsData(id) {
  return {
    models: { [`provider:${id}`]: id },
    modelList: [{ id, name: id, provider: "provider" }],
    defaultModel: null,
    thinkingLevels: {},
    thinkingLevelMaps: {},
  };
}

test("caches model data independently for each cwd", async () => {
  invalidateModelsCache();
  let firstLoads = 0;
  let secondLoads = 0;

  const first = await loadModelsWithCache("/first", async () => {
    firstLoads += 1;
    return modelsData("first");
  });
  await loadModelsWithCache("/second", async () => {
    secondLoads += 1;
    return modelsData("second");
  });
  const firstAgain = await loadModelsWithCache("/first", async () => {
    firstLoads += 1;
    return modelsData("replacement");
  });

  assert.deepEqual(firstAgain, first);
  assert.equal(firstLoads, 1);
  assert.equal(secondLoads, 1);
});

test("shares one loader between concurrent requests for the same cwd", async () => {
  invalidateModelsCache();
  let loads = 0;
  let finishLoad;
  const loader = () => {
    loads += 1;
    return new Promise((resolve) => { finishLoad = resolve; });
  };

  const first = loadModelsWithCache("/shared", loader);
  const second = loadModelsWithCache("/shared", loader);
  await Promise.resolve();

  assert.equal(loads, 1);
  finishLoad(modelsData("shared"));
  assert.deepEqual(await second, await first);
});

test("does not cache a stale load that finishes after invalidation", async () => {
  invalidateModelsCache();
  let finishOldLoad;
  const oldLoad = loadModelsWithCache("/stale", () => new Promise((resolve) => { finishOldLoad = resolve; }));
  await Promise.resolve();

  invalidateModelsCache();
  let freshLoads = 0;
  const fresh = await loadModelsWithCache("/stale", async () => {
    freshLoads += 1;
    return modelsData("fresh");
  });
  finishOldLoad(modelsData("stale"));
  await oldLoad;

  const cached = await loadModelsWithCache("/stale", async () => {
    freshLoads += 1;
    return modelsData("unexpected");
  });
  assert.deepEqual(cached, fresh);
  assert.equal(freshLoads, 1);
});

test("retries after a model load fails", async () => {
  invalidateModelsCache();
  await assert.rejects(
    loadModelsWithCache("/failed", async () => { throw new Error("load failed"); }),
    /load failed/,
  );

  let retries = 0;
  const fresh = await loadModelsWithCache("/failed", async () => {
    retries += 1;
    return modelsData("fresh");
  });
  assert.deepEqual(fresh, modelsData("fresh"));
  assert.equal(retries, 1);
});

test("adds runtime errors without discarding available models", () => {
  const data = modelsData("builtin");
  const result = withModelRuntimeError(data, "Invalid models.json schema");

  assert.deepEqual(result, {
    ...data,
    modelError: "Invalid models.json schema",
  });
});
