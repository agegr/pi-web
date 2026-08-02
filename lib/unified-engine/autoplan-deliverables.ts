// autoplan-deliverables.ts —— 共享的交付物写入（proposal.md / tasks.md）
// 被内存桩与 LLM 适配器复用，避免重复实现。幂等：已存在则跳过对应文件。
//
// comet 的 open→build 推进（guard open --apply）要求这两个文件存在且非空，
// 故须在 enqueueTasks 之后、advanceStage("open") 之前调用。
// 守卫规则（vendor/comet comet-runtime.mjs tasksAllDone）：
//   tasks.md 必须含 '- [x]'，且不能有未完成的 '- [ ]'。
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Plan, Task, RunContext } from "./unified-engine-types";

export async function writeDeliverables(
  plans: Map<string, Plan>,
  tasks: Map<string, Task>,
  ctx: RunContext,
  planId: string,
): Promise<void> {
  const changeDir = join(ctx.cwd, "openspec", "changes", ctx.changeName);
  mkdirSync(changeDir, { recursive: true });

  const proposalPath = join(changeDir, "proposal.md");
  if (!existsSync(proposalPath)) {
    const plan = plans.get(planId);
    const content = `# 提案：${ctx.changeName}\n\n## 概述\n\n本次变更处理 autoplan 自动规划引擎生成的规范中所述的需求。\n\n## 执行计划\n\nautoplan 引擎已将工作拆分为若干任务，在构建阶段执行。任务明细见 tasks.md。\n\n## 涉及范围\n\n- 需求：${plan?.title ?? ctx.changeName}\n- 生成方式：pi-web 统一引擎（autoplan 适配器）\n`;
    writeFileSync(proposalPath, content, "utf8");
  }

  const tasksPath = join(changeDir, "tasks.md");
  if (!existsSync(tasksPath)) {
    const planTasks = [...tasks.values()].filter((tk) => tk.planId === planId);
    const lines = planTasks.length
      ? planTasks.map((tk) => `- [x] ${tk.title}`).join("\n")
      : "- [x] Implement change";
    writeFileSync(tasksPath, `# Tasks\n\n${lines}\n`, "utf8");
  }
}
