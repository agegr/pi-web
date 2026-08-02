// autoplan-loop-service.ts —— 融合引擎「应用/编排」层（M1 / 等价迁移 autoplan application/ + domain/）
//
// 作为全生命周期唯一编排器，串起「需求立项 → 计划生成 → 任务入队 → 交付物落盘 → 任务执行
//  → 反馈回收」，并产出富事件（终端实时流 / 进程树 / 守卫实时状态），把所有运行时原语
// （scheduler / event-bus / process-runner / pty-runner / storage / redaction）收敛到一处。
//
// 关键约束（延续批次 A–D）：
//  - 全纯 TypeScript，不使用 Go；
//  - 子进程一律 argv 数组 + 白名单，绝不 shell:true；
//  - comet 守卫真实化：仅当 comet 未安装才降级放行，否则失败/异常一律阻断。
//
// EngineRuntime 作为 LifecycleContext 注入所有引擎交互能力，loop-service 不含全局单例，
// 便于单测与替换（如测试时注入内存 ctx）。
import type {
  RunState,
  Requirement,
  Stage,
  Workflow,
  GuardResult,
  EngineEvent,
  TerminalStream,
  ProcessNode,
  GuardStatusEvent,
} from "./unified-engine-types";
import type { PlanGeneratorPort } from "./plan-generator-ports";
import type { WorkflowStateMachinePort } from "./workflow-state-machine-ports";
import type { WorkerPool } from "./runtime/scheduler";
import { uid } from "../id";
import * as storage from "./storage";
import { sanitize } from "./redaction";

/** 编排所需引擎能力（由 EngineRuntime 实现并注入）。 */
export interface LifecycleContext {
  readonly planGen: PlanGeneratorPort;
  readonly wf: WorkflowStateMachinePort;
  readonly scheduler: WorkerPool;

  /** 发布引擎事件（写入统一 store + 推送 SSE）。 */
  emit(e: Omit<EngineEvent, "at">): void;
  /** 原子持久化运行态（best-effort）。 */
  persist(run: RunState): void;
  /** 标记运行失败并通知。 */
  failRun(run: RunState, message: string): void;
  /** 协同式暂停检查。 */
  shouldPause(run: RunState): Promise<boolean>;
  /** 读取 comet 当前阶段（best-effort）。 */
  readCometPhase(change: string, cwd: string): Promise<string | undefined>;
  /** comet 守卫（真实化：未安装降级放行，否则失败/异常阻断）。 */
  safeGuard(run: RunState, phase: Stage, knownPhase?: string | undefined): Promise<GuardResult>;
  /** comet 推进（真实化：同上）。 */
  safeAdvance(run: RunState, phase: Stage, knownPhase?: string | undefined): Promise<boolean>;

  // ── 富事件 ──
  /** 创建/返回某 run 的终端流。 */
  openTerminal(runId: string, title: string): TerminalStream;
  /** 追加片段到 run 终端流（实时）。 */
  appendTerminal(runId: string, chunk: string): void;
  /** 关闭 run 终端流。 */
  closeTerminal(runId: string): void;
  /** 记录进程树节点（spawn）。 */
  recordProcess(node: ProcessNode): void;
  /** 记录守卫实时状态。 */
  recordGuard(g: GuardStatusEvent): void;
}

function nowIso(): string {
  return new Date().toISOString();
}

type StageOutcome = "continue" | "pause" | "stop";

interface StageHandler {
  readonly name: Stage;
  canRun(run: RunState): boolean;
  execute(run: RunState, req: Requirement): Promise<StageOutcome>;
}

/**
 * 运行完整生命周期（design→build→verify→archive）。
 * 与 EngineRuntime 既有行为等价，并额外产出终端/进程/守卫富事件。
 * @param ctx 引擎能力上下文（EngineRuntime 注入）。
 * @param run 运行态（会被原地推进）。
 * @param req 需求（来自内存或恢复）。
 */
export async function runLifecycle(
  ctx: LifecycleContext,
  run: RunState,
  req: Requirement,
): Promise<void> {
  // 阶段管线（与既有 runLoop 顺序 fall-through 等价）。
  const pipeline: readonly StageHandler[] = [
    {
      name: "design",
      canRun: (r) => r.stage === "open" || r.stage === "design",
      execute: (r, q) => designStage(ctx, r, q),
    },
    { name: "build", canRun: (r) => r.stage === "build", execute: (r) => buildStage(ctx, r) },
    { name: "verify", canRun: (r) => r.stage === "verify", execute: (r) => verifyStage(ctx, r) },
  ];

  // 自愈：确保 change 目录与 .comet.yaml 存在（best-effort）。
  try {
    await ctx.wf.ensureChange(run.changeName, "hotfix" as Workflow, run.cwd);
  } catch (e) {
    ctx.emit({
      type: "log",
      runId: run.runId,
      message: `change 目录自愈失败：${(e as Error).message}`,
    });
  }

  if (!req) {
    ctx.failRun(run, `需求不存在（${run.requirementId}），无法生成计划。请重新创建变更。`);
    return;
  }

  // 已完成（archive）的 run 直接收尾，避免 resume 误标记。
  if (run.stage === "archive") {
    run.status = "completed";
    run.updatedAt = nowIso();
    ctx.persist(run);
    ctx.emit({ type: "run.updated", runId: run.runId, payload: run });
    return;
  }

  for (const handler of pipeline) {
    if (!handler.canRun(run)) continue;
    const outcome = await handler.execute(run, req);
    if (outcome !== "continue") return;
    if (await ctx.shouldPause(run)) return;
  }
}

async function designStage(
  ctx: LifecycleContext,
  run: RunState,
  req: Requirement,
): Promise<StageOutcome> {
  run.stage = "design";
  run.updatedAt = nowIso();
  ctx.persist(run);
  ctx.emit({ type: "stage.changed", runId: run.runId, payload: { stage: run.stage } });

  const plan = await ctx.planGen.generatePlan({
    title: req.title,
    description: req.description,
    cwd: run.cwd,
  });
  run.planId = plan.id;
  storage.saveRequirement(req);
  storage.savePlan(plan);

  const tasks = await ctx.planGen.enqueueTasks(plan.id);
  run.tasks = tasks;
  for (const t of tasks) storage.saveTask(t);
  ctx.persist(run);
  ctx.emit({ type: "run.updated", runId: run.runId, payload: run });

  if (await ctx.shouldPause(run)) return "pause";

  await ctx.planGen.prepareBuildDeliverables(plan.id, {
    cwd: run.cwd,
    changeName: run.changeName,
  });

  await ctx.safeAdvance(run, "open");
  if (await ctx.shouldPause(run)) return "pause";
  run.stage = "build";
  run.updatedAt = nowIso();
  ctx.persist(run);
  ctx.emit({ type: "stage.changed", runId: run.runId, payload: { stage: run.stage } });
  return "continue";
}

async function buildStage(ctx: LifecycleContext, run: RunState): Promise<StageOutcome> {
  run.stage = "build";
  run.updatedAt = nowIso();
  ctx.persist(run);
  ctx.emit({ type: "stage.changed", runId: run.runId, payload: { stage: run.stage } });

  // 打开 run 终端流（实时展示任务执行与测试输出）。
  const terminal = ctx.openTerminal(run.runId, `运行 ${run.title}`);
  void terminal;

  const pending = run.tasks.filter(
    (t) => t.status !== "completed" && t.status !== "failed" && t.status !== "skipped",
  );

  // 经调度器受控并发执行（M3：Promise 队列 + 并发上限），复用既有行为。
  await Promise.all(
    pending.map((task) =>
      ctx.scheduler.submit(async () => {
        const res = await ctx.planGen.runTask(task.id, {
          cwd: run.cwd,
          changeName: run.changeName,
          onTerminalChunk: (chunk) => ctx.appendTerminal(run.runId, chunk),
          onProcessSpawn: (p) => ctx.recordProcess(p),
          onProcessExit: (pid) => ctx.recordProcess({ pid, ppid: 0, title: "", status: "exited" }),
        });
        task.status = res.status;
        task.result = res.output;
        storage.saveTask(task);
        ctx.persist(run);
        ctx.emit({ type: "task.updated", runId: run.runId, payload: task });
        if (await ctx.shouldPause(run)) return;
      }),
    ),
  );

  ctx.closeTerminal(run.runId);
  run.stage = "verify";
  run.updatedAt = nowIso();
  ctx.persist(run);
  ctx.emit({ type: "stage.changed", runId: run.runId, payload: { stage: run.stage } });
  return "continue";
}

async function verifyStage(ctx: LifecycleContext, run: RunState): Promise<StageOutcome> {
  const cometPhase = await ctx.readCometPhase(run.changeName, run.cwd);

  const guardBuild = await ctx.safeGuard(run, "build", cometPhase);
  ctx.recordGuard({
    runId: run.runId,
    change: run.changeName,
    phase: "build",
    passed: guardBuild.passed,
    message: sanitize(guardBuild.message) as unknown as string,
    at: nowIso(),
  });
  if (!guardBuild.passed) {
    ctx.failRun(run, guardBuild.message ?? "build 守卫未通过");
    ctx.emit({ type: "guard", runId: run.runId, message: guardBuild.message, payload: guardBuild });
    return "stop";
  }
  if (!(await ctx.safeAdvance(run, "build", cometPhase))) return "stop";

  try {
    await ctx.wf.prepareVerifyArtifacts(run.changeName, run.cwd);
  } catch (e) {
    ctx.emit({
      type: "log",
      runId: run.runId,
      message: `verify 交付物准备失败：${(e as Error).message}`,
    });
  }

  const guardVerify = await ctx.safeGuard(run, "verify", cometPhase);
  ctx.recordGuard({
    runId: run.runId,
    change: run.changeName,
    phase: "verify",
    passed: guardVerify.passed,
    message: sanitize(guardVerify.message) as unknown as string,
    at: nowIso(),
  });
  if (!guardVerify.passed) {
    ctx.failRun(run, guardVerify.message ?? "verify 守卫未通过");
    ctx.emit({
      type: "guard",
      runId: run.runId,
      message: guardVerify.message,
      payload: guardVerify,
    });
    return "stop";
  }
  if (!(await ctx.safeAdvance(run, "verify", cometPhase))) return "stop";

  run.stage = "archive";
  run.status = "completed";
  run.updatedAt = nowIso();
  ctx.persist(run);
  ctx.emit({ type: "stage.changed", runId: run.runId, payload: { stage: run.stage } });
  ctx.emit({ type: "run.updated", runId: run.runId, payload: run });
  return "continue";
}

/** 反馈回收：转交 planGen 并持久化 feedback 实体（M2）。 */
export async function submitFeedback(
  ctx: LifecycleContext,
  taskId: string,
  feedback: string,
): Promise<void> {
  await ctx.planGen.submitFeedback(taskId, feedback);
  storage.saveFeedback({
    id: uid("fb"),
    taskId,
    requirementId: "",
    kind: "note",
    message: feedback,
    createdAt: nowIso(),
  });
}
