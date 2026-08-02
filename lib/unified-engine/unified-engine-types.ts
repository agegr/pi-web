// 融合引擎领域类型（统一 autoplan 计划语义与 comet 状态机语义）
// 业务层只依赖这些类型，不感知上游差异。

export type Stage = "open" | "design" | "build" | "verify" | "archive";

export const STAGES: readonly Stage[] = ["open", "design", "build", "verify", "archive"];

/** comet 工作流预设。vendor/comet 的 init 命令仅接受这三个值（PROFILES），
 *  传其它值（如 'classic'）会被 validateEnum 拒绝，导致 .comet.yaml 不创建、
 *  后续 guard 报 "change directory not found"。
 *  - full：完整五阶段，非预设，build_mode/tdd_mode/isolation/verify_mode 全 null，
 *          需用户在 build 阶段逐项配置——guard 会检查这些字段，自动化引擎难以满足。
 *  - hotfix：精简预设，init 自动设 build_mode=direct/tdd_mode=direct/isolation=branch/
 *          verify_mode=light/review_mode=off，跳过这四项 guard 检查。pi-web 融合引擎
 *          的 autoplan 桩实现走 hotfix，仅需产出 proposal.md/tasks.md 即可通过 build 守卫。
 *  - tweak：另一精简预设，语义类似 hotfix。 */
export type Workflow = "full" | "hotfix" | "tweak";

/** 默认工作流预设，可通过 ENGINE_WORKFLOW 环境变量覆盖（T6.1 决策：默认 "hotfix"）。
 *  取值边界（自动化引擎仅走精简预设）：
 *  - 未设 / 非法值 → "hotfix"（精简预设，init 自动填 build_mode/tdd_mode/isolation/
 *    verify_mode/review_mode，autoplan 直写模式仅产出 proposal.md/tasks.md 即可过 build 守卫）；
 *  - "tweak" → 另一精简预设，语义类似 hotfix；
 *  - "full" → 完整五阶段，四项守卫字段全 null，需在真实引擎部署下由使用方逐项配置。
 *  仅接受 Workflow 三个合法值；非法值（如 "classic"）会被 comet init validateEnum 拒绝，
 *  故此处收敛回退到 "hotfix"，避免非法值透传到 comet 导致 .comet.yaml 不创建。 */
export const DEFAULT_WORKFLOW: Workflow = ((): Workflow => {
  const v = process.env.ENGINE_WORKFLOW;
  return v === "full" || v === "hotfix" || v === "tweak" ? v : "hotfix";
})();

export type TaskStatus = "pending" | "running" | "completed" | "failed" | "skipped";

/** LLM 补全函数签名（与 lib/agent-orchestrator/runner 的 LlmCompletion 同构）。
 *  由组合根（unified-engine-adapter）注入 createPiLlmCompletion，适配器不感知 SDK。 */
export type LlmCompletionFn = (systemPrompt: string, userMessage: string) => Promise<string>;

export type RunStatus = "idle" | "running" | "paused" | "completed" | "failed";

export interface RequirementInput {
  title: string;
  description?: string;
  cwd?: string;
}

export interface Requirement {
  id: string;
  title: string;
  description?: string;
  createdAt: string;
}

export interface Plan {
  id: string;
  requirementId: string;
  title: string;
  spec: string;
  createdAt: string;
}

export interface Task {
  id: string;
  planId: string;
  title: string;
  status: TaskStatus;
  retries: number;
  result?: string;
  backtrace?: string[];
}

export interface TaskResult {
  taskId: string;
  status: TaskStatus;
  output?: string;
}

export interface ChangeState {
  name: string;
  workflow: Workflow;
  phase: Stage;
  runId?: string;
  verifyResult?: string;
}

export interface StageEvent {
  change: string;
  from: Stage;
  to: Stage;
  event: string;
  at: string;
}

export interface GuardResult {
  change: string;
  phase: Stage;
  passed: boolean;
  message?: string;
}

export interface RunContext {
  cwd: string;
  changeName: string;
  /** 任务执行期的终端输出片段回调（PTY/测试输出实时流）。 */
  onTerminalChunk?: (chunk: string) => void;
  /** 任务执行期 spawn 的进程节点回调（进程树）。 */
  onProcessSpawn?: (p: ProcessNode) => void;
  /** 进程退出回调（按 pid）。 */
  onProcessExit?: (pid: number) => void;
}

export interface RunState {
  runId: string;
  changeName: string;
  requirementId: string;
  title: string;
  planId?: string;
  stage: Stage;
  status: RunStatus;
  tasks: Task[];
  cwd: string;
  createdAt: string;
  updatedAt: string;
  /** 需求描述快照。requirements 仅存内存，进程重启后丢失；把 description 随 run 落盘，
   *  ensureRehydrated 时才能重建 Requirement 供 runLoop 调 generatePlan，否则 runLoop
   *  因 !req 直接 failed（表现为"启动运行"后无任何阶段日志即失败）。 */
  requirementDescription?: string;
  /** 需求创建时刻快照。Requirement 全部字段（id/title/description/createdAt）均随 run 落盘，
   *  使空闲清空内存 / 进程重启后可「无损」重建 Requirement——原先 rehydrate 回退用 run.createdAt
   *  近似需求创建时刻，此字段令重建结果与原对象逐字段一致。缺省（旧快照）时回退旧行为。 */
  requirementCreatedAt?: string;
}

export interface ChangeInput {
  title: string;
  description?: string;
  cwd: string;
  /** 可选幂等键：携带相同键的重复 createChange 会复用既有 run（防 REST 重放/重复提交）。 */
  idempotencyKey?: string;
}

export interface EngineEvent {
  type: "run.created" | "run.updated" | "stage.changed" | "task.updated" | "guard" | "log";
  runId: string;
  at: string;
  message?: string;
  payload?: unknown;
}

// ── 富事件切片类型（M5 / Q14：终端实时流 + 进程树深度视图 + 守卫实时状态） ──

/** 终端流：PTY/进程实时输出（ANSI 序列保留，前端 stripAnsi 渲染）。 */
export interface TerminalStream {
  id: string;
  runId?: string;
  title: string;
  lines: string[];
  pid?: number;
  isPty: boolean;
  updatedAt: string;
  closed: boolean;
}

/** 进程树节点：父子关系 + 资源占用（best-effort）。 */
export interface ProcessNode {
  pid: number;
  ppid: number;
  title: string;
  status: "running" | "exited" | "killed";
  runId?: string;
  /** 资源占用（best-effort，单位随平台；缺失表示不可得）。 */
  cpu?: number;
  memMb?: number;
  startedAt?: string;
}

/** 守卫实时状态事件（对应 comet guard 评估）。 */
export interface GuardStatusEvent {
  runId: string;
  change: string;
  phase: Stage;
  passed: boolean;
  message?: string;
  at: string;
}
