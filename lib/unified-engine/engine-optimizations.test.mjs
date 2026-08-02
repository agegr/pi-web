// engine-optimizations.test.mjs —— 验证本次性能/鲁棒性优化的逻辑一致性（不破坏原有行为）
// 使用独立临时目录隔离持久化副作用（与 persistence.test.mjs 同）。
// 注：EngineRuntime 含 TS 参数属性，strip-only 模式无法加载，故其 createChange 幂等性
// 经类型检查 + 人工核对验证；此处覆盖可剥离的纯函数/适配器行为。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), "pi-engine-opt-"));
process.once("exit", () => {
  try {
    rmSync(process.env.PI_CODING_AGENT_DIR, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

const { isEngineStateEquivalent } = await import("../engine-runtime-store.ts");
const { createAutoPlanAdapter } = await import("./autoplan-adapter.ts");

const EMPTY = {
  engineId: "unified-engine",
  phase: "idle",
  processes: [],
  requirementLifecycle: [],
  taskStatus: { pending: 0, running: 0, completed: 0, failed: 0, skipped: 0, total: 0 },
  runs: [],
  autoplan: { ready: false, features: [] },
  stats: { startedAt: 0, updatedAt: 0, errorCount: 0 },
};

test("isEngineStateEquivalent：仅 updatedAt 不同视为等价（抑制冗余通知）", () => {
  const a = { ...EMPTY, stats: { ...EMPTY.stats, updatedAt: 1 } };
  const b = { ...EMPTY, stats: { ...EMPTY.stats, updatedAt: 999 } };
  assert.equal(isEngineStateEquivalent(a, b), true);
});

test("isEngineStateEquivalent：phase / 任务数变化视为不等价", () => {
  assert.equal(
    isEngineStateEquivalent({ ...EMPTY, phase: "idle" }, { ...EMPTY, phase: "executing" }),
    false,
  );
  const withTask = {
    ...EMPTY,
    taskStatus: { ...EMPTY.taskStatus, running: 1, total: 1 },
  };
  assert.equal(isEngineStateEquivalent(EMPTY, withTask), false);
});

test("enqueueTasks 幂等：同一 plan 重复调用不追加重复任务", async () => {
  const adapter = createAutoPlanAdapter();
  await adapter.createRequirement({ title: "t", cwd: "/x" });
  const plan = await adapter.generatePlan({ title: "t", cwd: "/x" });
  const first = await adapter.enqueueTasks(plan.id);
  const second = await adapter.enqueueTasks(plan.id);
  assert.equal(first.length, second.length);
  assert.deepEqual(
    first.map((t) => t.id),
    second.map((t) => t.id),
  );
});
