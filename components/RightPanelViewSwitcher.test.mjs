import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { RightPanelViewSwitcher } = await jiti.import("./RightPanelViewSwitcher.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");

function renderSwitcher(props) {
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(RightPanelViewSwitcher, props),
    ),
  );
}

test("renders both icon buttons when preview is available", () => {
  const html = renderSwitcher({ view: "files", onViewChange: () => {}, previewAvailable: true });

  assert.match(html, /aria-label="Files"/);
  assert.match(html, /aria-label="HTML preview"/);
  // SVG line icons present (folder + eye)
  assert.match(html, /<svg/);
  assert.match(html, /M3 7a2 2 0 0 1 2-2h4l2 2h8/); // folder
  assert.match(html, /M1 12s4-8 11-8/); // eye
});

test("marks the active view as is-active", () => {
  const filesActive = renderSwitcher({ view: "files", onViewChange: () => {}, previewAvailable: true });
  const previewActive = renderSwitcher({ view: "preview", onViewChange: () => {}, previewAvailable: true });

  assert.match(filesActive, /aria-pressed="true"/);
  assert.match(previewActive, /aria-pressed="true"/);
});

test("hides the preview button until preview is available", () => {
  const html = renderSwitcher({ view: "files", onViewChange: () => {}, previewAvailable: false });

  assert.match(html, /aria-label="Files"/);
  assert.doesNotMatch(html, /aria-label="HTML preview"/);
});
