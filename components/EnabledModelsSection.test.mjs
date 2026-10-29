import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  enabledModelsBulkActions,
  enabledModelsProviderToggle,
  filterEnabledModels,
  isLastEnabledModel,
  providerBadgeLabel,
} = await jiti.import("./enabled-models-helpers.ts");

const entry = (id, enabled, extra = {}) => ({
  id,
  name: id.toUpperCase(),
  ref: `anthropic/${id}`,
  enabled,
  ...extra,
});

function view(models, overrides = {}) {
  return {
    allEnabled: false,
    patterns: ["anthropic/*"],
    stalePatterns: [],
    enabledTotal: models.filter((model) => model.enabled).length,
    availableTotal: models.length,
    providers: [{
      id: "anthropic",
      name: "Anthropic",
      kind: "builtin",
      enabledCount: models.filter((model) => model.enabled).length,
      models,
    }],
    scope: "global",
    editable: true,
    ...overrides,
  };
}

test("the filter matches model ids and display names", () => {
  const models = [entry("sonnet", true), entry("opus", false)];
  assert.deepEqual(filterEnabledModels(models, "opu").map((model) => model.id), ["opus"]);
  assert.deepEqual(filterEnabledModels(models, "SONNET").map((model) => model.id), ["sonnet"]);
  assert.equal(filterEnabledModels(models, "   ").length, 2);
});

test("bulk actions only offer the direction that changes something", () => {
  const models = [entry("sonnet", true), entry("opus", false)];
  // Other providers keep models on, so both directions are live here.
  const actions = enabledModelsBulkActions(view(models, { enabledTotal: 4 }), models);
  assert.deepEqual(actions.enableRefs, ["anthropic/opus"]);
  assert.deepEqual(actions.disableRefs, ["anthropic/sonnet"]);
  assert.equal(actions.canEnable, true);
  assert.equal(actions.canDisable, true);

  const allOn = [entry("sonnet", true), entry("opus", true)];
  assert.equal(enabledModelsBulkActions(view(allOn), allOn).canEnable, false);
});

test("a bulk disable that would empty the scope is withheld", () => {
  const models = [entry("sonnet", true), entry("opus", false)];
  const actions = enabledModelsBulkActions(view(models), models);
  assert.equal(actions.canDisable, false);
  assert.deepEqual(actions.disableRefs, ["anthropic/sonnet"]);
});

test("a bulk disable stays available while other providers keep models on", () => {
  const models = [entry("sonnet", true)];
  const scoped = view(models, { enabledTotal: 3, availableTotal: 5 });
  assert.equal(enabledModelsBulkActions(scoped, models).canDisable, true);
});

test("read-only project scope disables both bulk actions", () => {
  const models = [entry("sonnet", true), entry("opus", false)];
  const readOnly = view(models, { scope: "project", editable: false, enabledTotal: 4 });
  const actions = enabledModelsBulkActions(readOnly, models);
  assert.equal(actions.canEnable, false);
  assert.equal(actions.canDisable, false);
});

test("the last enabled model is locked on", () => {
  const models = [entry("sonnet", true), entry("opus", false)];
  const single = view(models);
  assert.equal(isLastEnabledModel(single, models[0]), true);
  assert.equal(isLastEnabledModel(single, models[1]), false);
  assert.equal(isLastEnabledModel(view(models, { enabledTotal: 2 }), models[0]), false);
});

test("the sidebar badge only appears while the selector is narrowed", () => {
  const models = [entry("sonnet", true), entry("opus", false)];
  assert.equal(providerBadgeLabel(view(models), "anthropic"), "1/2");
  assert.equal(providerBadgeLabel(view(models, { allEnabled: true }), "anthropic"), null);
  assert.equal(providerBadgeLabel(view(models), "openai"), null);
  assert.equal(providerBadgeLabel(null, "anthropic"), null);
});

test("the provider switch is on only while every model of the provider is", () => {
  const providerOf = (models, overrides = {}) => {
    const full = view(models, overrides);
    return [full, { ...full.providers[0], kind: "custom" }];
  };

  // Other providers keep models on, so both directions are live here.
  const [allOn, allOnProvider] = providerOf([entry("sonnet", true), entry("opus", true)], { enabledTotal: 4 });
  assert.deepEqual(enabledModelsProviderToggle(allOn, allOnProvider), { checked: true, blocked: false, reason: null });

  // A partial selection reads as off, and one click completes it.
  const [partial, partialProvider] = providerOf([entry("sonnet", true), entry("opus", false)], { enabledTotal: 4 });
  assert.deepEqual(enabledModelsProviderToggle(partial, partialProvider), { checked: false, blocked: false, reason: null });

  const [none, noneProvider] = providerOf([entry("sonnet", false), entry("opus", false)], { enabledTotal: 3 });
  assert.deepEqual(enabledModelsProviderToggle(none, noneProvider), { checked: false, blocked: false, reason: null });
});

test("the provider switch is locked when it would empty the scope or the file is read-only", () => {
  const lockedOn = view([entry("sonnet", true), entry("opus", true)], { enabledTotal: 2 });
  assert.deepEqual(
    enabledModelsProviderToggle(lockedOn, { ...lockedOn.providers[0], kind: "custom" }),
    { checked: true, blocked: true, reason: "last-model" },
  );

  const readOnly = view([entry("sonnet", true), entry("opus", false)], {
    scope: "project",
    editable: false,
    enabledTotal: 4,
  });
  assert.deepEqual(
    enabledModelsProviderToggle(readOnly, { ...readOnly.providers[0], kind: "custom" }),
    { checked: false, blocked: true, reason: "project-scope" },
  );
});
