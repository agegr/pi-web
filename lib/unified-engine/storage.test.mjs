// storage.test.mjs —— 自主引擎结构化持久化单测（M2 / §8 持久化验收）
// 覆盖 requirement/plan/task/feedback/outbox 读写与重启恢复（磁盘为权威源）。
// 使用独立临时目录隔离副作用（PI_CODING_AGENT_DIR）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), "pi-engine-storage-"));
process.once("exit", () => {
  try {
    rmSync(process.env.PI_CODING_AGENT_DIR, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

const storage = await import("./storage.ts");

const req = {
  id: "req1",
  title: "需求A",
  description: "描述",
  createdAt: "2026-01-01T00:00:00.000Z",
};
const plan = {
  id: "plan1",
  requirementId: "req1",
  title: "计划A",
  spec: "规格",
  createdAt: "2026-01-01T00:01:00.000Z",
};
const task = { id: "task1", planId: "plan1", title: "任务A", status: "pending", retries: 0 };
const fb = {
  id: "fb1",
  requirementId: "req1",
  kind: "approval",
  message: "ok",
  createdAt: "2026-01-01T00:02:00.000Z",
};

test("requirement/plan/task/feedback 落盘后可还原", () => {
  storage.saveRequirement(req);
  storage.savePlan(plan);
  storage.saveTask(task);
  storage.saveFeedback(fb);

  assert.deepEqual(storage.getRequirement("req1"), req);
  assert.deepEqual(storage.getPlan("plan1"), plan);
  assert.deepEqual(storage.getTask("task1"), task);

  const reqs = storage.loadRequirements();
  assert.ok(reqs.some((r) => r.id === "req1"));
  const plans = storage.loadPlans();
  assert.ok(plans.some((p) => p.id === "plan1"));
  const tasks = storage.loadTasks();
  assert.ok(tasks.some((t) => t.id === "task1"));
  const fbs = storage.loadFeedback();
  assert.ok(fbs.some((f) => f.id === "fb1"));
});

test("upsert 按 id 原地更新（不重复追加）", () => {
  storage.saveTask({ ...task, status: "running", retries: 1 });
  const tasks = storage.loadTasks();
  const matched = tasks.filter((t) => t.id === "task1");
  assert.equal(matched.length, 1);
  assert.equal(matched[0].status, "running");
  assert.equal(matched[0].retries, 1);
});

test("outbox 追加与按上限读取", () => {
  for (let i = 0; i < 5; i++) {
    storage.appendOutbox({
      kind: "log",
      runId: "r1",
      message: `m${i}`,
      at: new Date().toISOString(),
    });
  }
  const out = storage.loadOutbox(200);
  assert.ok(out.length >= 5);
  assert.equal(out[out.length - 1].kind, "log");
});

test("重启恢复：全新模块实例从磁盘重建索引（磁盘为权威源）", async () => {
  // 重新导入模块（带查询串绕过 ESM 缓存），模拟进程重启后冷加载。
  const fresh = await import("./storage.ts?fresh=" + Date.now());
  // 全新实例的 ensureRebuilt 应从磁盘读出此前落盘的数据。
  assert.deepEqual(fresh.getRequirement("req1"), req);
  assert.ok(fresh.loadPlans().some((p) => p.id === "plan1"));
  assert.ok(fresh.loadTasks().some((t) => t.id === "task1"));
  assert.ok(fresh.loadFeedback().some((f) => f.id === "fb1"));
});

test("clearAllStorage 清空全部实体", () => {
  storage.clearAllStorage();
  assert.deepEqual(storage.loadRequirements(), []);
  assert.deepEqual(storage.loadPlans(), []);
  assert.deepEqual(storage.loadTasks(), []);
  assert.deepEqual(storage.loadFeedback(), []);
});
