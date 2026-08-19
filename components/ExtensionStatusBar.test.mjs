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
  formatExtensionStatusLine,
  sanitizeExtensionStatusText,
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

test("sorts status text by hidden key like the Pi CLI footer", () => {
  const statuses = [
    { key: "20-memory", text: "memory" },
    { key: "90-notify", text: "notify" },
    { key: "10-permissions", text: "permissions" },
    { key: "05-ponytail", text: "ponytail" },
  ];

  assert.equal(
    formatExtensionStatusLine(statuses),
    "ponytail permissions memory notify",
  );
});

test("sanitizes status text for a single-line display", () => {
  assert.equal(
    sanitizeExtensionStatusText("  first\tsecond \r\n third  "),
    "first second third",
  );
});

test("does not render a permanent status line (partial footer removed)", () => {
  // The user requires NO condensed/partial footer perman_emnently visible at
  // the bottom-right. Statuses feed the footer panel via ChatWindow, but the
  // shelf must not render a standalone status line.
  const html = renderStatusBar({
    statuses: [
      { key: "20-memory", text: "\x1b[32mmemory\x1b[0m" },
      { key: "05-ponytail", text: "ponytail" },
    ],
  });

  // No widgets and no footer -> nothing renders at all (no partial footer).
  assert.equal(html.replace(/<[^>]+>/g, "").trim(), "");
  assert.doesNotMatch(html, /extension-status-line/);
  assert.doesNotMatch(html, /extension-status-text/);
  assert.doesNotMatch(html, />ponytail/);
  assert.doesNotMatch(html, />memory/);
});

test("renders widgets and the footer panel, with no permanent status line", () => {
  const html = renderStatusBar({
    statuses: [{ key: "status", text: "connected" }],
    widgets: [{
      key: "usage",
      lines: ["42%"],
      placement: "aboveEditor",
    }],
  });

  assert.match(html, /extension-widget-triggers/);
  assert.match(html, /usage/);
  // No condensed status line is rendered permanently.
  assert.doesNotMatch(html, /extension-status-line/);
  assert.doesNotMatch(html, />connected/);
});
