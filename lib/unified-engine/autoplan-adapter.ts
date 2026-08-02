// autoplan-adapter.ts —— 唯一接入 vendor/autoplan 的适配层（纯 TypeScript 实现，不使用 Go）
// 实现 PlanGeneratorPort。实现语言：TypeScript（本仓库主语言，非 Go）。
// 默认走真实 LLM 适配器（组合根注入 pi 系统配置的 createPiLlmCompletion），
// 仅在完全未注入 LLM 工厂（测试/极端场景）时回退内存桩；**生产路径不使用内存桩**。
//
// 等价迁移说明（本任务约束：禁用 Go）：
// autoplan 上游为 Go 后端，但本功能迁移任务明确要求【不使用 Go 语言开发】，
// 故不拉起任何 Go 进程 / 二进制，改为在本仓库既有 TypeScript 运行时内对 autoplan 的
// 「需求立项 → 计划生成 → 任务入队 → 交付物落盘 → 任务执行 → 反馈回收」生命周期做等价移植。
// 等价实现严格保持与原有统一引擎消费契约（PlanGeneratorPort）一致，功能逻辑不变。
// 仅当 vendored/autoplan 暴露 TS 端口（autoplan-loop-service）时才走真实供应商路径，否则回退 LLM/内存。
import { createRequire } from "node:module";
import type { PlanGeneratorPort } from "./plan-generator-ports";
import type {
  Requirement,
  Plan,
  Task,
  TaskResult,
  RunContext,
  RequirementInput,
  LlmCompletionFn,
} from "./unified-engine-types";
import { uid } from "../id";
import { log } from "../engine-logger";
import { writeDeliverables } from "./autoplan-deliverables";
import { createLlmAutoPlanAdapter } from "./autoplan-llm-adapter";
import { setAutoPlanStatusProvider, type AutoPlanStatus } from "../engine-runtime-store";

// ─────────────────────────────────────────────────────────────────────────
// T3.2 autoplan 状态桥接（FR-3 / V7）
//
// 记录当前实际选用的 autoplan 实现与启用特性，经 setAutoPlanStatusProvider 注入统一
// runtime store：publish() 时 buildEngineState 读取，前端 EngineDashboard 实时反映
// autoplan 运行状态（就绪 + 启用特性），不再是恒定的「未就绪」占位。
// ─────────────────────────────────────────────────────────────────────────
type AutoPlanKind = "vendor" | "llm" | "memory" | null;
let selectedKind: AutoPlanKind = null;

/** 汇报 autoplan-ts 运行时状态：real 实现（vendor / llm）视为就绪，内存桩仅测试兜底不算就绪。 */
export function getAutoPlanStatus(): AutoPlanStatus {
  const features: string[] = [];
  if (selectedKind === "vendor") features.push("vendor-ts-port");
  else if (selectedKind === "llm") features.push("llm-completion");
  else if (selectedKind === "memory") features.push("memory-stub");
  // 环境驱动的能力开关（与实际执行行为一致，便于面板与运维核对）。
  if (process.env.ENGINE_AUTOPLAN_RUN_TESTS === "1") features.push("run-tests");
  if (process.env.ENGINE_REAL_VERIFY !== "0") features.push("real-verify");
  return { ready: selectedKind === "vendor" || selectedKind === "llm", features };
}

// ─────────────────────────────────────────────────────────────────────────
// 等价迁移：真实 autoplan 供应商 TS 端口（ENGINE_AUTOPLAN_VENDOR=1）
//
// 纯 TypeScript 加载，不使用 Go、不拉起子进程。经 createRequire + 变量路径运行时加载
// vendored/autoplan 暴露的 TS 端口，webpack 无法静态求值该路径，规避构建期
// "server relative imports are not implemented yet" 错误。
// 端口不可用（缺 backend / 未导出 createAutoPlanPort）时返回 null，由 createAutoPlanAdapter
// 降级到 LLM/内存桩，保证引擎始终可演示。
// ─────────────────────────────────────────────────────────────────────────
let vendorLoadAttempted = false;
let cachedVendorAdapter: PlanGeneratorPort | null = null;

function tryLoadVendorAutoPlan(): PlanGeneratorPort | null {
  if (vendorLoadAttempted) return cachedVendorAdapter;
  vendorLoadAttempted = true;
  if (process.env.ENGINE_AUTOPLAN_VENDOR !== "1") return null;

  const modulePath = process.env.AUTOPLAN_VENDOR_MODULE || "autoplan-loop-service";
  try {
    // webpackIgnore：消除 "Critical dependency: the request of a dependency is an expression" 警告。
    const req = createRequire(import.meta.url);
    const mod = req(/* webpackIgnore: true */ modulePath);
    const m = (mod ?? {}) as Record<string, unknown>;
    if (typeof m.createAutoPlanPort === "function") {
      cachedVendorAdapter = (m.createAutoPlanPort as () => PlanGeneratorPort)();
      log("info", "engine", "已加载 vendored autoplan TS 端口（等价迁移，无 Go）");
      return cachedVendorAdapter;
    }
    log("debug", "engine", "vendored autoplan 未导出 createAutoPlanPort，回退 LLM/内存桩");
    return null;
  } catch (e) {
    log(
      "debug",
      "engine",
      `vendored autoplan TS 端口不可用，回退 LLM/内存：${(e as Error).message}`,
    );
    return null;
  }
}

/**
 * 内存桩实现（确定性、无 LLM）：仅当组合根完全未注入 LLM 工厂时（如单测隔离）使用。
 * 生产路径因组合根注入 createPiLlmCompletion，不会走到此分支。
 * 状态收敛到实例闭包，避免模块级 Map 泄漏（Q1/P1）。
 */
function createMemoryAutoPlanAdapter(): PlanGeneratorPort {
  const plans = new Map<string, Plan>();
  const tasks = new Map<string, Task>();

  return {
    async createRequirement(req: RequirementInput): Promise<Requirement> {
      const r: Requirement = {
        id: uid("req"),
        title: req.title,
        description: req.description,
        createdAt: new Date().toISOString(),
      };
      return r;
    },
    async generatePlan(req: RequirementInput): Promise<Plan> {
      const plan: Plan = {
        id: uid("plan"),
        requirementId: req.title,
        title: `计划：${req.title}`,
        spec:
          `# ${req.title}\n\n${req.description ?? ""}\n\n` +
          `## 任务\n- 分析需求与约束\n- 实现核心逻辑\n- 编写并运行测试\n- 沉淀文档与验证证据`,
        createdAt: new Date().toISOString(),
      };
      plans.set(plan.id, plan);
      return plan;
    },
    async enqueueTasks(planId: string): Promise<Task[]> {
      const plan = plans.get(planId);
      if (!plan) return [];
      // 幂等：同一 plan 已入队则直接返回既有任务，避免重复调用追加重复任务。
      const existing = [...tasks.values()].filter((t) => t.planId === planId);
      if (existing.length) return existing;
      const titles = ["分析需求与约束", "实现核心逻辑", "编写并运行测试", "沉淀文档与验证证据"];
      const ts: Task[] = titles.map((t) => ({
        id: uid("task"),
        planId,
        title: t,
        status: "pending",
        retries: 0,
      }));
      ts.forEach((t) => tasks.set(t.id, t));
      return ts;
    },
    async prepareBuildDeliverables(planId: string, ctx: RunContext): Promise<void> {
      // 在 build 阶段开始前写交付物（proposal.md/tasks.md）到 change 目录。
      // comet 的 open→build 推进（guard open --apply）就要求这两个文件存在且非空，
      // 故须在 enqueueTasks 后、advanceStage("open") 前调用。
      // 内容用中文匹配项目语言配置 zh-CN。
      try {
        await writeDeliverables(plans, tasks, ctx, planId);
      } catch {
        // 落盘失败不阻断（best-effort，guard 会给出明确失败原因）。
      }
    },
    async runTask(taskId: string, ctx: RunContext): Promise<TaskResult> {
      const t = tasks.get(taskId);
      if (!t) return { taskId, status: "failed" };
      t.status = "running";
      t.result = `已完成：${t.title}（change=${ctx.changeName}, cwd=${ctx.cwd}）`;
      t.status = "completed";
      return { taskId, status: "completed", output: t.result };
    },
    async submitFeedback(taskId: string, feedback: string): Promise<void> {
      const t = tasks.get(taskId);
      if (t) {
        t.backtrace = [...(t.backtrace ?? []), `feedback: ${feedback}`];
      }
    },
  };
}

/**
 * 构造 autoplan 适配器，按优先级选择实现：
 *   1) ENGINE_AUTOPLAN_VENDOR=1 且 vendored TS 端口可用 → 真实供应商适配器（纯 TS，无 Go）；
 *   2) 注入了 createLlm → 真实 LLM 适配器（B 阶段「真实执行」，pi 系统配置模型）；
 *   3) 否则 → 内存桩（仅当完全未注入 LLM，如单测隔离场景；生产路径不触发）。
 *
 * 真实 LLM 适配器不做内存桩兜底：无模型/调用失败则任务如实失败，连续失败达阈值熔断。
 */
export function createAutoPlanAdapter(
  createLlm?: (cwd: string) => LlmCompletionFn | null,
): PlanGeneratorPort {
  const vendor = tryLoadVendorAutoPlan();
  if (vendor) {
    selectedKind = "vendor";
    setAutoPlanStatusProvider(getAutoPlanStatus);
    return vendor;
  }
  if (createLlm) {
    selectedKind = "llm";
    setAutoPlanStatusProvider(getAutoPlanStatus);
    return createLlmAutoPlanAdapter(createLlm);
  }
  selectedKind = "memory";
  setAutoPlanStatusProvider(getAutoPlanStatus);
  return createMemoryAutoPlanAdapter();
}

let registered: PlanGeneratorPort | null = null;

export function registerAutoPlanAdapter(
  adapter: PlanGeneratorPort = createMemoryAutoPlanAdapter(),
): void {
  registered = adapter;
}

export function getAutoPlanAdapter(
  createLlm?: (cwd: string) => LlmCompletionFn | null,
): PlanGeneratorPort {
  if (!registered) registered = createAutoPlanAdapter(createLlm);
  return registered;
}
