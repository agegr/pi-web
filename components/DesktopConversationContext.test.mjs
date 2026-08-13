import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { DesktopConversationContext } = await jiti.import("./DesktopConversationContext.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");

const model = {
  percent: 2.9,
  usedTokens: 31000,
  contextWindow: 1_000_000,
  availableTokens: 969000,
  inputTokens: 6400,
  outputTokens: 22000,
  cacheRead: 339000,
  cacheWrite: 0,
  cacheRate: 98.1,
  totalTokens: 367400,
  modelLabel: "deepseek-v4-flash",
  cost: 0.008,
};

test("renders the DSCode-style context metrics", () => {
  const html = renderToStaticMarkup(React.createElement(I18nProvider, null,
    React.createElement(DesktopConversationContext, { model, onOpenDetails() {} }),
  ));
  assert.match(html, /Conversation context/);
  assert.match(html, /2\.9%/);
  assert.match(html, /31k/);
  assert.match(html, /367k/);
  assert.match(html, /6\.4k/);
  assert.match(html, /22k/);
  assert.match(html, /98\.1%/);
  assert.match(html, /deepseek-v4-flash/);
  assert.match(html, /\$0\.0080/);
});
