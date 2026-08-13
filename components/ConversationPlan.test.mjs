import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { ConversationPlan, getConversationPlanWidget, parseTodoWidget, shouldRequestPlanItems } = await jiti.import("./ConversationPlan.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");

const widget = {
  key: "rpiv-todos",
  lines: [
    "● Todos (2/3)",
    "├─ ✓ Inspect sidebar header",
    "├─ ◐ Design sidebar hierarchy (designing hierarchy)",
    "└─ ○ Implement approved header",
  ],
  placement: "aboveEditor",
};

function renderPlan(props = {}) {
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ConversationPlan, { widget, ...props }),
    ),
  );
}

test("parses rpiv todos into plan rows", () => {
  assert.deepEqual(parseTodoWidget(widget.lines), {
    completed: 2,
    total: 3,
    items: [
      { status: "completed", text: "Inspect sidebar header" },
      { status: "in_progress", text: "Design sidebar hierarchy", detail: "designing hierarchy" },
      { status: "pending", text: "Implement approved header" },
    ],
  });
});

test("falls back when a todo body contains unknown rows", () => {
  assert.equal(parseTodoWidget([
    "● Todos (1/2)",
    "unexpected format",
    "raw detail",
  ]), null);
});

test("rejects unknown plus-prefixed summary rows", () => {
  assert.equal(parseTodoWidget([
    "● Todos (1/3)",
    "└─ +2 unrecognized payload",
  ]), null);
});

test("preserves the plugin overflow summary", () => {
  assert.deepEqual(parseTodoWidget([
    "● Todos (1/4)",
    "├─ ✓ Done",
    "└─ +3 more (3 pending)",
  ]), {
    completed: 1,
    total: 4,
    items: [{ status: "completed", text: "Done" }],
    summary: "+3 more (3 pending)",
  });
});

test("requests plugin rows only when expanding a title-only plan", () => {
  assert.equal(shouldRequestPlanItems(false, 0), true);
  assert.equal(shouldRequestPlanItems(true, 0), false);
  assert.equal(shouldRequestPlanItems(false, 2), false);
});

test("extracts only recognized rpiv todos from the footer widgets", () => {
  const generic = { key: "usage", lines: ["42%"], placement: "aboveEditor" };
  const recognized = getConversationPlanWidget([generic, widget]);
  const unknown = getConversationPlanWidget([
    generic,
    { ...widget, lines: ["● Todos (1/2)", "unexpected format", "raw detail"] },
  ]);

  assert.equal(recognized, widget);
  assert.equal(unknown, undefined);
});

test("renders a collapsed Codex-style update plan activity by default", () => {
  const html = renderPlan();

  assert.match(html, /conversation-plan/);
  assert.match(html, /Update plan/);
  assert.match(html, /2\/3/);
  assert.match(html, /aria-expanded="false"/);
  assert.doesNotMatch(html, /Inspect sidebar header/);
  assert.doesNotMatch(html, /Todos|rpiv-todos/);
});

test("renders plan rows only when expanded", () => {
  const html = renderPlan({ defaultExpanded: true });

  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /Inspect sidebar header/);
  assert.match(html, /Design sidebar hierarchy/);
  assert.match(html, /designing hierarchy/);
  assert.match(html, /Implement approved header/);
  assert.match(html, /data-status="completed"/);
  assert.match(html, /data-status="in_progress"/);
});

test("parses a collapsed plugin widget from its title", () => {
  assert.deepEqual(parseTodoWidget([], "● Todos (1/3)"), {
    completed: 1,
    total: 3,
    items: [],
  });
});
