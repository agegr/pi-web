// engine-runtime-store.ts —— 统一引擎运行时监控状态（globalThis 单例 + useSyncExternalStore）
//
// 作为 agent-orchestrator 与 unified-engine 双引擎合并后的「唯一」监控状态表面：
// 任何引擎的运行时状态变更都收敛到此处，前端经 hooks/useEngineRuntime 订阅，
// 不再各自维护平行的状态副本（消除 unified-engine 与 orchestrator 重复持久化/事件的问题）。
import type {
  RunState,
  Requirement,
  Task,
  TerminalStream,
  ProcessNode,
  GuardStatusEvent,
} from "./unified-engine/unified-engine-types";

export type EnginePhase = "idle" | "planning" | "discussing" | "executing" | "done" | "error";

export type RequirementLifecycle =
  "received" | "discussing" | "converged" | "executing" | "delivered";

export interface EngineProcess {
  id: string;
  title: string;
  stage: string;
  status: RunState["status"];
  cwd: string;
  updatedAt: string;
}

export interface RequirementNode {
  id: string;
  title: string;
  lifecycle: RequirementLifecycle;
  createdAt: string;
}

export interface TaskStatusSummary {
  pending: number;
  running: number;
  completed: number;
  failed: number;
  skipped: number;
  total: number;
}

export interface AutoPlanStatus {
  ready: boolean;
  features: string[];
}

export interface UnifiedEngineState {
  engineId: string;
  phase: EnginePhase;
  processes: EngineProcess[];
  requirementLifecycle: RequirementNode[];
  taskStatus: TaskStatusSummary;
  /** 全量运行态透传：供看板做 per-run 详情渲染（任务卡 / 阶段 / 控制操作）。 */
  runs: RunState[];
  /** autoplan-ts 运行时桥接：就绪状态与已启用特性（T3.2 注入真实值）。 */
  autoplan: AutoPlanStatus;
  /** 终端实时流（PTY 输出），每个终端一段带 ANSI 的行缓冲。 */
  terminals: TerminalStream[];
  /** 进程树：父子进程关系 + 资源占用（best-effort）。 */
  processTree: ProcessNode[];
  /** 守卫实时状态（最近 N 条）。 */
  guardStatus: GuardStatusEvent[];
  stats: { startedAt: number; updatedAt: number; errorCount: number };
}

const EMPTY: UnifiedEngineState = {
  engineId: "unified-engine",
  phase: "idle",
  processes: [],
  requirementLifecycle: [],
  taskStatus: { pending: 0, running: 0, completed: 0, failed: 0, skipped: 0, total: 0 },
  runs: [],
  autoplan: { ready: false, features: [] },
  terminals: [],
  processTree: [],
  guardStatus: [],
  stats: { startedAt: 0, updatedAt: 0, errorCount: 0 },
};

function lifecycleFromRun(run: RunState | undefined): RequirementLifecycle {
  if (!run) return "received";
  if (run.status === "completed" || run.stage === "archive") return "delivered";
  if (run.stage === "verify") return "executing";
  if (run.stage === "build") return "converged";
  if (run.stage === "open" || run.stage === "design") return "discussing";
  return "received";
}

function summarizeTasks(tasks: Task[]): TaskStatusSummary {
  const acc: TaskStatusSummary = {
    pending: 0,
    running: 0,
    completed: 0,
    failed: 0,
    skipped: 0,
    total: tasks.length,
  };
  for (const t of tasks) acc[t.status] += 1;
  return acc;
}

function derivePhase(runs: RunState[]): EnginePhase {
  if (runs.some((r) => r.status === "failed")) return "error";
  if (runs.some((r) => r.status === "running")) return "executing";
  if (runs.some((r) => r.status === "completed")) return "done";
  if (runs.some((r) => r.status === "paused")) return "planning";
  if (runs.length) return "planning";
  return "idle";
}

/** 判断两份快照「可见内容」是否等价：忽略 stats.updatedAt（仅记录末次变更时刻，
 *  不影响监控展示）。用于在状态无实质变化时跳过通知，抑制 SSE 推送 / React 重渲染风暴。
 *  比较维度覆盖 phase、processes、requirementLifecycle、taskStatus、stats（除 updatedAt）。 */
export function isEngineStateEquivalent(a: UnifiedEngineState, b: UnifiedEngineState): boolean {
  if (a === b) return true;
  if (a.engineId !== b.engineId || a.phase !== b.phase) return false;
  if (a.stats.startedAt !== b.stats.startedAt || a.stats.errorCount !== b.stats.errorCount) {
    return false;
  }
  // autoplan 桥接字段：就绪状态或特性集合变化即视为实质变更。
  if (
    a.autoplan.ready !== b.autoplan.ready ||
    a.autoplan.features.length !== b.autoplan.features.length
  ) {
    return false;
  }
  for (let i = 0; i < a.autoplan.features.length; i++) {
    if (a.autoplan.features[i] !== b.autoplan.features[i]) return false;
  }
  const p = a.processes;
  const q = b.processes;
  if (p.length !== q.length) return false;
  for (let i = 0; i < p.length; i++) {
    const x = p[i];
    const y = q[i];
    if (
      x.id !== y.id ||
      x.title !== y.title ||
      x.stage !== y.stage ||
      x.status !== y.status ||
      x.cwd !== y.cwd ||
      x.updatedAt !== y.updatedAt
    ) {
      return false;
    }
  }
  const r = a.requirementLifecycle;
  const s = b.requirementLifecycle;
  if (r.length !== s.length) return false;
  for (let i = 0; i < r.length; i++) {
    const x = r[i];
    const y = s[i];
    if (
      x.id !== y.id ||
      x.title !== y.title ||
      x.lifecycle !== y.lifecycle ||
      x.createdAt !== y.createdAt
    ) {
      return false;
    }
  }
  const t = a.taskStatus;
  const u = b.taskStatus;
  // runs 透传：按运行标识 / 状态 / 阶段 / 更新时刻 / 任务状态集合判断实质变更。
  const m = a.runs;
  const n = b.runs;
  if (m.length !== n.length) return false;
  for (let i = 0; i < m.length; i++) {
    const x = m[i];
    const y = n[i];
    if (
      x.runId !== y.runId ||
      x.status !== y.status ||
      x.stage !== y.stage ||
      x.updatedAt !== y.updatedAt
    ) {
      return false;
    }
    if (x.tasks.length !== y.tasks.length) return false;
    for (let j = 0; j < x.tasks.length; j++) {
      if (x.tasks[j].status !== y.tasks[j].status) return false;
    }
  }
  // 终端流：长度 + 各终端 id/closed/行数/更新时刻 变化即不等价。
  const term = a.terminals ?? [];
  const term2 = b.terminals ?? [];
  if (term.length !== term2.length) return false;
  for (let i = 0; i < term.length; i++) {
    const x = term[i];
    const y = term2[i];
    if (
      x.id !== y.id ||
      x.closed !== y.closed ||
      x.lines.length !== y.lines.length ||
      x.updatedAt !== y.updatedAt
    ) {
      return false;
    }
  }
  // 进程树：长度 + 各节点 pid/status 变化即不等价。
  const pt = a.processTree ?? [];
  const pt2 = b.processTree ?? [];
  if (pt.length !== pt2.length) return false;
  for (let i = 0; i < pt.length; i++) {
    if (pt[i].pid !== pt2[i].pid || pt[i].status !== pt2[i].status) return false;
  }
  // 守卫状态：长度 + 末条 at/passed 变化即不等价。
  const gs = a.guardStatus ?? [];
  const gs2 = b.guardStatus ?? [];
  if (gs.length !== gs2.length) return false;
  for (let i = 0; i < gs.length; i++) {
    if (gs[i].at !== gs2[i].at || gs[i].passed !== gs2[i].passed) return false;
  }
  return (
    t.pending === u.pending &&
    t.running === u.running &&
    t.completed === u.completed &&
    t.failed === u.failed &&
    t.skipped === u.skipped &&
    t.total === u.total
  );
}

/** autoplan-ts 运行时状态提供方（由 unified-engine 在 T3.2 注册真实值；默认未就绪）。 */
let autoPlanStatusProvider: (() => AutoPlanStatus) | null = null;

/** 注入 autoplan 运行时状态提供方；传 null 取消注入（回退默认未就绪）。 */
export function setAutoPlanStatusProvider(fn: (() => AutoPlanStatus) | null): void {
  autoPlanStatusProvider = fn;
}

/** 由引擎内部 maps 构建统一监控快照（供 publish 调用）。 */
export function buildEngineState(
  runs: RunState[],
  requirements: Requirement[],
  errorCount: number,
  opts?: {
    autoplan?: AutoPlanStatus;
    terminals?: TerminalStream[];
    processTree?: ProcessNode[];
    guardStatus?: GuardStatusEvent[];
  },
): UnifiedEngineState {
  const allTasks = runs.flatMap((r) => r.tasks);
  const processes: EngineProcess[] = runs.map((r) => ({
    id: r.runId,
    title: r.title,
    stage: r.stage,
    status: r.status,
    cwd: r.cwd,
    updatedAt: r.updatedAt,
  }));
  // requirementId → run 索引（O(R) 一次构建，替换原 O(R²) 的 runs.find）。
  const runByReq = new Map<string, RunState>();
  for (const r of runs) runByReq.set(r.requirementId, r);
  const requirementLifecycle: RequirementNode[] = requirements.map((q) => ({
    id: q.id,
    title: q.title,
    lifecycle: lifecycleFromRun(runByReq.get(q.id)),
    createdAt: q.createdAt,
  }));
  const autoPlanStatus = opts?.autoplan ?? autoPlanStatusProvider?.() ?? EMPTY.autoplan;
  return {
    engineId: "unified-engine",
    phase: derivePhase(runs),
    processes,
    requirementLifecycle,
    taskStatus: summarizeTasks(allTasks),
    runs,
    autoplan: autoPlanStatus,
    terminals: opts?.terminals ?? EMPTY.terminals,
    processTree: opts?.processTree ?? EMPTY.processTree,
    guardStatus: opts?.guardStatus ?? EMPTY.guardStatus,
    stats: { startedAt: 0, updatedAt: Date.now(), errorCount },
  };
}

type Listener = () => void;

interface EngineStore {
  subscribe(cb: Listener): () => void;
  getSnapshot(): UnifiedEngineState;
  setSnapshot(next: UnifiedEngineState): void;
}

function createStore(): EngineStore {
  let state: UnifiedEngineState = EMPTY;
  const listeners = new Set<Listener>();
  return {
    subscribe(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    getSnapshot() {
      return state;
    },
    setSnapshot(next) {
      // 内容无实质变化则跳过通知（仅 updatedAt 变化的冗余快照不再触发重渲染）。
      if (isEngineStateEquivalent(state, next)) return;
      state = next;
      for (const l of listeners) l();
    },
  };
}

const g = globalThis as unknown as { __piEngineRuntimeStore?: EngineStore };

/** 跨 Next.js 热重载存活的全局单例。 */
export function getEngineRuntimeStore(): EngineStore {
  if (!g.__piEngineRuntimeStore) {
    g.__piEngineRuntimeStore = createStore();
  }
  return g.__piEngineRuntimeStore;
}
