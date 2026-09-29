import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

const source = await readFile(new URL("./EnabledModelsSection.tsx", import.meta.url), "utf8");
const modelsConfigSource = await readFile(new URL("./ModelsConfig.tsx", import.meta.url), "utf8");
const cssSource = await readFile(new URL("../app/settings.css", import.meta.url), "utf8");

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

test("edits are serialized so two writes cannot race on the settings file", () => {
  assert.match(source, /if \(pendingRef\.current\) \{\s*\n\s*queuedRef\.current = \{ key, body \};\s*\n\s*return;/);
  assert.match(source, /pendingRef\.current = key;/);
  assert.match(source, /const busy = pending !== null;/);
});

test("an unfiltered bulk action is resolved by the server, a filtered one by refs", () => {
  assert.match(
    source,
    /if \(filtered\) controller\.setModels\(bulkKey, refs, enabled\);\s*\n\s*else controller\.setProvider\(provider\.id, enabled\);/,
  );
});

test("known refusals are shown as localized text, not raw server strings", () => {
  assert.match(source, /"last-model": "models\.enabledLastModel"/);
  assert.match(source, /"project-scope": "models\.enabledProjectScope"/);
  assert.match(source, /failure\.messageKey \? t\(failure\.messageKey\) : failure\.message/);
});

test("switches are locked while the scope is not editable", () => {
  assert.match(source, /disabled=\{busy \|\| !view\?\.editable \|\| lastOne\}/);
});

test("a custom provider is switched from its header, by one switch and no prose", () => {
  assert.match(source, /export function EnabledModelsProviderSwitch\(\{/);
  assert.match(source, /onChange=\{\(checked\) => controller\.setProvider\(provider\.id, checked\)\}/);
  // It sits in the detail header, left of the provider's own buttons.
  assert.match(
    modelsConfigSource,
    /<EnabledModelsProviderSwitch providerId=\{name\} controller=\{enabledModels\} \/>\s*\n\s*<ConfigButton variant="danger"/,
  );
  // Nothing about it is explained in body text any more.
  assert.doesNotMatch(source, /enabledCustomHint/);
  assert.doesNotMatch(source, /provider\.kind === "custom"/);
});

test("why the switch cannot move is a tooltip, not a paragraph", () => {
  assert.match(source, /label=\{toggle\.reason\s*\n\s*\? t\(FAILURE_KEYS\[toggle\.reason\]\)/);
  assert.match(source, /label=\{t\("models\.enabledCustomEmpty"\)\}/);
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

test("the section is mounted for built-in and api-key providers", () => {
  assert.match(
    modelsConfigSource,
    /provider\.loggedIn && <EnabledModelsSection providerId=\{provider\.id\} controller=\{enabledModels\} \/>/,
  );
  assert.match(
    modelsConfigSource,
    /provider\.configured && <EnabledModelsSection providerId=\{provider\.id\} controller=\{enabledModels\} \/>/,
  );
  assert.match(modelsConfigSource, /<EnabledModelsBanner controller=\{enabledModels\} \/>/);
  // A models.json provider gets the header switch instead of a section.
  assert.doesNotMatch(modelsConfigSource, /<EnabledModelsSection providerId=\{name\}/);
});

test("the banner offers to prune unmatched entries only when there are some", () => {
  assert.match(source, /view\.editable && stale > 0 && \(/);
  assert.match(source, /onClick=\{controller\.pruneStale\}/);
  assert.match(source, /const pruneStale = useCallback\(\(\) => mutate\("prune", \{ op: "prune" \}\)/);
});

test("a missing custom provider is not blamed on a sign-in", () => {
  const switchSource = source.slice(
    source.indexOf("export function EnabledModelsProviderSwitch"),
    source.indexOf("export function EnabledModelsSection"),
  );
  assert.match(switchSource, /t\("models\.enabledCustomEmpty"\)/);
  assert.doesNotMatch(switchSource, /enabledUnavailable/);
});

test("the section carries the usage heading font and no rule above it", () => {
  assert.match(source, /<span className="enabled-models-title">/);
  const title = cssSource.slice(cssSource.indexOf(".enabled-models-title {"));
  assert.match(title.slice(0, title.indexOf("}")), /font-size: 13px;[\s\S]*font-weight: 600;/);
  const section = cssSource.slice(cssSource.indexOf(".enabled-models-section {"));
  assert.doesNotMatch(section.slice(0, section.indexOf("}")), /border-top/);
});

test("saving models.json resyncs the switches with the pre-save intent", () => {
  assert.match(modelsConfigSource, /enabledModels\.resync\(renames, modelRenames\)/);
  assert.match(modelsConfigSource, /collectModelRenames\(config, savedModelIdsRef\.current, renamesRef\.current\)/);
  assert.match(modelsConfigSource, /savedProvidersRef\.current\.has\(original\)/);
  // Providers that were fully enabled stay fully enabled across the save.
  assert.match(source, /provider\.enabledCount === provider\.models\.length\)\s*\n\s*\.map\(\(provider\) => provider\.id\)/);
});

test("a save landing mid-toggle is queued, not dropped", () => {
  assert.match(source, /queuedRef\.current = \{ key, body \};/);
  assert.match(source, /if \(queued\) mutateRef\.current\?\.\(queued\.key, queued\.body\);/);
});

test("provider rows carry the scope badge", () => {
  const sidebar = modelsConfigSource.slice(
    modelsConfigSource.indexOf("<ConfigSidebar>"),
    modelsConfigSource.indexOf("</ConfigSidebar>"),
  );
  assert.equal(sidebar.match(/\{scopeBadge\(/g)?.length, 3);
  assert.match(cssSource, /\.models-sidebar-badge \{/);
  assert.match(cssSource, /\.enabled-models-row \+ \.enabled-models-row \{/);
});

test("the saved-model slots mirror every move the draft makes", () => {
  assert.match(modelsConfigSource, /savedModelIdsRef\.current = savedModelIds\(normalized\)/);
  assert.match(modelsConfigSource, /savedModelIdsRef\.current = savedModelIds\(config\)/);
  assert.match(modelsConfigSource, /trackAddedModels\(savedModelIdsRef\.current, providerName, 1\)/);
  assert.match(modelsConfigSource, /savedModelIdsRef\.current\.get\(providerName\)\?\.splice\(index, 1\)/);
  assert.match(modelsConfigSource, /savedModelIdsRef\.current\.delete\(name\)/);
  assert.match(modelsConfigSource, /savedModelIdsRef\.current\.set\(newName, slots\)/);
});
