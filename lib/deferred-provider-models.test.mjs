import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { createJiti } from "jiti";

const {
  findDeferredModel,
  findDeferredStartupModel,
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

test("a new session's deferred pick is the model /api/models pre-selects, scope and pins included", async () => {
  await rememberProviderModels(runtime([glm, haiku, opus]));
  const later = runtime([glm]);
  const defaultModel = { provider: "claude-bridge", modelId: "claude-opus-5-5" };
  assert.deepEqual(
    await findDeferredStartupModel(later, ["zai/glm-4.7", "claude-bridge/claude-opus-5-5:high"], { defaultModel }),
    { model: opus, thinkingLevelPin: "high" },
  );
  // No scope at all still picks the default.
  assert.deepEqual(await findDeferredStartupModel(later, undefined, { defaultModel }), { model: opus });
  // A default the scope leaves out is passed over for the first scoped model, deferred or not.
  assert.equal(await findDeferredStartupModel(later, ["zai/glm-4.7"], { defaultModel }), undefined);
  assert.deepEqual(
    await findDeferredStartupModel(later, ["claude-bridge/claude-haiku-4-5", "claude-bridge/claude-opus-5-5"], {
      defaultModel: { provider: "zai", modelId: "glm-4.7" },
    }),
    { model: haiku },
  );
  // A pick this runtime has needs no switch.
  assert.equal(await findDeferredStartupModel(runtime([glm, haiku, opus]), undefined, { defaultModel }), undefined);
});

test("a deferred model asked for comes back with its enabledModels pin, or not at all out of scope", async () => {
  await rememberProviderModels(runtime([glm, haiku, opus]));
  const later = runtime([glm]);
  const requestedModel = { provider: "claude-bridge", modelId: "claude-opus-5-5" };
  assert.deepEqual(
    await findDeferredStartupModel(later, ["zai/glm-4.7", "claude-bridge/*:high"], {
      requestedModel,
      defaultModel: { provider: "zai", modelId: "glm-4.7" },
    }),
    { model: opus, thinkingLevelPin: "high" },
  );
  assert.equal(await findDeferredStartupModel(later, ["zai/glm-4.7"], { requestedModel }), undefined);
});

test("a bare enabledModels id a deferred provider shares scopes both, so its default is switched to", async () => {
  // pi scopes every provider offering a bare id (pi 1.3); this runtime sees only anthropic's.
  const anthropicOpus = { provider: "anthropic", id: "claude-opus-5-5" };
  await rememberProviderModels(runtime([anthropicOpus, opus]));
  assert.deepEqual(
    await findDeferredStartupModel(runtime([anthropicOpus]), ["claude-opus-5-5"], {
      defaultModel: { provider: "claude-bridge", modelId: "claude-opus-5-5" },
    }),
    { model: opus },
  );
  // With another default the scope's first model, anthropic's, is the pick: no switch.
  assert.equal(
    await findDeferredStartupModel(runtime([anthropicOpus]), ["claude-opus-5-5"], {
      defaultModel: { provider: "zai", modelId: "glm-4.7" },
    }),
    undefined,
  );
});
