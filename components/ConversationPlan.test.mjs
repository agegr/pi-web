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
    hasOpenItems: true,
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
    hasOpenItems: true,
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
  assert.match(html, /class="conversation-plan-items" data-expanded="false" aria-hidden="true"/);
  assert.match(html, /class="conversation-plan-items-content" role="list"/);
  assert.match(html, /Inspect sidebar header/);
  assert.doesNotMatch(html, /Todos|rpiv-todos/);
});

test("renders plan rows only when expanded", () => {
  const html = renderPlan({ defaultExpanded: true });

  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /class="conversation-plan-items" data-expanded="true" aria-hidden="false"/);
  assert.match(html, /Inspect sidebar header/);
  assert.match(html, /Design sidebar hierarchy/);
  assert.match(html, /designing hierarchy/);
  assert.match(html, /Implement approved header/);
  assert.match(html, /data-status="completed"/);
  assert.match(html, /data-status="in_progress"/);
});

test("parses a collapsed plugin widget from its title", () => {
  assert.deepEqual(parseTodoWidget([], "● Todos (1/3)"), {
    hasOpenItems: true,
    completed: 1,
    total: 3,
    items: [],
  });
});

test("marks a completed title as inactive", () => {
  assert.deepEqual(parseTodoWidget([], "○ Todos (3/3)"), {
    hasOpenItems: false,
    completed: 3,
    total: 3,
    items: [],
  });
});

test("renders summary and row status without a frozen-looking loader", () => {
  const active = renderPlan({ defaultExpanded: true });
  const complete = renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(ConversationPlan, {
        defaultExpanded: true,
        widget: {
          ...widget,
          lines: ["○ Todos (1/1)", "└─ ✓ Finished"],
        },
      }),
    ),
  );

  assert.match(active, /conversation-plan-mark" data-status="in_progress"/);
  assert.match(active, /conversation-plan-spinner/);
  assert.match(active, /conversation-plan-active-static/);
  assert.match(active, /aria-label="Update plan: In progress, 2\/3"/);
  assert.match(active, /aria-label="In progress: Design sidebar hierarchy, designing hierarchy"/);
  assert.match(complete, /conversation-plan-mark" data-status="completed"/);
});
