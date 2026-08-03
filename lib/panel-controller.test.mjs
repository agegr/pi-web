import assert from "node:assert/strict";
import test from "node:test";

// panel-controller 是 globalThis 单例（跨热重载存活），node 环境无 localStorage，
// readJson/writeJson 自动 fallback（typeof window === "undefined" → 安全 noop）。
const { getPanelController } = await import("./panel-controller.ts");

test("navigate 更新 activeId", () => {
  const c = getPanelController();
  c.navigate("plan");
  assert.equal(c.getPanelSnapshot().activeId, "plan");
  c.navigate("engine");
  assert.equal(c.getPanelSnapshot().activeId, "engine");
});

test("navigate 幂等：相同 id 不重复触发", () => {
  const c = getPanelController();
  c.navigate("todo");
  const v1 = c.getSnapshot();
  c.navigate("todo");
  assert.equal(c.getSnapshot(), v1, "version 不变（幂等）");
});

test("bumpBadge 递增、clearBadge 清零", () => {
  const c = getPanelController();
  c.clearBadge("engine");
  assert.equal(c.getPanelSnapshot().badges.engine ?? 0, 0);
  c.bumpBadge("engine");
  c.bumpBadge("engine");
  assert.equal(c.getPanelSnapshot().badges.engine, 2);
  c.clearBadge("engine");
  assert.equal(c.getPanelSnapshot().badges.engine, 0);
});

test("setEngineAvailable 更新快照（去重）", () => {
  const c = getPanelController();
  c.setEngineAvailable(false);
  assert.equal(c.getPanelSnapshot().engineAvailable, false);
  const v1 = c.getSnapshot();
  c.setEngineAvailable(false); // 相同值，不触发
  assert.equal(c.getSnapshot(), v1);
  c.setEngineAvailable(true);
  assert.equal(c.getPanelSnapshot().engineAvailable, true);
});

test("getVisibility 在 node 返回 DEFAULT_VISIBLE（无 localStorage）", () => {
  const c = getPanelController();
  const v = c.getVisibility();
  // 接通后默认开放（见 panel-controller DEFAULT_VISIBLE）
  assert.equal(v.todo, true);
  assert.equal(v.inspector, true);
  assert.equal(v.prompts, true);
  assert.equal(v.plan, true);
  assert.equal(v.engine, true);
});
