// WorkflowStateMachinePort —— comet 侧能力端口
// 仅暴露"状态机/守卫/恢复"语义，具体实现由 comet-adapter 唯一经 child_process 调用 vendor/comet .mjs。
// 注意：comet 是 prompt+CLI 驱动，所有方法最终 spawn 白名单内的 .mjs 脚本（cwd=项目根）。
import type { ChangeState, Stage, StageEvent, GuardResult, Workflow } from "./unified-engine-types";

export interface WorkflowStateMachinePort {
  /** 打开一个可恢复 change（等价于 comet-state.mjs init） */
  readonly openChange: (
    changeName: string,
    workflow: Workflow,
    cwd: string,
  ) => Promise<ChangeState>;
  /** 幂等确保 change 存在：目录/.comet.yaml 缺失则 init，已存在则直接读状态。
   *  供 runLoop 在每次执行前自愈——修复历史坏 run（createChange 时 init 失败、
   *  目录未建但 run 已持久化的情况），避免重试永远卡在 verify 守卫的 "change directory not found"。 */
  readonly ensureChange: (
    changeName: string,
    workflow: Workflow,
    cwd: string,
  ) => Promise<ChangeState>;
  /** 读取 change 当前状态 */
  readonly getState: (changeName: string, cwd: string) => Promise<ChangeState>;
  /** 推进阶段（等价于 comet-guard.mjs <change> <phase> --apply） */
  readonly advanceStage: (changeName: string, phase: Stage, cwd: string) => Promise<StageEvent>;
  /** 仅校验守卫不推进（等价于 comet-guard.mjs <change> <phase>） */
  readonly evaluateGuard: (changeName: string, phase: Stage, cwd: string) => Promise<GuardResult>;
  /** 准备 verify→archive 守卫要求的交付物：写 verification_report 文件并 set
   *  .comet.yaml 的 verification_report/branch_status 字段。桩实现场景下由引擎
   *  在调 evaluateGuard("verify") 前调用，让守卫能通过。 */
  readonly prepareVerifyArtifacts: (changeName: string, cwd: string) => Promise<void>;
  /** 由磁盘状态恢复 change（读取 .comet.yaml + run-state.json） */
  readonly resumeRun: (changeName: string, cwd: string) => Promise<ChangeState>;
}
