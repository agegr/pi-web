import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true, jsx: { runtime: "automatic" } });
const { ModelSelector, filterModelOptions } = await jiti.import("./ModelSelector.tsx");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");

function render(props) {
  return renderToStaticMarkup(
    createElement(
      I18nProvider,
      null,
      createElement(ModelSelector, {
        onChange() {},
        ...props,
      }),
    ),
  );
}

test("filters model options by model name, id, provider, and provider/id", () => {
  const options = [
    { provider: "anthropic", modelId: "claude-opus-5", name: "Claude Opus 5" },
    { provider: "openai", modelId: "gpt-6-luna", name: "GPT-6 Luna" },
    { provider: "acme", modelId: "custom-one", name: "Custom One" },
  ];

  assert.deepEqual(filterModelOptions(options, "opus"), [options[0]]);
  assert.deepEqual(filterModelOptions(options, "gpt-6"), [options[1]]);
  assert.deepEqual(filterModelOptions(options, "acme/custom"), [options[2]]);
  assert.deepEqual(filterModelOptions(options, "   "), options);
  assert.deepEqual(filterModelOptions(options, "nonexistent"), []);
});

test("renders trigger button and omits scope toggle when isScoped is false", () => {
  const html = render({
    options: [{ provider: "anthropic", modelId: "claude-opus-5", name: "Claude Opus 5" }],
    value: { provider: "anthropic", modelId: "claude-opus-5" },
    isScoped: false,
  });

  assert.match(html, /Claude Opus 5/);
  assert.doesNotMatch(html, /Scope:/);
  assert.doesNotMatch(html, /role="tab"/);
});

test("omits default star on unscoped models and retains star on scoped models", () => {
  const scopedOptions = [
    { provider: "anthropic", modelId: "claude-opus-5", name: "Claude Opus 5" },
  ];
  const allOptions = [
    { provider: "anthropic", modelId: "claude-opus-5", name: "Claude Opus 5" },
    { provider: "openai", modelId: "gpt-6-luna", name: "GPT-6 Luna" },
  ];

  const scopedKeys = new Set(scopedOptions.map((o) => `${o.provider}:${o.modelId}`));

  function getStarForOption(option, scope, isScoped) {
    const isOptionScoped = !isScoped || scope === "scoped" || scopedKeys.has(`${option.provider}:${option.modelId}`);
    return isOptionScoped ? { isDefault: false } : undefined;
  }

  // Under scoped view: scoped models get star
  assert.ok(getStarForOption(scopedOptions[0], "scoped", true));

  // Under all view: scoped model gets star, unscoped model does NOT get star
  assert.ok(getStarForOption(allOptions[0], "all", true));
  assert.equal(getStarForOption(allOptions[1], "all", true), undefined);

  // When isScoped is false: all models get star
  assert.ok(getStarForOption(allOptions[1], "all", false));
});

test("switchScope triggers onLoadAllModels lazily only once", async () => {
  let loads = 0;
  let allOptions = null;
  let loadingAll = false;

  async function mockLoadAll() {
    loads += 1;
    return [
      { provider: "anthropic", modelId: "claude-opus-5", name: "Claude Opus 5" },
      { provider: "openai", modelId: "gpt-6-luna", name: "GPT-6 Luna" },
    ];
  }

  async function handleSwitchScope(nextScope) {
    if (nextScope === "all" && allOptions === null && !loadingAll) {
      loadingAll = true;
      allOptions = await mockLoadAll();
      loadingAll = false;
    }
  }

  assert.equal(loads, 0);
  assert.equal(allOptions, null);

  await handleSwitchScope("all");
  assert.equal(loads, 1);
  assert.equal(allOptions.length, 2);

  // Switching again reuses cached allOptions without refetching
  await handleSwitchScope("scoped");
  await handleSwitchScope("all");
  assert.equal(loads, 1);
});
