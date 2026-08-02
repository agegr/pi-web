// autoplan-domain.ts —— autoplan 域模型与状态机（M1 / 等价迁移 domain/plan/plan.go:29-38）
//
// 纯类型 + 纯函数，不依赖任何运行时/IO，可在 node --test 中直接测试。
// 移植上游 Plan 状态枚举与状态机（draft→pending→running→...），并对需求/任务/反馈建模。
import type { TaskStatus } from "./unified-engine-types";

/** 计划（Plan）生命周期状态（对应上游 domain/plan/plan.go:29-38）。 */
export type PlanState =
  "draft" | "pending" | "running" | "paused" | "completed" | "failed" | "cancelled";

export const PLAN_STATES: readonly PlanState[] = [
  "draft",
  "pending",
  "running",
  "paused",
  "completed",
  "failed",
  "cancelled",
];

/** 触发计划状态迁移的事件。 */
export type PlanEvent =
  | "submit" // draft → pending
  | "start" // pending → running
  | "pause" // running → paused
  | "resume" // paused → running
  | "complete" // running → completed
  | "fail" // running → failed
  | "cancel"; // 任意(非终态) → cancelled

/** 状态机迁移表（合法跃迁）。未列出的跃迁非法，advancePlanState 返回原状态。 */
const PLAN_TRANSITIONS: Record<PlanState, Partial<Record<PlanEvent, PlanState>>> = {
  draft: { submit: "pending", cancel: "cancelled" },
  pending: { start: "running", cancel: "cancelled" },
  running: { pause: "paused", complete: "completed", fail: "failed", cancel: "cancelled" },
  paused: { resume: "running", cancel: "cancelled" },
  completed: {},
  failed: { start: "running" }, // 失败可重试
  cancelled: {},
};

export function isTerminalPlanState(s: PlanState): boolean {
  return s === "completed" || s === "failed" || s === "cancelled";
}

/** 纯函数状态机：返回应用事件后的新状态（非法跃迁返回原状态，不抛错）。 */
export function advancePlanState(state: PlanState, event: PlanEvent): PlanState {
  return PLAN_TRANSITIONS[state]?.[event] ?? state;
}

/** 需求（Requirement）生命周期（等价迁移 domain/intake/model.go:24 + 反馈双类型）。 */
export type RequirementState =
  "received" | "analyzing" | "planned" | "executing" | "feedback" | "delivered" | "rejected";

/** 反馈类型（等价迁移 domain/intake/model.go:25 双类型）。 */
export type FeedbackKind = "approval" | "change-request" | "defect" | "note";

export interface Feedback {
  id: string;
  taskId?: string;
  requirementId: string;
  kind: FeedbackKind;
  message: string;
  createdAt: string;
}

/** 任务状态 ↔ 上游 TaskStatus 兼容（复用统一类型）。 */
export type { TaskStatus };

/** 校验计划标题/规格非空等不变量（等价迁移 domain 持久化中立不变式）。 */
export function assertValidPlan(spec: string): void {
  if (!spec || spec.trim().length === 0) {
    throw new Error("计划规格不能为空");
  }
}
