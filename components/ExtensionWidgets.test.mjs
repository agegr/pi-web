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
  DEFAULT_EXPANDED_WIDGET_LINES,
  ExtensionWidgets,
  formatExtensionWidgetContent,
  getNextExpandedWidgetKey,
  getUpdatedExtensionWidgetKeys,
  snapshotExtensionWidgetContents,
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
    widgets: [{ key: "short", lines: ["first", "second"], placement: "aboveEditor" }],
  });

  assert.match(html, /first\nsecond/);
  assert.doesNotMatch(html, /widget truncated/);
  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /data-direction="up"/);
  assert.doesNotMatch(html, /[\u2191\u2193]/);
});

test("collapses long widgets by default", () => {
  const lines = Array.from(
    { length: 12 },
    (_, index) => `line-${index + 1}`,
  );
  const html = renderWidgets({
    widgets: [{ key: "long", lines, placement: "belowEditor" }],
  });

  assert.ok(lines.length > DEFAULT_EXPANDED_WIDGET_LINES);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /data-direction="down"/);
  assert.doesNotMatch(html, /<pre/);
  assert.doesNotMatch(html, /line-1/);
  assert.doesNotMatch(html, /line-10/);
  assert.doesNotMatch(html, /line-12/);
});

test("keeps all widget lines available for the scrollable expanded panel", () => {
  const lines = Array.from(
    { length: 12 },
    (_, index) => `line-${index + 1}`,
  );
  const content = formatExtensionWidgetContent(lines);

  assert.match(content, /line-10/);
  assert.match(content, /line-12/);
  assert.doesNotMatch(content, /widget truncated/);
});

test("keeps compact widgets expanded by default", () => {
  const lines = Array.from(
    { length: DEFAULT_EXPANDED_WIDGET_LINES },
    (_, index) => `line-${index + 1}`,
  );
  const html = renderWidgets({
    widgets: [{ key: "compact", lines, placement: "aboveEditor" }],
  });

  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /<pre/);
});

test("expands at most one compact widget", () => {
  const html = renderWidgets({
    widgets: [
      { key: "first", lines: ["one", "two"], placement: "aboveEditor" },
      { key: "second", lines: ["three", "four"], placement: "belowEditor" },
    ],
  });

  assert.equal((html.match(/aria-expanded="true"/g) ?? []).length, 1);
  assert.equal((html.match(/<section/g) ?? []).length, 1);
  assert.match(html, /aria-labelledby="[^"]*trigger-0"/);
  assert.doesNotMatch(html, /aria-labelledby="[^"]*trigger-1"/);
});

test("switching widgets closes the previously expanded widget", () => {
  assert.equal(getNextExpandedWidgetKey(null, "first"), "first");
  assert.equal(getNextExpandedWidgetKey("first", "second"), "second");
  assert.equal(getNextExpandedWidgetKey("second", "second"), null);
});

test("detects only existing widgets whose line content changed", () => {
  const previous = snapshotExtensionWidgetContents([
    { key: "changed", lines: ["one"], placement: "aboveEditor" },
    { key: "same", lines: ["ready"], placement: "belowEditor" },
    { key: "removed", lines: ["gone"], placement: "belowEditor" },
  ]);
  const next = snapshotExtensionWidgetContents([
    { key: "same", lines: ["ready"], placement: "aboveEditor" },
    { key: "changed", lines: ["one", "two"], placement: "belowEditor" },
    { key: "added", lines: ["new"], placement: "aboveEditor" },
  ]);

  assert.deepEqual(getUpdatedExtensionWidgetKeys(previous, next), ["changed"]);
  assert.deepEqual(getUpdatedExtensionWidgetKeys(null, next), []);
});

test("compares widget lines without delimiter collisions", () => {
  const previous = new Map([["status", ["one", "two"]]]);
  const next = new Map([["status", ["one\ntwo"]]]);

  assert.deepEqual(getUpdatedExtensionWidgetKeys(previous, next), ["status"]);
});

test("uses a compact key-only trigger with a placement icon", () => {
  const html = renderWidgets({
    widgets: [{ key: "long-extension-widget-key", lines: ["ready"], placement: "belowEditor" }],
  });

  assert.match(html, /extension-widget-triggers/);
  assert.match(html, /<svg[^>]*extension-widget-placement-icon/);
  assert.match(html, /data-direction="down"/);
  assert.doesNotMatch(html, /[\u2191\u2193]/);
  assert.match(html, /Below editor widget/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /title="long-extension-widget-key - Below editor widget - Expand"/);
  assert.match(html, /extension-widget-key/);
  assert.match(html, /extension-widget-update-pulse/);
  assert.doesNotMatch(html, /extension-widget-preview/);
  assert.doesNotMatch(html, /extension-widget-line-count/);
  assert.doesNotMatch(html, />ready</);
});

test("single-line widget is clickable and can open its panel", () => {
  // Regression: a 1-line widget (e.g. filechanges collapsed summary) must be a
  // real button that opens a panel showing its content, not an inert div.
  const html = renderWidgets({
    widgets: [{ key: "filechanges", lines: ["Δ 6 files changed"], placement: "aboveEditor" }],
  });
  assert.match(html, /<button/);
  assert.match(html, /aria-controls=/);
  assert.match(html, /aria-expanded="false"/);
  // Toggle math: clicking the same key collapses it, never expands twice.
  assert.equal(getNextExpandedWidgetKey(null, "filechanges"), "filechanges");
  assert.equal(getNextExpandedWidgetKey("filechanges", "filechanges"), null);
});

test("footer tab renders when footer data is provided", () => {
  const footer = {
    provider: "opencode-go",
    model: "deepseek-v4-flash",
    thinking: "high",
    activeTool: null,
    totalTokens: 0,
    activityBusy: false,
    context: { percent: 13, contextWindow: 1000000, tokens: 130000 },
    workspace: { cwd: "/Users/x/app", branch: "main", modified: 9, untracked: 7 },
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheHitPercent: null },
    cost: { inputUsd: 0, outputUsd: 0, cacheReadUsd: 0, estimatedTotalUsd: 0 },
  };
  const html = renderWidgets({
    widgets: [],
    footer,
  });

  assert.match(html, /extension-widget-triggers/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /extension-widget-key/);
  assert.doesNotMatch(html, /footer-panel /); // collapsed: panel hidden
});

test("footer panel content is hidden until expanded", () => {
  const footer = {
    provider: "opencode-go",
    model: "deepseek-v4-flash",
    thinking: "high",
    activeTool: null,
    totalTokens: 0,
    activityBusy: false,
    context: { percent: 13, contextWindow: 1000000, tokens: 130000 },
    workspace: { cwd: "/Users/x/app", branch: "main", modified: 9, untracked: 7 },
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheHitPercent: null },
    cost: { inputUsd: 0, outputUsd: 0, cacheReadUsd: 0, estimatedTotalUsd: 0 },
  };
  const html = renderWidgets({ widgets: [], footer });
  // No model/provider string leaks into the collapsed shelf.
  assert.doesNotMatch(html, /deepseek-v4-flash/);
});

test("filechanges widget renders every changed file in the expanded panel", () => {
  // The filechange tab is a generic extension widget: its lines are the
  // published changed-file list. Render with multiple files and confirm the
  // panel (expanded via default for 2-3 line widgets) shows each file.
  const html = renderWidgets({
    widgets: [{
      key: "filechanges",
      lines: [
        "Δ components/Foo.tsx (+12/-4)",
        "Δ lib/bar.ts (+8/-2)",
        "Δ app/page.tsx (+20/-6)",
      ],
      placement: "aboveEditor",
    }],
  });

  assert.match(html, /filechanges/);
  assert.match(html, /components\/Foo\.tsx/);
  assert.match(html, /lib\/bar\.ts/);
  assert.match(html, /app\/page\.tsx/);
  assert.match(html, /\+12\/-4/);
});

test("filechanges empty-content widget still renders a clickable tab", () => {
  // Zero changes: the extension clears the widget (no tab). But if a widget has
  // an empty lines array it must not crash; render the trigger row without a panel.
  const html = renderWidgets({
    widgets: [{ key: "filechanges", lines: [], placement: "aboveEditor" }],
  });
  assert.match(html, /extension-widget-triggers/);
});
