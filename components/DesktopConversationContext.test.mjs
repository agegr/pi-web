import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { DesktopConversationContext } = await jiti.import("./DesktopConversationContext.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

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

test("centers the full-capacity label inside the ring", () => {
  const html = renderToStaticMarkup(React.createElement(I18nProvider, null,
    React.createElement(DesktopConversationContext, {
      model: { ...model, percent: 100 },
      onOpenDetails() {},
    }),
  ));

  assert.match(html, /desktop-context-ring-label[^>]*><strong>100\.0%<\/strong>/);
  assert.match(css, /\.desktop-context-ring-label\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*6px;[^}]*place-content:\s*center;/s);
  assert.match(css, /\.desktop-context-ring strong\s*\{[^}]*font-size:\s*12px;[^}]*white-space:\s*nowrap;/s);
});

test("pulls the context card toward the transcript only on roomy desktops", () => {
  assert.match(css, /@container chat-center \(min-width:\s*1121px\)[\s\S]*?\.desktop-workspace-context\s*\{\s*transform:\s*translateX\(-42px\);\s*\}/);
});
