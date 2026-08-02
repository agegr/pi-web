// PlanGeneratorPort —— autoplan 侧能力端口
// 仅暴露"计划/任务/反馈"语义，具体实现由 autoplan-adapter 唯一导入 vendor/autoplan。
import type {
  Plan,
  RequirementInput,
  Requirement,
  Task,
  TaskResult,
  RunContext,
} from "./unified-engine-types";

export interface PlanGeneratorPort {
  /** 创建需求（等价于 autoplan IntakeService.createRequirement） */
  readonly createRequirement: (req: RequirementInput) => Promise<Requirement>;
  /** 由需求生成计划（等价于 autoplan planGeneration.generatePlanForIntake） */
  readonly generatePlan: (req: RequirementInput) => Promise<Plan>;
  /** 计划拆解为任务队列（等价于 autoplan planTaskSync + planLifecycle.insertPlan） */
  readonly enqueueTasks: (planId: string) => Promise<Task[]>;
  /** 在 build 阶段开始前写交付物（proposal.md/tasks.md）到 change 目录。
   *  comet 的 open→build 推进（guard open --apply）就要求这两个文件存在，
   *  故须在 enqueueTasks 后、advanceStage("open") 前调用。 */
  readonly prepareBuildDeliverables: (planId: string, ctx: RunContext) => Promise<void>;
  /** 执行单个任务（等价于 autoplan taskExecution.processPlan） */
  readonly runTask: (taskId: string, ctx: RunContext) => Promise<TaskResult>;
  /** 提交反馈回流重规划（等价于 autoplan IntakeService.createFeedback） */
  readonly submitFeedback: (taskId: string, feedback: string) => Promise<void>;
}
