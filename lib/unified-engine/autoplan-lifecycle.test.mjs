// autoplan-lifecycle.test.mjs —— T3.4 生命周期集成测试（FR-3 / NF-7）
//
// 脱 LLM：用 memory adapter 兜底，覆盖 autoplan 全生命周期关键跃迁：
//   需求立项 → 计划生成 → 任务入队 → 交付物落盘 → 任务执行 → 反馈回收。
// 另验证 T3.2 状态桥接 getAutoPlanStatus 随所选实现正确反映就绪与启用特性。
// 注：EngineRuntime 含 TS 参数属性，strip-only 无法加载；此处覆盖 PlanGeneratorPort
// 契约层的生命周期，不依赖 comet / 外部工具链。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CWD = mkdtempSync(join(tmpdir(), "pi-autoplan-life-"));
process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), "pi-autoplan-agent-"));
process.once("exit", () => {
  for (const d of [CWD, process.env.PI_CODING_AGENT_DIR]) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

const { createAutoPlanAdapter, getAutoPlanStatus } = await import("./autoplan-adapter.ts");

test("生命周期贯通：需求→计划→入队→交付物→执行→反馈（memory 兜底）", async () => {
  const adapter = createAutoPlanAdapter();

  // 1) 需求立项
  const req = await adapter.createRequirement({ title: "示例需求", description: "描述", cwd: CWD });
  assert.ok(req.id, "需求应生成 id");
  assert.equal(req.title, "示例需求");

  // 2) 计划生成
  const plan = await adapter.generatePlan({ title: "示例需求", description: "描述", cwd: CWD });
  assert.ok(plan.id, "计划应生成 id");
  assert.match(plan.spec, /任务/, "计划 spec 应含任务清单");

  // 3) 任务入队
  const tasks = await adapter.enqueueTasks(plan.id);
  assert.ok(tasks.length > 0, "应入队至少一个任务");
  assert.ok(
    tasks.every((t) => t.status === "pending"),
    "入队任务初始状态应为 pending",
  );

  // 4) 交付物落盘（best-effort，不抛错）
  await adapter.prepareBuildDeliverables(plan.id, { changeName: "example-change", cwd: CWD });

  // 5) 任务执行
  const result = await adapter.runTask(tasks[0].id, { changeName: "example-change", cwd: CWD });
  assert.equal(result.taskId, tasks[0].id);
  assert.equal(result.status, "completed", "memory 执行体应完成任务");

  // 6) 反馈回收（不抛错）
  await adapter.submitFeedback(tasks[0].id, "验证通过");
});

test("状态桥接：memory 实现未就绪且标注 memory-stub", () => {
  createAutoPlanAdapter(); // 无 LLM 工厂 → memory 兜底
  const status = getAutoPlanStatus();
  assert.equal(status.ready, false, "memory 桩不算就绪");
  assert.ok(status.features.includes("memory-stub"), "应标注 memory-stub 特性");
});

test("状态桥接：注入 LLM 工厂时视为就绪并标注 llm-completion", () => {
  // 提供最小 LLM 工厂（不实际调用），仅切换所选实现到真实 LLM 适配器。
  createAutoPlanAdapter(() => async () => "{}");
  const status = getAutoPlanStatus();
  assert.equal(status.ready, true, "注入 LLM 工厂后应就绪");
  assert.ok(status.features.includes("llm-completion"), "应标注 llm-completion 特性");
});
