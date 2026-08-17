import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  hasModelCostDraftValue,
  modelCostToDraft,
  parseCompleteModelCost,
  serializeHeaderRows,
  setCompatBool,
  updateHeaderRow,
} = await jiti.import("./models-config-helpers.ts");

const source = await readFile(new URL("./ModelsConfig.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

test("ignores malformed auth provider responses", () => {
  assert.match(
    source,
    /if \(Array\.isArray\(d\.providers\)\) setOauthProviders\(d\.providers\)/,
  );
  assert.match(
    source,
    /if \(Array\.isArray\(d\.providers\)\) setApiKeyProviders\(d\.providers\)/,
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

test("named headers preserve blank values as explicit parent overrides", () => {
  assert.deepEqual(
    serializeHeaderRows([
      { id: 1, name: "X-Blank", value: "" },
      { id: 2, name: "X-Spaces", value: "   " },
    ]),
    { "X-Blank": "", "X-Spaces": "   " },
  );
});

test("request header editor localizes copy and documents blank override semantics", () => {
  assert.match(source, /t\("models\.providerHeadersHelp"\)/);
  assert.match(source, /t\("models\.headerNamePlaceholder"\)/);
  assert.match(source, /t\("models\.headerValuePlaceholder"\)/);
  assert.match(source, /t\("models\.addHeader"\)/);
  assert.match(source, /t\("models\.headersHelp"\)/);
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

test("ModelsConfig is a Settings-only master-detail surface", () => {
  assert.match(source, /export function ModelsConfig\(\{ onControllerChange \}: ModelsConfigProps\)/);
  assert.doesNotMatch(source, /embedded = false/);
  assert.doesNotMatch(source, /\{ onClose \}/);
  assert.match(source, /<ModelsConfigNavigator/);
  assert.match(source, /models-settings-layout/);
  assert.match(source, /models-settings-detail/);
  // Old stacked mobile tree is gone.
  assert.doesNotMatch(source, /maxHeight: isMobile \? "40vh"/);
  assert.doesNotMatch(source, /flexDirection: isMobile \? "column" : "row"/);
});

test("initial load stores both baseline and draft, and Save reloads the normalized document", () => {
  assert.match(source, /setBaselineConfig\(normalized\);/);
  assert.match(source, /setConfig\(normalized\);/);
  assert.match(source, /const dirty = isModelsConfigDirty\(baselineConfig, config\);/);
  assert.match(source, /\/\/ The server normalizes the document/);
  assert.match(source, /applySavedModelsConfig\(config, configRef\.current, normalized\)/);
  assert.match(source, /disabled=\{!dirty \|\| saving \|\| savedOk\}/);
  assert.match(source, /setSelection\(\(current\) => resolveModelsSelection\(current, next, oauthProviders, apiKeyProviders\)\);/);
});

test("save errors keep the draft dirty", () => {
  assert.match(source, /if \(!res\.ok \|\| d\.error\) \{\n\s*setSaveError\(d\.error \?\? `HTTP \$\{res\.status\}`\);/);
  assert.match(source, /setSaveError\(e instanceof Error \? e\.message : String\(e\)\);/);
});

test("mobile list/detail never render together and back preserves state", () => {
  assert.match(source, /useState<"list" \| "detail">\("list"\)/);
  assert.match(source, /data-mobile-view=\{isMobile \? mobileView : undefined\}/);
  assert.match(source, /if \(isMobile\) setMobileView\("detail"\);/);
  assert.match(source, /models-settings-back/);
  assert.match(source, /onClick=\{\(\) => setMobileView\("list"\)\}/);
});

test("Models publishes a draft controller with nested back priority", () => {
  assert.match(source, /useMemo<ModelsDraftController>\(\(\) => \(\{/);
  assert.match(source, /if \(pickerOpen\) \{ setPickerOpen\(false\); return true; \}/);
  assert.match(source, /if \(pendingDelete\) \{ setPendingDelete\(null\); return true; \}/);
  assert.match(source, /if \(isMobile && mobileView === "detail"\) \{ setMobileView\("list"\); return true; \}/);
  assert.match(source, /mobileDetailOpen: isMobile && mobileView === "detail",/);
  assert.match(source, /onControllerChange\(controller\);/);
});

test("dirty drafts register beforeunload only while unsaved", () => {
  assert.match(source, /addEventListener\("beforeunload", onBeforeUnload\)/);
  assert.match(source, /if \(!dirty\) return;/);
});

test("provider and model deletion is confirmed and stays a draft until Save", () => {
  assert.match(source, /requestDelete\(\{ type: "provider", name: selection\.name \}\)/);
  assert.match(source, /requestDelete\(\{ type: "model", providerName: selection\.providerName, index: selection\.index \}\)/);
  assert.match(source, /const confirmDelete = useCallback\(\(\) => \{/);
  assert.match(source, /deleteProvider\(pendingDelete\.name\)/);
  assert.match(source, /removeModel\(pendingDelete\.providerName, pendingDelete\.index\)/);
  assert.match(source, /t\("models\.deleteDraftNote"\)/);
  assert.match(source, /<DialogShell[\s\S]*?size="confirm"/);
  assert.match(source, /data-variant="danger"[\s\S]*?confirmDelete/);
  assert.match(styles, /\.codex-dialog\[data-size="confirm"\][\s\S]*?margin: auto;/);
});

test("provider detail keeps import/discovery common and headers advanced", () => {
  const providerDetail = source.slice(
    source.indexOf("function ProviderDetail"),
    source.indexOf("// ── ThinkingLevelMap editor"),
  );
  assert.match(providerDetail, /aria-controls="provider-advanced-settings"/);
  assert.match(providerDetail, /models\.advancedSettings/);
  assert.match(providerDetail, /models-settings-danger-zone/);
  assert.match(providerDetail, /t\("models\.deleteProvider"\)/);
  assert.match(providerDetail, /models\.modelCount/);
});

test("discard repairs selection and returns to the list when nothing remains", () => {
  assert.match(source, /resolveModelsSelection\(current, baselineConfig, oauthProviders, apiKeyProviders\)/);
  assert.match(source, /if \(!next\) setMobileView\("list"\)/);
});

test("auth list refresh repairs a disconnected account selection", () => {
  assert.match(source, /resolveModelsSelection\(current, configRef\.current, oauthProviders, apiKeyProviders\)/);
  assert.match(
    source,
    /configRef\.current, oauthProviders, apiKeyProviders\);\s*if \(!next\) setMobileView\("list"\)/,
  );
  assert.match(source, /\}, \[oauthProviders, apiKeyProviders\]\);/);
});

test("oauth and API-key loaders keep independent error state", () => {
  assert.match(source, /setOauthError\(null\)/);
  assert.match(source, /setApiKeyError\(null\)/);
  assert.match(source, /setOauthError\(t\("models\.accountsLoadFailed"\)\)/);
  assert.match(source, /setApiKeyError\(t\("models\.accountsLoadFailed"\)\)/);
  assert.doesNotMatch(source, /setAccountsError/);
});

test("accounts retry does not reload custom config, and config retry skips dirty drafts", () => {
  assert.match(source, /onRetryAccounts=\{refreshAuthProviders\}/);
  assert.match(source, /onRetryConfig=\{\(\) => \{ if \(!dirty\) void loadConfig\(\); \}\}/);
});

test("add-provider picker is a modal dialog that restores focus", () => {
  const picker = source.slice(
    source.indexOf("function AddProviderPicker"),
    source.indexOf("// ── Main component"),
  );
  assert.match(picker, /<dialog/);
  assert.match(picker, /dialog\.showModal\(\)/);
  assert.match(picker, /previousFocusRef\.current\?\.focus\(\)/);
  assert.match(picker, /aria-label=\{t\("i18n\.addProvider"\)\}/);
});

test("model detail moves deletion to a labelled danger section", () => {
  const modelDetail = source.slice(
    source.indexOf("function ModelDetail"),
    source.indexOf("// ── OAuth detail"),
  );
  assert.match(modelDetail, /models-settings-danger-zone/);
  assert.match(modelDetail, /t\("models\.deleteModel"\)/);
  assert.doesNotMatch(modelDetail, /t\("i18n\.remove"\)/);
  assert.match(modelDetail, /aria-controls="model-advanced-settings"/);
});
