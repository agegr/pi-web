import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

registerHooks({
  load(url, context, nextLoad) {
    if (!url.endsWith(".module.css")) return nextLoad(url, context);
    return {
      format: "module",
      shortCircuit: true,
      source: "export default new Proxy({}, { get: (_, key) => String(key) });",
    };
  },
});

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { AssistantOutline } = await jiti.import("./ChatMinimap.tsx");
const source = await readFile(new URL("./ChatMinimap.tsx", import.meta.url), "utf8");

test("renders math in headings without disabling heading navigation", () => {
  const html = renderToStaticMarkup(
    React.createElement(AssistantOutline, {
      markdown: String.raw`# Inline $f_{k,t+1}$

## Parentheses \(x^2 + y^2\)`,
      onHeadingClick() {},
    }),
  );

  assert.match(html, /class="katex"/);
  assert.match(html, /data-preview-heading-index="0"/);
  assert.match(html, /data-preview-heading-index="1"/);
  assert.doesNotMatch(html, /disabled=""/);
});

test("renders the load-earlier row before the loaded turns", () => {
  assert.match(source, /hasEarlierMessages: boolean/);
  assert.match(source, /loadingEarlier: boolean/);
  assert.match(source, /onLoadEarlier: \(\) => void \| Promise<void>/);

  // The preview panel must render the row even when no turn is loaded yet,
  // otherwise a page that ends inside one huge turn has no affordance at all.
  assert.match(source, /minimapHovered && \(allNodes\.length > 0 \|\| hasEarlierMessages\)/);

  const previewBox = source.slice(
    source.indexOf("data-minimap-preview-box"),
    source.indexOf("{allNodes.map((node) =>"),
  );
  assert.match(previewBox, /hasEarlierMessages && \(/);
  assert.match(previewBox, /data-minimap-load-earlier/);
  assert.match(previewBox, /disabled=\{loadingEarlier\}/);
  assert.match(previewBox, /void onLoadEarlier\(\)/);
});

test("labels the load-earlier row from i18n and shows progress while it loads", () => {
  assert.match(source, /t\("chatMinimap\.loadEarlier"\)/);
  assert.match(source, /loadingEarlier \? t\("i18n\.loading"\) : t\("chatMinimap\.loadEarlier"\)/);
});
