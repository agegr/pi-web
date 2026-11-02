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

test("names a current model outside the scope from the loaded full list", () => {
  const html = render({
    options: [{ provider: "anthropic", modelId: "claude-opus-5", name: "Claude Opus 5" }],
    allOptions: [{ provider: "openai", modelId: "gpt-6-luna", name: "GPT-6 Luna" }],
    value: { provider: "openai", modelId: "gpt-6-luna" },
    onShowAll() {},
  });

  assert.match(html, /GPT-6 Luna/);
});
