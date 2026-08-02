// 任务执行模块（前置编排）
// 用户确认某方案后，将方案拆解为有序执行任务（DAG：线性依赖链），并构造交给
// 自主编程引擎的变更输入。真正的「按序执行」由统一引擎（createChange + startRun）
// 完成；本模块负责把共识方案转化为引擎可消费的结构化任务与描述。

import type { OrchestratedTask, RecommendationPlan } from "./orchestrator-types";

let taskSeq = 0;
function nextTaskId(): string {
  taskSeq += 1;
  return `task_${Date.now().toString(36)}_${taskSeq}`;
}

/** 把方案描述拆分为有序任务（按中英文分句 / 编号列表）。 */
export function decomposePlanHeuristic(plan: RecommendationPlan): OrchestratedTask[] {
  const raw = (plan.summary || "").replace(/\r/g, "");
  const parts = raw
    .split(/[\n;；。]+|(?:\d+)[.、)）]\s*/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 4);

  const tasks: OrchestratedTask[] = [];
  parts.forEach((text, i) => {
    const id = nextTaskId();
    tasks.push({
      id,
      title: text.length > 48 ? `${text.slice(0, 48)}…` : text,
      description: text,
      dependsOn: i > 0 ? [tasks[i - 1].id] : [],
      order: i,
    });
  });

  // 若方案描述过短无法拆分，则退化为单任务。
  if (tasks.length === 0) {
    tasks.push({
      id: nextTaskId(),
      title: plan.title,
      description: plan.summary || plan.title,
      dependsOn: [],
      order: 0,
    });
  }
  return tasks;
}

// 交给自主编程引擎的确认载荷。
export interface ConfirmPayload {
  title: string;
  description: string;
  cwd: string;
}

/** 构造确认载荷：方案标题 + 结构化描述（含优缺点/场景 + 任务清单）。 */
export function buildConfirmPayload(
  requirement: string,
  plan: RecommendationPlan,
  cwd: string,
  tasks: OrchestratedTask[],
): ConfirmPayload {
  const description = [
    `## 用户需求`,
    requirement,
    ``,
    `## 确认方案：${plan.title}`,
    plan.summary,
    ``,
    `### 优点`,
    ...plan.pros.map((p) => `- ${p}`),
    `### 缺点 / 风险`,
    ...plan.cons.map((c) => `- ${c}`),
    `### 适用场景`,
    ...plan.scenarios.map((s) => `- ${s}`),
    ``,
    `## 执行任务`,
    ...tasks.map((t, i) => `${i + 1}. ${t.title}`),
  ].join("\n");

  return { title: plan.title, description, cwd };
}
