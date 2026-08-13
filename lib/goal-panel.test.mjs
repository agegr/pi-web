import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  extractGoalFromEntries,
  filterGoalStatuses,
  filterGoalWidgets,
  inferGoalFromStatus,
  parseGoalWidget,
  resolveGoalPanelModel,
} = await jiti.import("./goal-panel.ts");

test("parses lyhue goal widget JSON", () => {
  const model = parseGoalWidget({
    key: "goal",
    lines: [JSON.stringify({
      objective: "Ship the panel",
      status: "active",
      statusLabel: "active",
      timeUsedSeconds: 90,
      timeLabel: "1m",
      tokensUsed: 1200,
      tokenBudget: 10000,
      budgetLabel: "1.2K/10K",
    })],
  });
  assert.equal(model?.objective, "Ship the panel");
  assert.equal(model?.status, "active");
  assert.equal(model?.budgetLabel, "1.2K/10K");
  assert.equal(model?.editMode, "edit");
});

test("extracts the latest pi-codex-goal set entry and honors clear", () => {
  const entries = [
    { type: "custom", customType: "pi-codex-goal", data: { kind: "host_overflow_cap_reset", active: true } },
    { type: "custom", customType: "pi-codex-goal", data: {
      kind: "set",
      goal: { objective: "First", status: "active", tokenBudget: 1000, usage: { tokensUsed: 10, activeSeconds: 12 } },
    } },
    { type: "custom", customType: "pi-codex-goal", data: {
      kind: "set",
      goal: { objective: "Second", status: "paused", tokenBudget: null, usage: { tokensUsed: 20, activeSeconds: 80 } },
    } },
  ];
  const model = extractGoalFromEntries(entries);
  assert.equal(model?.objective, "Second");
  assert.equal(model?.status, "paused");
  assert.equal(model?.timeLabel, "1m");
  assert.equal(model?.editMode, "replace");

  entries.push({ type: "custom", customType: "pi-codex-goal", data: { kind: "clear", clearedGoalId: "x" } });
  assert.equal(extractGoalFromEntries(entries), null);
});

test("infers a compact model from the pi-codex-goal footer", () => {
  assert.equal(inferGoalFromStatus("Pursuing goal (12m)")?.status, "active");
  assert.equal(inferGoalFromStatus("Pursuing goal (1.2M / 2.0M)")?.budgetLabel, "1.2M / 2.0M");
  assert.equal(inferGoalFromStatus("Goal paused (/goal resume)")?.status, "paused");
  assert.equal(inferGoalFromStatus("Goal achieved (4.1K tokens)")?.status, "complete");
  assert.equal(inferGoalFromStatus("Goal unmet (100K / 100K tokens)")?.status, "budget_limited");
  assert.equal(inferGoalFromStatus("FAST · unsupported"), null);
});

test("prefers widget, then session entry, then status, and strips goal chrome", () => {
  const widgets = [{ key: "goal", lines: [JSON.stringify({ objective: "From widget", status: "active", statusLabel: "active" })] }];
  const statuses = [{ key: "codex-goal", text: "Pursuing goal (3m)" }, { key: "ponytail", text: "FULL" }];
  const sessionGoal = extractGoalFromEntries([{
    type: "custom",
    customType: "pi-codex-goal",
    data: { kind: "set", goal: { objective: "From session", status: "active", usage: { tokensUsed: 1, activeSeconds: 9 } } },
  }]);

  assert.equal(resolveGoalPanelModel({ widgets, statuses, sessionGoal })?.objective, "From widget");
  assert.equal(resolveGoalPanelModel({ widgets: [], statuses, sessionGoal })?.objective, "From session");
  assert.equal(resolveGoalPanelModel({ widgets: [], statuses, sessionGoal: null })?.status, "active");
  assert.equal(resolveGoalPanelModel({ widgets: [], statuses: [{ key: "ponytail", text: "FULL" }], sessionGoal, live: true }), null);
  assert.deepEqual(filterGoalStatuses(statuses).map((item) => item.key), ["ponytail"]);
  assert.deepEqual(filterGoalWidgets(widgets), []);
});
