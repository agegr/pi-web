// unified-engine-runtime.ts —— 融合引擎运行时（globalThis 单例）
// 以 comet 五阶段状态机为骨架，autoplan 的计划/任务为内容源，编排统一自主编程循环。
// 复用 lib/rpc-manager 思路：globalThis 单例 + 空闲销毁，避免长任务泄漏。
//
// 重构（对应深度分析报告 M1）：生命周期编排委托给 autoplan-loop-service（runLifecycle），
// 本类作为 LifecycleContext 注入全部引擎能力，并负责维护富事件切片
// （terminals / processTree / guardStatus），统一收敛到 engine-runtime-store。
import type { PlanGeneratorPort } from "./plan-generator-ports";
import type { WorkflowStateMachinePort } from "./workflow-state-machine-ports";
import type {
  ChangeInput,
  EngineEvent,
  Requirement,
  RunState,
  Stage,
  GuardResult,
} from "./unified-engine-types";
import type { TerminalStream, ProcessNode, GuardStatusEvent } from "./unified-engine-types";
import { STAGES, DEFAULT_WORKFLOW } from "./unified-engine-types";
import { WorkerPool } from "./runtime/scheduler";
import { runLifecycle, type LifecycleContext } from "./autoplan-loop-service";
import { uid } from "../id";
import { log as logFn } from "../engine-logger";
import { saveEngineRun, loadAllEngineRuns, MAX_RECORDS } from "./persistence";
import { buildEngineState, getEngineRuntimeStore } from "../engine-runtime-store";
import { isCometAvailable } from "./guards/comet-cli";

const IDLE_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_TERMINAL_LINES = 500;
const MAX_GUARD_EVENTS = 50;

function nowIso(): string {
  return new Date().toISOString();
}

function nextStage(phase: Stage): Stage {
  const i = STAGES.indexOf(phase);
  return STAGES[Math.min(i + 1, STAGES.length - 1)];
}

export class EngineRuntime implements LifecycleContext {
  private runs = new Map<string, RunState>();
  private requirements = new Map<string, Requirement>();
  private listeners = new Set<(e: EngineEvent) => void>();
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private rehydrated = false;
  /** 在途运行集合：用于重入保护（已在跑的 run 忽略重复 start/resume）。 */
  private runningIds = new Set<string>();
  /** 幂等键 → runId 映射。 */
  private idempotencyKeys = new Map<string, string>();

  /** 富事件切片（M5 / Q14）。 */
  private terminals = new Map<string, TerminalStream>();
  private runTerminal = new Map<string, string>(); // runId → terminalId
  private processTree = new Map<number, ProcessNode>();
  private guardEvents: GuardStatusEvent[] = [];

  readonly scheduler = new WorkerPool(Number(process.env.ENGINE_SCHEDULER_CONCURRENCY ?? 4) || 4);

  constructor(
    public readonly planGen: PlanGeneratorPort,
    public readonly wf: WorkflowStateMachinePort,
  ) {}

  /** 把单条运行态原子落盘（best-effort），空闲/重启后仍可恢复。 */
  persist(run: RunState): void {
    try {
      saveEngineRun(run);
    } catch {
      // 持久化失败不阻断引擎。
    }
  }

  /** 把全部在途运行态刷盘（防御性，用于空闲前）。 */
  private flushAll(): void {
    for (const run of this.runs.values()) this.persist(run);
  }

  /** 进程重启 / 内存被清空后，从磁盘 rehydrate 进内存（不覆盖在途运行）。 */
  private ensureRehydrated(): void {
    if (this.rehydrated) return;
    this.rehydrated = true;
    try {
      for (const rec of loadAllEngineRuns()) {
        if (!this.runs.has(rec.id)) this.runs.set(rec.id, rec.run);
        const run = rec.run;
        if (run.requirementId && !this.requirements.has(run.requirementId)) {
          this.requirements.set(run.requirementId, {
            id: run.requirementId,
            title: run.title,
            description: run.requirementDescription,
            createdAt: run.requirementCreatedAt ?? run.createdAt,
          });
        }
      }
    } catch {
      // best-effort：恢复失败不阻断引擎。
    }
  }

  subscribe(cb: (e: EngineEvent) => void): () => void {
    this.listeners.add(cb);
    this.touch();
    return () => {
      this.listeners.delete(cb);
    };
  }

  emit(e: Omit<EngineEvent, "at">): void {
    const event: EngineEvent = { ...e, at: new Date().toISOString() };
    for (const cb of this.listeners) cb(event);
    this.publish();
    this.touch();
  }

  /** 把引擎内部状态收敛到统一 runtime store（双引擎合并的唯一监控表面）。 */
  private publish(): void {
    const runs = [...this.runs.values()];
    const state = buildEngineState(
      runs,
      [...this.requirements.values()],
      runs.filter((r) => r.status === "failed").length,
      {
        terminals: [...this.terminals.values()],
        processTree: [...this.processTree.values()],
        guardStatus: this.guardEvents,
      },
    );
    getEngineRuntimeStore().setSnapshot(state);
  }

  private touch(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.flushAll();
      this.runs.clear();
      this.requirements.clear();
      this.listeners.clear();
      this.idempotencyKeys.clear();
      // 富事件切片随内存一并清空（终端/进程仅运行期有意义）。
      this.terminals.clear();
      this.runTerminal.clear();
      this.processTree.clear();
      this.guardEvents = [];
      this.rehydrated = false;
    }, IDLE_TIMEOUT_MS);
  }

  listRuns(): RunState[] {
    this.ensureRehydrated();
    this.enforceCap();
    return [...this.runs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** 内存 runs 上限裁剪：超出 MAX_RECORDS 时丢弃最旧的记录（与持久化对齐）。 */
  private enforceCap(): void {
    if (this.runs.size <= MAX_RECORDS) return;
    const sorted = [...this.runs.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const old of sorted.slice(0, this.runs.size - MAX_RECORDS)) {
      this.runs.delete(old.runId);
    }
  }

  getRunState(runId: string): RunState {
    this.ensureRehydrated();
    const run = this.runs.get(runId);
    if (!run) throw new Error(`运行不存在：${runId}`);
    return run;
  }

  async createChange(input: ChangeInput): Promise<RunState> {
    if (input.idempotencyKey) {
      const existingId = this.idempotencyKeys.get(input.idempotencyKey);
      const existing = existingId ? this.runs.get(existingId) : undefined;
      if (existing) {
        return existing;
      }
      if (existingId) this.idempotencyKeys.delete(input.idempotencyKey);
    }

    const req = await this.planGen.createRequirement({
      title: input.title,
      description: input.description,
      cwd: input.cwd,
    });
    this.requirements.set(req.id, req);

    const changeName = `${this.slug(input.title)}-${uid("c").slice(-4)}`;
    try {
      await this.wf.openChange(changeName, DEFAULT_WORKFLOW, input.cwd);
    } catch (e) {
      this.emit({
        type: "log",
        runId: "system",
        message: `comet 不可用，使用内存状态：${(e as Error).message}`,
      });
    }

    const runId = uid("run");
    const run: RunState = {
      runId,
      changeName,
      requirementId: req.id,
      title: req.title,
      requirementDescription: req.description,
      requirementCreatedAt: req.createdAt,
      stage: "open",
      status: "idle",
      tasks: [],
      cwd: input.cwd,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.runs.set(runId, run);
    if (input.idempotencyKey) {
      for (const [k, v] of this.idempotencyKeys) {
        if (!this.runs.has(v)) this.idempotencyKeys.delete(k);
      }
      this.idempotencyKeys.set(input.idempotencyKey, runId);
    }
    this.persist(run);
    logFn("info", "engine", `创建 change：${changeName}`, { runId: run.runId });
    this.emit({ type: "run.created", runId, payload: run });
    return run;
  }

  async startRun(runId: string): Promise<RunState> {
    const run = this.getRunState(runId);
    if (run.status === "running" && this.runningIds.has(runId)) return run;
    run.status = "running";
    run.updatedAt = nowIso();
    this.persist(run);
    logFn("info", "engine", `启动运行`, { runId: run.runId });
    this.emit({ type: "run.updated", runId, payload: run });
    void this.runLoop(run);
    return run;
  }

  async pauseRun(runId: string): Promise<void> {
    const run = this.getRunState(runId);
    run.status = "paused";
    run.updatedAt = nowIso();
    this.persist(run);
    logFn("info", "engine", `暂停运行`, { runId: run.runId });
    this.emit({ type: "run.updated", runId, payload: run });
  }

  async resumeRun(runId: string): Promise<RunState> {
    const run = this.getRunState(runId);
    if (run.status === "running" && this.runningIds.has(runId)) return run;
    run.status = "running";
    run.updatedAt = nowIso();
    this.persist(run);
    logFn("info", "engine", `恢复运行`, { runId: run.runId });
    this.emit({ type: "run.updated", runId, payload: run });
    void this.runLoop(run);
    return run;
  }

  /** 协调式暂停检查：status 为 paused 时保存并返回 true（让 runLoop 提前退出）。 */
  async shouldPause(run: RunState): Promise<boolean> {
    if (run.status === "paused") {
      run.updatedAt = nowIso();
      this.persist(run);
      this.emit({ type: "run.updated", runId: run.runId, payload: run });
      return true;
    }
    return false;
  }

  /** 将 run 标记为失败并通知（统一失败路径）。 */
  failRun(run: RunState, message: string): void {
    run.status = "failed";
    run.updatedAt = nowIso();
    this.persist(run);
    logFn("error", "engine", message, { runId: run.runId });
    this.emit({ type: "log", runId: run.runId, message });
    this.emit({ type: "run.updated", runId: run.runId, payload: run });
  }

  /** 读取 comet 当前阶段（best-effort，失败返回 undefined）。 */
  async readCometPhase(changeName: string, cwd: string): Promise<string | undefined> {
    try {
      return (await this.wf.getState(changeName, cwd)).phase;
    } catch {
      return undefined;
    }
  }

  /** comet 守卫：守卫真实化（PRD FR-4 / V4）。 */
  async safeGuard(
    run: RunState,
    phase: Stage,
    knownPhase?: string | undefined,
  ): Promise<GuardResult> {
    if (!isCometAvailable()) {
      return {
        change: run.changeName,
        phase,
        passed: true,
        message: "comet 未安装，守卫降级放行（未执行实际检查）",
      };
    }
    try {
      const cometPhase =
        knownPhase !== undefined ? knownPhase : await this.readCometPhase(run.changeName, run.cwd);
      if (cometPhase && cometPhase !== phase) {
        return {
          change: run.changeName,
          phase,
          passed: true,
          message: `comet 阶段已为 ${cometPhase}，跳过 ${phase} 守卫`,
        };
      }
      return await this.wf.evaluateGuard(run.changeName, phase, run.cwd);
    } catch (e) {
      return {
        change: run.changeName,
        phase,
        passed: false,
        message: `comet 守卫执行异常，按失败处理：${(e as Error).message}`,
      };
    }
  }

  /** comet 推进：守卫真实化（PRD FR-4 / V4）。 */
  async safeAdvance(
    run: RunState,
    phase: Stage,
    knownPhase?: string | undefined,
  ): Promise<boolean> {
    if (!isCometAvailable()) {
      run.stage = nextStage(phase);
      run.updatedAt = nowIso();
      this.emit({ type: "stage.changed", runId: run.runId, payload: { stage: run.stage } });
      return true;
    }
    try {
      const cometPhase =
        knownPhase !== undefined ? knownPhase : await this.readCometPhase(run.changeName, run.cwd);
      if (cometPhase && cometPhase !== phase) {
        this.emit({
          type: "log",
          runId: run.runId,
          message: `comet 阶段已为 ${cometPhase}，跳过 ${phase}→${nextStage(phase)} 推进（恢复自愈）`,
        });
        const match = STAGES.indexOf(cometPhase as Stage);
        if (match >= 0) run.stage = STAGES[match];
      } else {
        const ev = await this.wf.advanceStage(run.changeName, phase, run.cwd);
        run.stage = ev.to;
      }
      run.updatedAt = nowIso();
      this.emit({ type: "stage.changed", runId: run.runId, payload: { stage: run.stage } });
      return true;
    } catch (e) {
      this.failRun(run, `阶段推进被守卫阻止：${(e as Error).message}`);
      return false;
    }
  }

  // ── LifecycleContext：富事件实现（M5 / Q14） ──

  /** 日志（供 loop-service 回调；scope 固定 engine）。 */
  log(
    level: "debug" | "info" | "warn" | "error",
    message: string,
    meta?: Record<string, unknown>,
  ): void {
    logFn(level, "engine", message, meta as never);
  }

  /** 打开/返回某 run 的终端流。 */
  openTerminal(runId: string, title: string): TerminalStream {
    const id = uid("term");
    const t: TerminalStream = {
      id,
      runId,
      title,
      lines: [],
      isPty: false,
      updatedAt: nowIso(),
      closed: false,
    };
    this.terminals.set(id, t);
    this.runTerminal.set(runId, id);
    this.publish();
    return t;
  }

  /** 追加片段到 run 终端流（实时）。 */
  appendTerminal(runId: string, chunk: string): void {
    const id = this.runTerminal.get(runId);
    const t = id ? this.terminals.get(id) : undefined;
    if (!t) return;
    const incoming = chunk.split(/\r?\n/);
    for (const line of incoming) t.lines.push(line);
    if (t.lines.length > MAX_TERMINAL_LINES) {
      t.lines = t.lines.slice(t.lines.length - MAX_TERMINAL_LINES);
    }
    t.updatedAt = nowIso();
    this.publish();
  }

  /** 关闭 run 终端流。 */
  closeTerminal(runId: string): void {
    const id = this.runTerminal.get(runId);
    const t = id ? this.terminals.get(id) : undefined;
    if (t) {
      t.closed = true;
      t.updatedAt = nowIso();
    }
    this.publish();
  }

  /** 记录进程树节点（按 pid 合并，保留既有 title/cpu/mem）。 */
  recordProcess(node: ProcessNode): void {
    const prev = this.processTree.get(node.pid);
    const merged: ProcessNode = prev
      ? {
          ...prev,
          ...node,
          title: node.title || prev.title,
          cpu: node.cpu ?? prev.cpu,
          memMb: node.memMb ?? prev.memMb,
        }
      : node;
    this.processTree.set(node.pid, merged);
    this.publish();
  }

  /** 记录守卫实时状态（最近 N 条）。 */
  recordGuard(g: GuardStatusEvent): void {
    this.guardEvents.push(g);
    if (this.guardEvents.length > MAX_GUARD_EVENTS) this.guardEvents.shift();
    this.publish();
  }

  /** 统一自主编程循环：委托 autoplan-loop-service.runLifecycle（M1）。 */
  private async runLoop(run: RunState): Promise<void> {
    this.runningIds.add(run.runId);
    try {
      const req = this.requirements.get(run.requirementId);
      if (!req) {
        this.failRun(run, `需求不存在（${run.requirementId}），无法生成计划。请重新创建变更。`);
        return;
      }
      await runLifecycle(this, run, req);
    } catch (e) {
      this.failRun(run, `运行失败：${(e as Error).message}`);
    } finally {
      this.runningIds.delete(run.runId);
    }
  }

  /** slug 包装（避免与 id.ts 同名导入冲突，保留可读 change 名）。 */
  private slug(title: string): string {
    return (
      title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 32) || "change"
    );
  }
}

// globalThis 单例，跨 Next.js 热重载存活
const g = globalThis as unknown as { __piEngineRuntime?: EngineRuntime };

export function getEngineRuntime(
  planGen: PlanGeneratorPort,
  wf: WorkflowStateMachinePort,
): EngineRuntime {
  if (!g.__piEngineRuntime) {
    g.__piEngineRuntime = new EngineRuntime(planGen, wf);
  }
  return g.__piEngineRuntime;
}
