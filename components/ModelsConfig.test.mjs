import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  collectModelRenames,
  hasModelCostDraftValue,
  modelCostToDraft,
  parseCompleteModelCost,
  renameProviderEntry,
  savedModelIds,
  serializeHeaderRows,
  setCompatBool,
  trackAddedModels,
  updateHeaderRow,
} = await jiti.import("./models-config-helpers.ts");

const source = await readFile(new URL("./ModelsConfig.tsx", import.meta.url), "utf8");
const cssSource = await readFile(new URL("../app/settings.css", import.meta.url), "utf8");

test("uses shared sidebar sizing for providers and matching indented model rows", () => {
  const sidebar = source.slice(source.indexOf("<ConfigSidebar>"), source.indexOf("</ConfigSidebar>"));

  assert.match(sidebar, /<ConfigSidebarItem[\s\S]*?active=\{isSelected\}/);
  assert.match(sidebar, /<ConfigSidebarItem[\s\S]*?active=\{isProviderSelected\}/);
  assert.match(sidebar, /className="models-sidebar-indented-item"/);
  assert.match(sidebar, /className="models-sidebar-indented-item models-sidebar-add-item"/);
  assert.match(cssSource, /\.models-sidebar-indented-item \{[\s\S]*?padding-left: 26px/);
});

test("ignores malformed auth provider responses", () => {
  assert.match(
    source,
    /if \(Array\.isArray\(d\.oauthProviders\)\) setOauthProviders\(d\.oauthProviders\)/,
  );
  assert.match(
    source,
    /if \(Array\.isArray\(d\.apiKeyProviders\)\) setApiKeyProviders\(d\.apiKeyProviders\)/,
  );
});

test("custom model config exposes provider-level request headers", () => {
  const providerDetail = source.slice(
    source.indexOf("function ProviderDetail"),
    source.indexOf("// ── ThinkingLevelMap editor"),
  );
  assert.match(providerDetail, /<HeaderListEditor/);
  assert.match(providerDetail, /headers=\{provider\.headers\}/);
  assert.match(providerDetail, /set\("headers", headers\)/);
});

test("custom model config exposes model headers and supportsDeveloperRole compat flag", () => {
  // Model-level headers editor, wired to the model entry.
  assert.match(source, /headers=\{model\.headers\}/);
  assert.match(source, /set\("headers", headers\)/);

  // Model-level compat toggle reads the effective (provider+model) value so
  // hand-edited models.json settings are reflected, while writes stay on the
  // model entry as an explicit per-model override.
  assert.match(source, /effectiveCompat\(provider, model\)\["supportsDeveloperRole"\] !== false/);
  assert.match(source, /setCompatBool\(model, "supportsDeveloperRole", v\)/);
});

test("disabling the developer role writes an explicit false override", () => {
  assert.deepEqual(
    setCompatBool({ compat: { supportsStore: true } }, "supportsDeveloperRole", false),
    { compat: { supportsStore: true, supportsDeveloperRole: false } },
  );
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

test("manual price editing commits completed costs and removes only an all-blank group", () => {
  const modelDetail = source.slice(
    source.indexOf("function ModelDetail"),
    source.indexOf("// ── OAuth detail"),
  );

  assert.match(modelDetail, /const completeCost = parseCompleteModelCost\(nextDraft\)/);
  assert.match(modelDetail, /if \(completeCost\)/);
  assert.match(modelDetail, /delete nextModel\.cost/);
  assert.match(modelDetail, /const nextDraft = \{ \.\.\.costDraftRef\.current, \[key\]: value \}/);
  assert.match(modelDetail, /costDraftRef\.current = nextDraft/);
  assert.match(modelDetail, /costTemplateRef\.current/);
  assert.match(modelDetail, /value=\{costDraft\[key\]\}/);
});

test("model specs keep catalog-filled prices visible outside advanced settings", () => {
  const modelDetail = source.slice(
    source.indexOf("function ModelDetail"),
    source.indexOf("// ── OAuth detail"),
  );
  const specsIndex = modelDetail.indexOf('t("models.modelSpecs")');
  const costIndex = modelDetail.indexOf('t("models.costPerMillion")');
  const advancedIndex = modelDetail.indexOf('t("models.advancedSettings")');

  assert.ok(specsIndex >= 0);
  assert.ok(costIndex > specsIndex);
  assert.ok(advancedIndex > costIndex);
  assert.match(modelDetail, /setCostEditing\(false\)/);
  assert.match(modelDetail, /formatCost\(key\)/);
});

test("per-model settings use one primary divider before advanced settings", () => {
  const modelDetail = source.slice(
    source.indexOf("function ModelDetail"),
    source.indexOf("// ── OAuth detail"),
  );

  assert.equal(
    (modelDetail.match(/borderTop: "1px solid var\(--border\)"/g) ?? []).length,
    1,
  );
  assert.doesNotMatch(modelDetail, /borderBottom: "1px solid var\(--border\)"/);
});

test("thinking level overrides keep explicit default, disabled, and custom controls", () => {
  const editor = source.slice(
    source.indexOf("function ThinkingLevelMapEditor"),
    source.indexOf("// ── Model detail"),
  );

  assert.match(editor, /THINKING_LEVELS\.map/);
  assert.match(editor, />\s*Default\s*</);
  assert.match(editor, />\s*Disabled\s*</);
  assert.match(editor, />\s*Custom\s*</);
  assert.match(editor, /state === "omit"/);
  assert.match(editor, /state === "null"/);
  assert.match(editor, /state === "string"/);
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

test("Save applies a provider name typed without pressing Rename", () => {
  const providerDetail = source.slice(
    source.indexOf("function ProviderDetail"),
    source.indexOf("// ── ThinkingLevelMap editor"),
  );
  // The field edits the panel's draft, not state the Save button cannot see.
  assert.doesNotMatch(providerDetail, /useState\(name\)/);
  assert.match(providerDetail, /onChange=\{onEditingNameChange\}/);

  const save = source.slice(
    source.indexOf("const handleSave = useCallback"),
    source.indexOf("const providers = Object.entries(config.providers"),
  );
  assert.match(save, /applyProviderRename\(config, providerNameDraft\.provider, pendingName\)/);
  assert.match(save, /body: JSON\.stringify\(draft\)/);
  assert.match(save, /collectModelRenames\(draft,/);
});
