// autoplan-domain.test.mjs —— 域状态机单测（M1 / 等价迁移 domain/plan/plan.go）
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  advancePlanState,
  isTerminalPlanState,
  assertValidPlan,
  PLAN_STATES,
} from "./autoplan-domain";

test("advancePlanState：合法跃迁", () => {
  assert.equal(advancePlanState("draft", "submit"), "pending");
  assert.equal(advancePlanState("pending", "start"), "running");
  assert.equal(advancePlanState("running", "pause"), "paused");
  assert.equal(advancePlanState("paused", "resume"), "running");
  assert.equal(advancePlanState("running", "complete"), "completed");
  assert.equal(advancePlanState("running", "fail"), "failed");
});

test("advancePlanState：非法跃迁返回原状态（不抛错）", () => {
  assert.equal(advancePlanState("completed", "start"), "completed");
  assert.equal(advancePlanState("draft", "complete"), "draft");
});

test("isTerminalPlanState：终态识别", () => {
  assert.equal(isTerminalPlanState("completed"), true);
  assert.equal(isTerminalPlanState("failed"), true);
  assert.equal(isTerminalPlanState("cancelled"), true);
  assert.equal(isTerminalPlanState("running"), false);
});

test("assertValidPlan：空规格抛错", () => {
  assert.throws(() => assertValidPlan("   "), /不能为空/);
  assert.doesNotThrow(() => assertValidPlan("有效规格"));
});

test("PLAN_STATES：枚举完整", () => {
  assert.deepEqual(
    [...PLAN_STATES],
    ["draft", "pending", "running", "paused", "completed", "failed", "cancelled"],
  );
});
