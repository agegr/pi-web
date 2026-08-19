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
  computeFileSummary,
  formatExtensionWidgetContent,
  getNextExpandedWidgetKey,
  getUpdatedExtensionWidgetKeys,
  parseFilechangeLine,
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

// --- parseFilechangeLine unit tests ---

test("parseFilechangeLine parses modified file line", () => {
  const result = parseFilechangeLine("Δ lib/foo.ts (+12/-4)");
  assert.deepEqual(result, {
    status: "modified",
    path: "lib/foo.ts",
    added: 12,
    removed: 4,
  });
});

test("parseFilechangeLine parses added file line", () => {
  const result = parseFilechangeLine("+ components/new.tsx (+20/-0)");
  assert.deepEqual(result, {
    status: "added",
    path: "components/new.tsx",
    added: 20,
    removed: 0,
  });
});

test("parseFilechangeLine returns null for non-matching lines", () => {
  assert.equal(parseFilechangeLine("Δ 17 files changed"), null);
  assert.equal(parseFilechangeLine(""), null);
  assert.equal(parseFilechangeLine("random text"), null);
});

// --- computeFileSummary unit tests ---

test("computeFileSummary counts modified and added files", () => {
  const lines = [
    "Δ lib/foo.ts (+12/-4)",
    "Δ lib/bar.ts (+8/-2)",
    "Δ lib/baz.ts (+5/-1)",
    "Δ app/page.tsx (+20/-6)",
    "Δ app/layout.tsx (+3/-1)",
    "Δ app/globals.css (+10/-2)",
    "Δ hooks/useTheme.ts (+6/-3)",
    "Δ hooks/useI18n.ts (+4/-2)",
    "Δ components/Header.tsx (+7/-1)",
    "Δ components/Footer.tsx (+9/-3)",
    "+ components/NewWidget.tsx (+15/-0)",
    "+ lib/newUtil.ts (+10/-0)",
    "+ app/api/new/route.ts (+8/-0)",
    "+ hooks/useNew.ts (+6/-0)",
    "+ components/AnotherNew.tsx (+5/-0)",
    "+ lib/anotherUtil.ts (+4/-0)",
    "+ app/new/page.tsx (+3/-0)",
  ];
  assert.equal(computeFileSummary(lines), "Δ 17 files (10 mod / 7 new)");
});

test("computeFileSummary handles single file", () => {
  assert.equal(
    computeFileSummary(["Δ lib/foo.ts (+12/-4)"]),
    "Δ 1 file (1 mod)",
  );
});

test("computeFileSummary handles only added files", () => {
  assert.equal(
    computeFileSummary(["+ a.ts (+1/-0)", "+ b.ts (+2/-0)"]),
    "Δ 2 files (2 new)",
  );
});

test("computeFileSummary handles only modified files", () => {
  assert.equal(
    computeFileSummary(["Δ a.ts (+1/-1)"]),
    "Δ 1 file (1 mod)",
  );
});

test("computeFileSummary handles empty lines", () => {
  assert.equal(computeFileSummary([]), "Δ 0 files");
});

// --- Filechanges widget trigger/panel tests ---

test("filechanges trigger shows the File Changes label", () => {
  const html = renderWidgets({
    widgets: [{
      key: "filechanges",
      lines: [
        "Δ lib/foo.ts (+12/-4)",
        "Δ lib/bar.ts (+8/-2)",
        "+ components/new.tsx (+15/-0)",
      ],
      placement: "aboveEditor",
    }],
  });
  // Trigger shows the canonical user-visible label, not raw "filechanges" key
  assert.match(html, />File Changes</);
  // Panel heading still shows widget key
  assert.match(html, /extension-widget-panel-heading.*filechanges/s);
});

test("filechanges expanded panel renders structured file entries", () => {
  const html = renderWidgets({
    widgets: [{
      key: "filechanges",
      lines: [
        "Δ lib/foo.ts (+12/-4)",
        "+ components/new.tsx (+15/-0)",
      ],
      placement: "aboveEditor",
    }],
  });
  // Structured file entries rendered
  assert.match(html, /extension-widget-file-entry/);
  assert.match(html, /extension-widget-file-status/);
  assert.match(html, /extension-widget-file-path/);
  assert.match(html, /extension-widget-file-changes/);
  // File paths visible
  assert.match(html, /lib\/foo\.ts/);
  assert.match(html, /components\/new\.tsx/);
  // Status indicators
  assert.match(html, /data-status="modified"/);
  assert.match(html, /data-status="added"/);
  // Change counts
  assert.match(html, /\+12\/-4/);
  assert.match(html, /\+15\/-0/);
});

test("filechanges widget with zero files has no panel", () => {
  const html = renderWidgets({
    widgets: [{ key: "filechanges", lines: [], placement: "aboveEditor" }],
  });
  assert.doesNotMatch(html, /extension-widget-panel/);
  assert.match(html, /extension-widget-triggers/);
});

test("filechanges click does not produce /filechanges in visible text", () => {
  // The rendered HTML should not show /filechanges as user-visible text
  // that could be confused with a sent command.
  const html = renderWidgets({
    widgets: [{
      key: "filechanges",
      lines: ["Δ lib/foo.ts (+12/-4)"],
      placement: "aboveEditor",
    }],
  });
  // The visible label should be the computed summary, not /filechanges
  assert.doesNotMatch(html, />\/filechanges</);
});

test("filechanges preserves existing exec/tasks/details behavior", () => {
  // Fixed tabs render their canonical user-visible labels
  const html = renderWidgets({
    widgets: [
      { key: "exec-summary", lines: ["done"], placement: "aboveEditor" },
      { key: "filechanges", lines: ["Δ a.ts (+1/-0)"], placement: "aboveEditor" },
    ],
  });
  // exec-summary renders its canonical label
  assert.match(html, />Exec Summary</);
  // filechanges renders its canonical label
  assert.match(html, />File Changes</);
});

test("renders fixed extension tabs in canonical order at the end", () => {
  // Register in arbitrary order (worst case: reverse), footer present.
  const html = renderWidgets({
    widgets: [
      { key: "exec-summary", lines: ["tools: 3"], placement: "aboveEditor" },
      { key: "plan-todos", lines: ["task-1"], placement: "aboveEditor" },
      { key: "filechanges", lines: ["Δ a.ts (+1/-0)"], placement: "aboveEditor" },
      { key: "normal-tab", lines: ["x"], placement: "aboveEditor" },
    ],
    footer: { sections: [], meta: null },
  });
  const labels = [...html.matchAll(/class="extension-widget-key">([^<]+)</g)].map((m) => m[1]);
  assert.deepEqual(labels, ["normal-tab", "File Changes", "Details", "Tasks", "Exec Summary"]);
});

test("repeated recreation keeps fixed tab order stable", () => {
  const render = (order) => renderWidgets({
    widgets: order.map((key, i) => ({ key, lines: [`line-${i}`], placement: "aboveEditor" })),
    footer: { sections: [], meta: null },
  });
  const html1 = render(["exec-summary", "plan-todos", "filechanges", "details"]);
  const html2 = render(["details", "filechanges", "plan-todos", "exec-summary"]);
  const labels = (h) => [...h.matchAll(/class="extension-widget-key">([^<]+)</g)].map((m) => m[1]);
  assert.deepEqual(labels(html1), ["File Changes", "Details", "Tasks", "Exec Summary"]);
  assert.deepEqual(labels(html2), ["File Changes", "Details", "Tasks", "Exec Summary"]);
});
