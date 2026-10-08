import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { createJiti } from "jiti";

const {
  findDeferredModel,
  rememberProviderModels,
  withDeferredProviderModels,
} = await createJiti(import.meta.url).import("./deferred-provider-models.ts");

const glm = { provider: "zai", id: "glm-4.7" };
const haiku = { provider: "claude-bridge", id: "claude-haiku-4-5" };
const opus = { provider: "claude-bridge", id: "claude-opus-5-5" };

/** `registered` is what the runtime knows; `available` the subset with working auth. */
function runtime(registered, available = registered) {
  return {
    getModels: () => registered,
    getAvailable: async (providerId) => available.filter((model) => !providerId || model.provider === providerId),
    getModel: (provider, id) => registered.find((model) => model.provider === provider && model.id === id),
    marker: "kept",
  };
}

beforeEach(() => {
  globalThis.__piWebProviderModelCatalog = undefined;
});

test("a runtime whose extension deferred its provider still lists the models seen earlier", async () => {
  // The first runtime of the process got the bridge's registration; later ones defer it to session_start.
  await rememberProviderModels(runtime([glm, haiku, opus]));
  const later = withDeferredProviderModels(runtime([glm]));
  assert.deepEqual(await later.getAvailable(), [glm, haiku, opus]);
  assert.deepEqual(await later.getAvailable("claude-bridge"), [haiku, opus]);
  assert.deepEqual(await later.getAvailable("zai"), [glm]);
  assert.equal(later.marker, "kept");
});

test("a provider the runtime registered but cannot use is not added back", async () => {
  await rememberProviderModels(runtime([glm, haiku]));
  // Signed out of claude-bridge: registered, not available. The picker must not offer it.
  const signedOut = withDeferredProviderModels(runtime([glm, haiku], [glm]));
  assert.deepEqual(await signedOut.getAvailable(), [glm]);
});

test("a deferred model is found only while this runtime lacks its provider", async () => {
  await rememberProviderModels(runtime([glm, haiku]));
  assert.deepEqual(findDeferredModel(runtime([glm]), "claude-bridge", "claude-haiku-4-5"), haiku);
  assert.equal(findDeferredModel(runtime([glm, haiku]), "claude-bridge", "claude-haiku-4-5"), undefined);
  assert.equal(findDeferredModel(runtime([glm]), "claude-bridge", "unknown"), undefined);
});
