import assert from "node:assert/strict";
import test from "node:test";

import { updateExtensionWidgets } from "./extension-widgets.ts";

const agents = { key: "agents", lines: ["Agents: idle"], placement: "belowEditor" };
const fleet = { key: "fleet", lines: ["Fleet: idle"], placement: "belowEditor" };

test("updates competing widgets without changing their order", () => {
  const afterAgentsUpdate = updateExtensionWidgets(
    [agents, fleet],
    "agents",
    ["Agents: running"],
    "belowEditor",
  );
  const afterFleetUpdate = updateExtensionWidgets(
    afterAgentsUpdate,
    "fleet",
    ["Fleet: running"],
    "belowEditor",
  );

  assert.deepEqual(afterFleetUpdate.map((widget) => widget.key), ["agents", "fleet"]);
  assert.deepEqual(afterFleetUpdate.map((widget) => widget.lines), [
    ["Agents: running"],
    ["Fleet: running"],
  ]);
});

test("appends new widgets and removes cleared widgets", () => {
  const withFleet = updateExtensionWidgets([agents], "fleet", fleet.lines, fleet.placement);
  assert.deepEqual(withFleet.map((widget) => widget.key), ["agents", "fleet"]);

  const withoutAgents = updateExtensionWidgets(withFleet, "agents", undefined);
  assert.deepEqual(withoutAgents, [fleet]);
});
