import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { GoalPanel } = await jiti.import("./GoalPanel.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");

function render(model) {
  return renderToStaticMarkup(
    React.createElement(I18nProvider, null, React.createElement(GoalPanel, {
      model,
      onAction() {},
      onEditSubmit() {},
    })),
  );
}

test("renders an active goal with pause/edit/clear and hides when empty", () => {
  assert.equal(render(null), "");
  const html = render({
    objective: "Ship GoalPanel",
    status: "active",
    statusLabel: "active",
    timeLabel: "12m",
    budgetLabel: "1.2K/10K",
    editMode: "replace",
  });
  assert.match(html, /goal-panel/);
  assert.match(html, /Ship GoalPanel/);
  assert.match(html, /12m · 1\.2K\/10Kt/);
  assert.match(html, /Pause|暂停/);
  assert.doesNotMatch(html, /Resume|继续/);
});
