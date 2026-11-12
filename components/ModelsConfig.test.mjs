import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  collectModelRenames,
  deleteProviderEntry,
  hasModelCostDraftValue,
  modelCostToDraft,
  modelDropIndex,
  modelSidebarLabel,
  moveModelEntry,
  parseCompleteModelCost,
  providerRuntimeName,
  providerSidebarLabel,
  providerMatchesSearch,
  renameProviderEntry,
  savedModelIds,
  savedProviderNames,
  serializeHeaderRows,
  setCompatBool,
  setCompatFlag,
  setProviderDisplayName,
  sortModelEntries,
  trackAddedModels,
  updateHeaderRow,
} = await jiti.import("./models-config-helpers.ts");

test("disabling the developer role writes an explicit false override", () => {
  assert.deepEqual(
    setCompatBool({ compat: { supportsStore: true } }, "supportsDeveloperRole", false),
    { compat: { supportsStore: true, supportsDeveloperRole: false } },
  );
});

test("switching adaptive thinking off removes the override instead of writing false", () => {
  const on = setCompatFlag({ id: "claude-opus-5-5" }, "forceAdaptiveThinking", true);
  assert.deepEqual(on, { id: "claude-opus-5-5", compat: { forceAdaptiveThinking: true } });
  assert.deepEqual(setCompatFlag(on, "forceAdaptiveThinking", false), { id: "claude-opus-5-5", compat: undefined });
  assert.deepEqual(
    setCompatFlag({ compat: { supportsStore: true, forceAdaptiveThinking: true } }, "forceAdaptiveThinking", false),
    { compat: { supportsStore: true } },
  );
});

test("a model switches off adaptive thinking its provider turns on with an explicit false", () => {
  assert.deepEqual(
    setCompatFlag({ id: "claude-haiku-4-5" }, "forceAdaptiveThinking", false, true),
    { id: "claude-haiku-4-5", compat: { forceAdaptiveThinking: false } },
  );
  const entry = { id: "claude-opus-5-5", compat: { forceAdaptiveThinking: false } };
  assert.deepEqual(setCompatFlag(entry, "forceAdaptiveThinking", true, true), { id: "claude-opus-5-5", compat: undefined });
  const plain = { id: "claude-opus-5-5" };
  assert.equal(setCompatFlag(plain, "forceAdaptiveThinking", false), plain);
});

test("editing a header preserves row order and stable identities", () => {
  const rows = [
    { id: 10, name: "X-First", value: "one" },
    { id: 11, name: "X-Second", value: "two" },
  ];
  const updated = updateHeaderRow(rows, 10, { name: "X-First-Edited" });

  assert.deepEqual(updated.map(({ id, name }) => ({ id, name })), [
    { id: 10, name: "X-First-Edited" },
    { id: 11, name: "X-Second" },
  ]);
  assert.deepEqual(serializeHeaderRows(updated), {
    "X-First-Edited": "one",
    "X-Second": "two",
  });
});

test("blank header drafts are omitted until they have a name", () => {
  const rows = [
    { id: 1, name: "X-Existing", value: "kept" },
    { id: 2, name: "", value: "draft value" },
  ];

  assert.deepEqual(serializeHeaderRows(rows), { "X-Existing": "kept" });
  assert.deepEqual(
    serializeHeaderRows(updateHeaderRow(rows, 2, { name: "X-Draft" })),
    { "X-Existing": "kept", "X-Draft": "draft value" },
  );
});

test("model cost drafts default blank prices to zero unless all are blank", () => {
  const complete = {
    input: "1.25",
    output: "10",
    cacheRead: "0.125",
    cacheWrite: "0",
  };
  assert.deepEqual(parseCompleteModelCost(complete), {
    input: 1.25,
    output: 10,
    cacheRead: 0.125,
    cacheWrite: 0,
  });
  assert.deepEqual(parseCompleteModelCost({ ...complete, input: "", cacheWrite: "" }), {
    input: 0,
    output: 10,
    cacheRead: 0.125,
    cacheWrite: 0,
  });
  assert.deepEqual(parseCompleteModelCost({ input: "1.25", output: "", cacheRead: "", cacheWrite: "" }), {
    input: 1.25,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
  });
  assert.equal(parseCompleteModelCost(modelCostToDraft()), undefined);
  assert.equal(parseCompleteModelCost({ ...complete, output: "not-a-price" }), undefined);
  assert.equal(parseCompleteModelCost({ ...complete, output: "-1" }), undefined);
  assert.equal(hasModelCostDraftValue(modelCostToDraft()), false);
  assert.equal(hasModelCostDraftValue({ ...complete, cacheWrite: "" }), true);
});

const draft = (models) => ({ providers: { stepfun: { models: models.map((id) => ({ id })) } } });

test("a model renamed in place is reported with its saved reference", () => {
  const slots = savedModelIds(draft(["aaa", "ddd"]));
  assert.deepEqual(
    collectModelRenames(draft(["aaa", "ddd1"]), slots, new Map()),
    [{ from: "stepfun/ddd", to: "stepfun/ddd1" }],
  );
});

test("a model rename keeps the provider id the settings file still spells", () => {
  const slots = savedModelIds(draft(["aaa", "ddd"]));
  // The panel renamed the provider too, so the slots moved with it.
  const moved = new Map([["house", slots.get("stepfun")]]);
  assert.deepEqual(
    collectModelRenames(
      { providers: { house: { models: [{ id: "aaa" }, { id: "ddd1" }] } } },
      moved,
      new Map([["stepfun", "house"]]),
    ),
    [{ from: "stepfun/ddd", to: "house/ddd1" }],
  );
});

test("added and removed models never look like a rename", () => {
  const slots = savedModelIds(draft(["aaa", "ddd"]));
  trackAddedModels(slots, "stepfun", 1);
  assert.deepEqual(collectModelRenames(draft(["aaa", "ddd", "new"]), slots, new Map()), []);

  const spliced = savedModelIds(draft(["aaa", "ddd"]));
  spliced.get("stepfun").splice(0, 1);
  assert.deepEqual(collectModelRenames(draft(["ddd"]), spliced, new Map()), []);
});

test("a blank id in a half-typed row is not a rename yet", () => {
  const slots = savedModelIds(draft(["aaa", "ddd"]));
  assert.deepEqual(collectModelRenames(draft(["aaa", ""]), slots, new Map()), []);
});

test("a provider added since the last save has no saved slots to compare", () => {
  assert.deepEqual(collectModelRenames(draft(["aaa"]), new Map(), new Map()), []);
});

test("moving a model changes only its provider's draft and keeps saved slots aligned", () => {
  const model = { id: "second", name: "Second", contextWindow: 1234 };
  const config = {
    providers: {
      relay: { baseUrl: "https://example.invalid/v1", models: [{ id: "first" }, model, { id: "third" }] },
      other: { models: [{ id: "keep" }] },
    },
  };
  const slots = savedModelIds(config);
  const moved = moveModelEntry(config, slots, "relay", 1, 0);
  assert.deepEqual(moved.order, [1, 0, 2]);
  assert.deepEqual(moved.config.providers.relay.models.map((entry) => entry.id), ["second", "first", "third"]);
  assert.equal(moved.config.providers.relay.models[0], model);
  assert.equal(moved.config.providers.relay.baseUrl, config.providers.relay.baseUrl);
  assert.equal(moved.config.providers.other, config.providers.other);
  assert.deepEqual(config.providers.relay.models.map((entry) => entry.id), ["first", "second", "third"]);
  assert.deepEqual(slots.get("relay"), ["second", "first", "third"]);
  assert.deepEqual(slots.get("other"), ["keep"]);
  assert.deepEqual(moveModelEntry(moved.config, slots, "relay", 0, 1).config, config);
});

test("model moves stay inside their provider's list and skip a move to the same slot", () => {
  const config = draft(["first", "second"]);
  const slots = savedModelIds(config);
  for (const [from, to] of [[0, -1], [1, 2], [-1, 0], [2, 1], [0, 0]]) {
    assert.equal(moveModelEntry(config, slots, "stepfun", from, to), null);
  }
  assert.equal(moveModelEntry(config, slots, "missing", 0, 1), null);
  assert.deepEqual(slots.get("stepfun"), ["first", "second"]);
});

test("a model moves across the list in one step, and its drop slot counts the row it leaves", () => {
  const config = draft(["a", "b", "c", "d"]);
  const slots = savedModelIds(config);
  const moved = moveModelEntry(config, slots, "stepfun", 3, 0);
  assert.deepEqual(moved.order, [3, 0, 1, 2]);
  assert.deepEqual(slots.get("stepfun"), ["d", "a", "b", "c"]);
  // Dragging "a" (slot 0): before "c" lands at 1, after "c" at 2, before "a" or "b" stays at 0.
  assert.equal(modelDropIndex(0, 2, false), 1);
  assert.equal(modelDropIndex(0, 2, true), 2);
  assert.equal(modelDropIndex(0, 0, true), 0);
  assert.equal(modelDropIndex(0, 1, false), 0);
  // Dragging "d" (slot 3) upward: before "a" lands at 0, after "b" at 2.
  assert.equal(modelDropIndex(3, 0, false), 0);
  assert.equal(modelDropIndex(3, 1, true), 2);
});

test("A–Z sorts shown names naturally and stably without changing another provider", () => {
  const sameNameFirst = { id: "z-id", name: " Same " };
  const sameNameSecond = { id: "a-id", name: "same" };
  const config = {
    providers: {
      relay: { models: [{ id: "z-id-lower", name: "model 10" }, sameNameFirst, { id: "A-id", name: "Model 2" }, sameNameSecond, { id: "beta" }, { id: "alpha" }] },
      other: { models: [{ id: "last" }] },
    },
  };
  const slots = savedModelIds(config);
  const sorted = sortModelEntries(config, slots, "relay");
  assert.deepEqual(sorted.config.providers.relay.models, [
    { id: "alpha" }, { id: "beta" }, { id: "A-id", name: "Model 2" },
    { id: "z-id-lower", name: "model 10" }, sameNameFirst, sameNameSecond,
  ]);
  assert.deepEqual(sorted.order, [5, 4, 2, 0, 1, 3]);
  assert.equal(config.providers.relay.models[0].id, "z-id-lower");
  assert.equal(sorted.config.providers.other, config.providers.other);
  assert.deepEqual(slots.get("relay"), ["alpha", "beta", "A-id", "z-id-lower", "z-id", "a-id"]);
  assert.equal(sortModelEntries(sorted.config, slots, "relay"), null);
  assert.equal(sortModelEntries(config, slots, "missing"), null);
});

test("reordering preserves rename, addition and deletion tracking", () => {
  const config = draft(["first", "second", "added"]);
  const slots = savedModelIds(draft(["first", "second"]));
  trackAddedModels(slots, "stepfun", 1);
  const moved = moveModelEntry(config, slots, "stepfun", 2, 1).config;
  const renamed = { providers: { stepfun: { models: [{ id: "first" }, { id: "new" }, { id: "second-renamed" }] } } };
  assert.deepEqual(collectModelRenames(renamed, slots, new Map()), [{ from: "stepfun/second", to: "stepfun/second-renamed" }]);
  slots.get("stepfun").splice(1, 1);
  const remaining = { providers: { stepfun: { models: renamed.providers.stepfun.models.filter((model) => model.id !== "new") } } };
  assert.deepEqual(collectModelRenames(remaining, slots, new Map()), [{ from: "stepfun/second", to: "stepfun/second-renamed" }]);
  assert.deepEqual(moved.providers.stepfun.models.map((model) => model.id), ["first", "added", "second"]);
});

const tracking = (config) => ({
  savedProviders: new Set(Object.keys(config.providers)),
  renames: new Map(),
  slots: savedModelIds(config),
});

test("renaming a provider keeps its place and moves its rename tracking", () => {
  const config = {
    providers: {
      first: { models: [{ id: "a" }] },
      stepfun: { baseUrl: "https://x", models: [{ id: "aaa" }, { id: "ddd" }] },
      last: {},
    },
  };
  const state = tracking(config);
  const renamed = renameProviderEntry(config, state, "stepfun", "house");

  assert.deepEqual(Object.keys(renamed.providers), ["first", "house", "last"]);
  assert.equal(renamed.providers.house, config.providers.stepfun);
  assert.deepEqual([...state.renames], [["stepfun", "house"]]);
  assert.deepEqual(state.slots.get("house"), ["aaa", "ddd"]);
  assert.equal(state.slots.has("stepfun"), false);
  // Renaming it back cancels the move instead of recording stepfun -> stepfun.
  renameProviderEntry(renamed, state, "house", "stepfun");
  assert.deepEqual([...state.renames], []);
});

test("renaming a provider onto another provider's id changes nothing", () => {
  const config = { providers: { one: { models: [{ id: "a" }] }, two: { models: [{ id: "b" }] } } };
  const state = tracking(config);
  assert.equal(renameProviderEntry(config, state, "one", "two"), null);
  assert.equal(renameProviderEntry(config, state, "gone", "three"), null);
  assert.deepEqual([...state.renames], []);
  assert.deepEqual([...state.slots.keys()], ["one", "two"]);
});

test("a provider added since the last save is renamed without a settings rewrite", () => {
  const config = { providers: { "new-provider": {} } };
  const state = { savedProviders: new Set(), renames: new Map(), slots: new Map() };
  const renamed = renameProviderEntry(config, state, "new-provider", "house");
  assert.deepEqual(Object.keys(renamed.providers), ["house"]);
  assert.deepEqual([...state.renames], []);
});

test("deleting a renamed or saved provider forgets its rename tracking", () => {
  const config = {
    providers: {
      stepfun: { models: [{ id: "aaa" }] },
      other: { models: [{ id: "bbb" }] },
    },
  };
  const state = tracking(config);
  const renamed = renameProviderEntry(config, state, "stepfun", "house");
  const afterDelete = deleteProviderEntry(renamed, state, "house");

  assert.deepEqual(Object.keys(afterDelete.providers), ["other"]);
  assert.deepEqual([...state.renames], []);
  assert.deepEqual([...state.savedProviders], ["other"]);
  assert.equal(state.slots.has("house"), false);

  // Another saved provider can now take the deleted id and move on cleanly.
  const movedOther = renameProviderEntry(afterDelete, state, "other", "house");
  const movedAgain = renameProviderEntry(movedOther, state, "house", "final");
  assert.deepEqual(Object.keys(movedAgain.providers), ["final"]);
  assert.deepEqual([...state.renames], [["other", "final"]]);
});

test("a new provider taking a renamed or deleted provider's old id stays untracked", () => {
  const config = { providers: { stepfun: { models: [{ id: "aaa" }] } } };
  const state = tracking(config);
  const moved = renameProviderEntry(config, state, "stepfun", "house");
  const withNew = { providers: { ...moved.providers, "new-provider": {} } };
  const tookOldId = renameProviderEntry(withNew, state, "new-provider", "stepfun");
  const renamedAgain = renameProviderEntry(tookOldId, state, "stepfun", "fresh");

  assert.deepEqual([...state.renames], [["stepfun", "house"]]);
  const afterDeletingNew = deleteProviderEntry(renamedAgain, state, "fresh");
  assert.deepEqual([...state.renames], [["stepfun", "house"]]);

  const afterDeletingSaved = deleteProviderEntry(afterDeletingNew, state, "house");
  const readded = { providers: { ...afterDeletingSaved.providers, stepfun: {} } };
  renameProviderEntry(readded, state, "stepfun", "later");
  assert.deepEqual([...state.renames], []);
});

test("Add provider's search matches a provider by id or name", () => {
  const oauth = { id: "fixture-subscription-id", name: "Fixture Subscription" };
  assert.equal(providerMatchesSearch("subscription", oauth.id, oauth.name), true);
  assert.equal(providerMatchesSearch(" FIXTURE-SUBSCRIPTION-ID ", oauth.id, oauth.name), true);
  assert.equal(providerMatchesSearch("missing", oauth.id, oauth.name), false);
  assert.equal(providerMatchesSearch("  ", oauth.id, oauth.name), true);
});

test("the Models sidebar labels a model by its name and falls back to the id", () => {
  assert.equal(modelSidebarLabel({ id: "qwen3-coder-480b-a35b-instruct", name: "Qwen Coder" }), "Qwen Coder");
  assert.equal(modelSidebarLabel({ id: "m1" }), "m1");
  assert.equal(modelSidebarLabel({ id: "m1", name: "  " }), "m1");
  assert.equal(modelSidebarLabel({ id: "", name: "" }), "");
});

test("the Models sidebar labels a provider by its models.json name and falls back to the id", () => {
  assert.equal(providerSidebarLabel("aiflashapi", { name: "AI Flash API" }), "AI Flash API");
  assert.equal(providerSidebarLabel("typesafe", {}), "typesafe");
  assert.equal(providerSidebarLabel("typesafe", { name: "  " }), "typesafe");
  assert.equal(providerSidebarLabel("openai", {}, "OpenAI"), "OpenAI");
  assert.equal(providerSidebarLabel("typesafe", {}, "TypeSafe"), "TypeSafe");
  assert.equal(providerSidebarLabel("openai", { name: "OpenAI API" }, "OpenAI"), "OpenAI API");
});

test("the provider's Display name sets or removes its models.json name and keeps the rest of the entry", () => {
  const models = [{ id: "m1" }];
  const entry = { baseUrl: "https://api.example.com/v1", api: "openai-completions", apiKey: "KEY", models };

  const named = setProviderDisplayName(entry, "Example API");
  assert.deepEqual(named, { name: "Example API", ...entry });
  assert.deepEqual(Object.keys(named), ["name", "baseUrl", "api", "apiKey", "models"]);
  assert.equal(named.models, models);
  assert.deepEqual(entry, { baseUrl: "https://api.example.com/v1", api: "openai-completions", apiKey: "KEY", models });

  // An existing name keeps its place; typed spaces stay while editing.
  const renamed = setProviderDisplayName({ baseUrl: "u", name: "Old" }, "New ");
  assert.deepEqual(Object.entries(renamed), [["baseUrl", "u"], ["name", "New "]]);

  // Blank input removes the key, so the label falls back to the id.
  for (const blank of ["", "   "]) {
    const cleared = setProviderDisplayName({ name: "5-IKUN-Codex-025", baseUrl: "u", models }, blank);
    assert.deepEqual(cleared, { baseUrl: "u", models });
    assert.equal("name" in cleared, false);
    assert.equal(providerSidebarLabel("3-ikun-plus", cleared), "3-ikun-plus");
  }
  assert.deepEqual(setProviderDisplayName({ baseUrl: "u" }, ""), { baseUrl: "u" });
});

test("a cleared provider name is not brought back by the runtime name pi read from it", () => {
  const saved = savedProviderNames({ providers: {
    "3-ikun-plus": { name: "5-IKUN-Codex-025", baseUrl: "u" },
    plain: { baseUrl: "u" },
    openai: { name: "My OpenAI", baseUrl: "u" },
  } });
  assert.deepEqual([...saved], [["3-ikun-plus", "5-IKUN-Codex-025"], ["openai", "My OpenAI"]]);
  assert.deepEqual([...savedProviderNames({})], []);

  // pi reports the saved name as the runtime name: clearing it falls back to the id.
  const runtime = providerRuntimeName("5-IKUN-Codex-025", saved.get("3-ikun-plus"));
  assert.equal(runtime, undefined);
  assert.equal(providerSidebarLabel("3-ikun-plus", {}, runtime), "3-ikun-plus");
  // A name of the runtime's own (a built-in's, an extension's) still applies.
  assert.equal(providerRuntimeName("OpenAI", saved.get("openai")), "OpenAI");
  assert.equal(providerRuntimeName("TypeSafe", saved.get("typesafe")), "TypeSafe");
  assert.equal(providerRuntimeName(undefined, undefined), undefined);
});
