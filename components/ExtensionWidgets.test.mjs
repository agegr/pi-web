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
  ExtensionWidgets,
  MAX_EXTENSION_WIDGET_LINES,
} = await jiti.import("./ExtensionWidgets.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");

function renderWidgets(props) {
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ExtensionWidgets, props),
    ),
  );
}

test("renders short extension widgets without a truncation marker", () => {
  const html = renderWidgets({
    widgets: [{ key: "short", lines: ["first", "second"] }],
  });

  assert.match(html, /first\nsecond/);
  assert.doesNotMatch(html, /widget truncated/);
});

test("matches the Pi TUI extension widget line limit", () => {
  const lines = Array.from(
    { length: MAX_EXTENSION_WIDGET_LINES + 2 },
    (_, index) => `line-${index + 1}`,
  );
  const html = renderWidgets({ widgets: [{ key: "long", lines }] });

  assert.match(html, new RegExp(`line-${MAX_EXTENSION_WIDGET_LINES}`));
  assert.doesNotMatch(html, new RegExp(`line-${MAX_EXTENSION_WIDGET_LINES + 1}`));
  assert.match(html, /\.\.\. \(widget truncated\)/);
});
