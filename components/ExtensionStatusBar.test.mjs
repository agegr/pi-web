import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const {
  ExtensionStatusBar,
} = await jiti.import("./ExtensionStatusBar.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");

function renderStatusBar(props) {
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ExtensionStatusBar, props),
    ),
  );
}

test("hides passive extension statuses when there are no widgets", () => {
  const html = renderStatusBar({
    statuses: [
      { key: "20-memory", text: "memory" },
      { key: "05-ponytail", text: "ponytail: FULL" },
    ],
  });

  assert.equal(html, "");
});

test("keeps widgets without rendering the passive status line", () => {
  const html = renderStatusBar({
    statuses: [{ key: "status", text: "connected" }],
    widgets: [{
      key: "usage",
      lines: ["42%"],
      placement: "aboveEditor",
    }],
  });

  assert.match(html, /extension-status-shelf has-widgets/);
  assert.match(html, /extension-widget-triggers/);
  assert.match(html, /usage/);
  assert.doesNotMatch(html, /extension-status-line|connected/);
});
