import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { orderPanelTabs, movePanelTab } = await jiti.import("./panel-tab-order.ts");
const ids = (tabs) => tabs.map((tab) => tab.id);

test("move panel tabs before or after across file, terminal and agent tabs", () => {
  const initial = ["file:a", "file:b", "terminal:1", "agent:1"];
  assert.deepEqual(movePanelTab(initial, "agent:1", "file:a", false), ["agent:1", "file:a", "file:b", "terminal:1"]);
  assert.deepEqual(movePanelTab(initial, "file:a", "terminal:1", true), ["file:b", "terminal:1", "file:a", "agent:1"]);
  assert.deepEqual(initial, ["file:a", "file:b", "terminal:1", "agent:1"]);
  assert.equal(movePanelTab(initial, "file:a", "file:a", true), initial);
  assert.equal(movePanelTab(initial, "missing", "file:a", false), initial);
});

test("removed tabs disappear and newly opened tabs append without breaking saved order", () => {
  const tabs = ["file:a", "terminal:1", "agent:1"].map((id) => ({ id }));
  const order = ["agent:1", "file:closed", "file:a", "terminal:1"];
  assert.deepEqual(ids(orderPanelTabs(tabs, order)), ["agent:1", "file:a", "terminal:1"]);
  assert.deepEqual(ids(orderPanelTabs([...tabs, { id: "file:new" }], order)), ["agent:1", "file:a", "terminal:1", "file:new"]);
  assert.equal(orderPanelTabs(tabs, []), tabs);
});
