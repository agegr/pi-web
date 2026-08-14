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
  userMessages: 1,
  toolCalls: 2,
  cacheHitRate: 98.1,
};

test("renders a compact session summary instead of cumulative token metrics", () => {
  const html = renderToStaticMarkup(React.createElement(I18nProvider, null,
    React.createElement(DesktopConversationContext, { model, onOpenDetails() {} }),
  ));
  assert.match(html, /Conversation context/);
  assert.match(html, /2\.9%/);
  assert.match(html, /31k/);
  assert.match(html, /969k available/);
  assert.doesNotMatch(html, /deepseek-v4-flash/);
  assert.doesNotMatch(html, /\$0\.0080/);
  assert.match(html, /1 turn/);
  assert.match(html, /2 tool calls/);
  assert.match(html, /Cache hit rate/);
  assert.match(html, /desktop-context-cache-rate/);
  assert.match(html, /98\.1%/);
  assert.doesNotMatch(html, /Total tokens/);
  assert.doesNotMatch(html, /Cache Read/);
  assert.doesNotMatch(html, /Model/);
  assert.doesNotMatch(html, /Cost/);
});

test("uses a horizontal context bar with capacity-aware tones", () => {
  const html = renderToStaticMarkup(React.createElement(I18nProvider, null,
    React.createElement(DesktopConversationContext, { model, onOpenDetails() {} }),
  ));
  assert.match(html, /desktop-context-progress/);
  assert.match(html, /--context-percent:2\.9%/);
  assert.match(html, /--context-tone:var\(--accent\)/);
  assert.match(css, /\.desktop-context-progress\s*\{[^}]*height:\s*6px;[^}]*border-radius:\s*999px;/s);
});

test("uses an alert tone near the context limit", () => {
  const html = renderToStaticMarkup(React.createElement(I18nProvider, null,
    React.createElement(DesktopConversationContext, {
      model: { ...model, percent: 96 },
      onOpenDetails() {},
    }),
  ));
  assert.match(html, /--context-tone:#dc2626/);
});

test("pulls the context card toward the transcript only on roomy desktops", () => {
  assert.match(css, /@container chat-center \(min-width:\s*1121px\)[\s\S]*?\.desktop-workspace-context\s*\{\s*transform:\s*translateX\(-42px\);\s*\}/);
});
