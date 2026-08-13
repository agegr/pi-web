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
  parseTodoWidget,
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

test("parses rpiv todos into Codex task rows", () => {
  assert.deepEqual(parseTodoWidget([
    "● Todos (2/5)",
    "├─ ✓ Create entity",
    "├─ ◐ Build repository (building repository)",
    "└─ ○ Add tests",
    "",
  ]), {
    label: "Todos",
    completed: 2,
    total: 5,
    items: [
      { status: "completed", text: "Create entity" },
      { status: "in_progress", text: "Build repository", detail: "building repository" },
      { status: "pending", text: "Add tests" },
    ],
  });
});

test("renders rpiv todos with a dedicated Codex panel", () => {
  const html = renderWidgets({
    widgets: [{
      key: "rpiv-todos",
      lines: ["● Todos (1/2)", "├─ ✓ Done", "└─ ○ Next", ""],
      placement: "aboveEditor",
    }],
    onRunCommand() {},
  });

  assert.match(html, /codex-todo-panel/);
  assert.match(html, /codex-todo-count[^>]*>1\/2</);
  assert.match(html, /data-status="completed"/);
  assert.match(html, /data-status="pending"/);
  assert.doesNotMatch(html, /rpiv-todos|<pre/);
});

test("renders a collapsed rpiv todo from its progress title", () => {
  const html = renderWidgets({
    widgets: [{ key: "rpiv-todos", title: "● Todos (1/3)", lines: [], placement: "aboveEditor" }],
    onRunCommand() {},
  });

  assert.match(html, /codex-todo-panel/);
  assert.match(html, /codex-todo-count[^>]*>1\/3</);
  assert.match(html, /aria-label="Expand"/);
  assert.doesNotMatch(html, /codex-todo-list/);
});

test("falls back to raw widget content when rpiv todo lines are unknown", () => {
  const html = renderWidgets({
    widgets: [{ key: "rpiv-todos", lines: ["unexpected format", "raw detail"], placement: "aboveEditor" }],
  });

  assert.match(html, /<pre/);
  assert.match(html, /unexpected format/);
});

test("does not consume the generic expanded-widget slot", () => {
  const html = renderWidgets({
    widgets: [
      { key: "rpiv-todos", lines: ["● Todos (0/1)", "└─ ○ Next"], placement: "aboveEditor" },
      { key: "details", lines: ["one", "two"], placement: "aboveEditor" },
    ],
  });

  assert.match(html, /codex-todo-panel/);
  assert.match(html, /extension-widget-panel/);
  assert.match(html, /one\ntwo/);
});

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
  assert.doesNotMatch(html, /aria-expanded/);
  assert.match(html, /title="long-extension-widget-key - Below editor widget"/);
  assert.match(html, /extension-widget-key/);
  assert.match(html, /extension-widget-update-pulse/);
  assert.doesNotMatch(html, /extension-widget-preview/);
  assert.doesNotMatch(html, /extension-widget-line-count/);
  assert.doesNotMatch(html, />ready</);
});

test("keeps the rpiv todo collapse command in the dedicated panel", () => {
  const html = renderWidgets({
    widgets: [{ key: "rpiv-todos", lines: ["● Todos (0/2)", "├─ ○ one", "└─ ○ two"], placement: "aboveEditor" }],
    onRunCommand() {},
  });

  assert.match(html, /aria-label="Collapse"/);
});
