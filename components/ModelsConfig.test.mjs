import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  applyContextWindowPreset,
  collectModelRenames,
  CONTEXT_WINDOW_PRESETS,
  fillEmptyModelFields,
  formatSpecValue,
  hasModelCostDraftValue,
  matchesContextWindowPreset,
  modelCostToDraft,
  parseCompleteModelCost,
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

test("context window presets fill both fields in a single assignment", () => {
  for (const preset of CONTEXT_WINDOW_PRESETS) {
    const model = { id: "some-model" };
    const next = applyContextWindowPreset(model, preset);

    // Regression: two sequential field updates each spread the same stale `model`, so the
    // second call used to drop the first field and only max output tokens got written.
    assert.equal(next.contextWindow, preset.contextWindow, `${preset.labelKey} context window`);
    assert.equal(next.maxTokens, preset.maxTokens, `${preset.labelKey} max output tokens`);
    assert.equal(next.id, "some-model", "unrelated fields survive");
  }
});

test("context window presets keep existing fields they do not own", () => {
  const preset = CONTEXT_WINDOW_PRESETS[1];
  const next = applyContextWindowPreset({ id: "m", name: "Model", cost: { input: 1 } }, preset);

  assert.deepEqual(next, {
    id: "m",
    name: "Model",
    cost: { input: 1 },
    contextWindow: preset.contextWindow,
    maxTokens: preset.maxTokens,
  });
});

test("a preset reports active only when both fields match it", () => {
  const preset = CONTEXT_WINDOW_PRESETS[0];

  assert.equal(matchesContextWindowPreset({ contextWindow: preset.contextWindow, maxTokens: preset.maxTokens }, preset), true);
  // A partially matching entry is not "this preset" — it was edited afterwards.
  assert.equal(matchesContextWindowPreset({ contextWindow: preset.contextWindow, maxTokens: 999 }, preset), false);
  assert.equal(matchesContextWindowPreset({ contextWindow: 999, maxTokens: preset.maxTokens }, preset), false);
  assert.equal(matchesContextWindowPreset({}, preset), false);
});

test("formats spec values with the unit the button label uses", () => {
  assert.equal(formatSpecValue(2_000_000), "2M");
  assert.equal(formatSpecValue(1_000_000), "1M");
  assert.equal(formatSpecValue(256_000), "256K");
  assert.equal(formatSpecValue(64_000), "64K");
  assert.equal(formatSpecValue(8_192), "8,192");
  assert.equal(formatSpecValue(8_000), "8,000");
  assert.equal(formatSpecValue(1_500_000), "1.5M");
  assert.equal(formatSpecValue(262_144), "262.1K");
});

test("every preset label key is translated in all three locales", async () => {
  const en = await readFile(new URL("../lib/i18n/messages/en.ts", import.meta.url), "utf8");
  const zhCN = await readFile(new URL("../lib/i18n/messages/zh-CN.ts", import.meta.url), "utf8");
  const zhTW = await readFile(new URL("../lib/i18n/messages/zh-TW.ts", import.meta.url), "utf8");

  for (const preset of CONTEXT_WINDOW_PRESETS) {
    for (const [name, source] of [["en", en], ["zh-CN", zhCN], ["zh-TW", zhTW]]) {
      assert.ok(source.includes(`"${preset.labelKey}"`), `${name} is missing ${preset.labelKey}`);
    }
  }
});

test("upstream limits beat the models.dev preset when both are available", () => {
  const preset = { name: "Preset Name", contextWindow: 128_000, maxTokens: 16_384 };

  // The provider's own /models response describes the endpoint being configured, so it wins.
  const fromUpstream = fillEmptyModelFields(
    { id: "m" },
    preset,
    { contextWindow: 1_000_000, maxTokens: 128_000 },
  );
  assert.equal(fromUpstream.model.contextWindow, 1_000_000);
  assert.equal(fromUpstream.model.maxTokens, 128_000);
  assert.equal(fromUpstream.model.name, "Preset Name", "other preset fields still apply");
  assert.equal(fromUpstream.appliedCount, 3);
});

test("models.dev preset fills the limits when the provider reports none", () => {
  const filled = fillEmptyModelFields(
    { id: "m" },
    { contextWindow: 128_000, maxTokens: 16_384 },
    { contextWindow: undefined, maxTokens: undefined },
  );
  assert.equal(filled.model.contextWindow, 128_000);
  assert.equal(filled.model.maxTokens, 16_384);
  assert.equal(filled.appliedCount, 2);
});

test("upstream limits cover only the fields the preset is missing", () => {
  const filled = fillEmptyModelFields(
    { id: "m", maxTokens: 8_192 },
    { contextWindow: 128_000, maxTokens: 16_384 },
    { contextWindow: 256_000 },
  );
  // maxTokens was already set, so neither source may touch it.
  assert.equal(filled.model.contextWindow, 256_000, "upstream value used");
  assert.equal(filled.model.maxTokens, 8_192, "existing value kept");
  assert.equal(filled.appliedCount, 1);
});

test("nothing is written when every field already has a value", () => {
  const model = {
    id: "m",
    name: "Existing",
    reasoning: true,
    input: ["text"],
    contextWindow: 200_000,
    maxTokens: 8_192,
  };
  const filled = fillEmptyModelFields(model, {
    name: "Preset Name",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 128_000,
    maxTokens: 16_384,
  }, { contextWindow: 1_000_000, maxTokens: 128_000 });

  assert.deepEqual(filled.model, model, "entry is untouched");
  assert.equal(filled.appliedCount, 0);
});
