import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const {
  isModelNetworkDisabled,
  modelCatalogSignature,
  refreshModelCatalogs,
} = await jiti.import("./model-catalog-refresh.ts");

function model(provider, id, name = id) {
  return { provider, id, name };
}

test("catalog signature ignores the order models are listed in", () => {
  const first = modelCatalogSignature([
    model("kimi-coding", "k3"),
    model("kimi-coding", "K2.8-preview"),
  ]);
  const second = modelCatalogSignature([
    model("kimi-coding", "K2.8-preview"),
    model("kimi-coding", "k3"),
  ]);

  assert.equal(first, second);
});

test("catalog signature moves when a model is added, renamed, or changes provider", () => {
  const baseline = modelCatalogSignature([model("kimi-coding", "k3")]);

  assert.notEqual(
    modelCatalogSignature([model("kimi-coding", "k3"), model("kimi-coding", "K2.8-preview")]),
    baseline,
  );
  assert.notEqual(modelCatalogSignature([model("kimi-coding", "k3", "Kimi K3")]), baseline);
  assert.notEqual(modelCatalogSignature([model("moonshotai", "k3")]), baseline);
});

test("catalog signature does not confuse a provider/id split with a model id", () => {
  assert.notEqual(
    modelCatalogSignature([model("stepfun", "Step-5-Preview")]),
    modelCatalogSignature([model("commandcode", "stepfun/Step-5-Preview")]),
  );
});

test("PI_OFFLINE keeps its pi meaning: any value, empty included, disables the network", () => {
  const previous = process.env.PI_OFFLINE;
  try {
    delete process.env.PI_OFFLINE;
    assert.equal(isModelNetworkDisabled(), false);
    process.env.PI_OFFLINE = "";
    assert.equal(isModelNetworkDisabled(), true);
    process.env.PI_OFFLINE = "0";
    assert.equal(isModelNetworkDisabled(), true);
  } finally {
    if (previous === undefined) delete process.env.PI_OFFLINE;
    else process.env.PI_OFFLINE = previous;
  }
});

test("an offline refresh says so instead of building a runtime", async () => {
  const previous = process.env.PI_OFFLINE;
  process.env.PI_OFFLINE = "1";
  try {
    assert.deepEqual(await refreshModelCatalogs(), {
      completed: false,
      changed: false,
      reason: "offline",
    });
  } finally {
    if (previous === undefined) delete process.env.PI_OFFLINE;
    else process.env.PI_OFFLINE = previous;
  }
});
