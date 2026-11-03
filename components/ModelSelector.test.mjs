import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true, jsx: { runtime: "automatic" } });
const { ModelSelector, filterModelOptions, groupModelOptions } = await jiti.import("./ModelSelector.tsx");
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
    { provider: "anthropic", providerName: "Anthropic", modelId: "claude-opus-5", name: "Claude Opus 5" },
    { provider: "openai", providerName: "OpenAI", modelId: "gpt-6-luna", name: "GPT-6 Luna" },
    { provider: "acme", providerName: "Acme Gateway", modelId: "custom-one", name: "Custom One" },
  ];

  assert.deepEqual(filterModelOptions(options, "opus"), [options[0]]);
  assert.deepEqual(filterModelOptions(options, "gpt-6"), [options[1]]);
  assert.deepEqual(filterModelOptions(options, "acme/custom"), [options[2]]);
  assert.deepEqual(filterModelOptions(options, "gateway"), [options[2]]);
  assert.deepEqual(filterModelOptions(options, "   "), options);
  assert.deepEqual(filterModelOptions(options, "nonexistent"), []);
});

test("groups models by provider and labels each group with the provider's display name", () => {
  const options = [
    { provider: "aiflashapi", providerName: "AI Flash API", modelId: "one", name: "One" },
    { provider: "aiflashapi", modelId: "two", name: "Two" },
    { provider: "commandcode", modelId: "three", name: "Three" },
  ];

  const groups = groupModelOptions(options);
  assert.deepEqual(groups.map((group) => group.provider), ["aiflashapi", "commandcode"]);
  assert.deepEqual(groups.map((group) => group.providerName), ["AI Flash API", "commandcode"]);
  assert.deepEqual(groups[0].options.map((option) => option.modelId), ["one", "two"]);
});

test("names a current model outside the scope from the loaded full list", () => {
  const html = render({
    options: [{ provider: "anthropic", modelId: "claude-opus-5", name: "Claude Opus 5" }],
    allOptions: [{ provider: "openai", modelId: "gpt-6-luna", name: "GPT-6 Luna" }],
    value: { provider: "openai", modelId: "gpt-6-luna" },
    onShowAll() {},
  });

  assert.match(html, /GPT-6 Luna/);
});
