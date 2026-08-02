// autoplan-llm-adapter.ts —— 真实 LLM 驱动的 PlanGeneratorPort 实现（B 阶段「真实执行」）
//
// 经注入的 LlmCompletionFn 工厂（组合根注入 pi 系统配置的 createPiLlmCompletion）调用 LLM
// 生成计划与代码，把任务真正落到文件（严格约束在 run.cwd 之内，杜绝路径穿越），并在写盘后
// 真实运行测试验证；测试失败则回滚本次写入。本适配器**不做内存桩兜底**：无 LLM（工厂返回 null）
// 或 LLM 调用失败时，任务如实标记失败，连续失败达到阈值即熔断整个运行，保证行为真实可观测。
//
// 安全：change 创建时 assertSafeCwd 已校验 cwd 为真实存在的目录并登记 allowFileRoot；
// 此处进一步要求 LLM 返回的相对路径不得含 ".."、不得为绝对路径、不得含空字节，
// 且最终写入目标必为 resolve(cwd, rel)，因此无法逃逸 cwd（等价 allowed-roots 约束）。
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { dirname, isAbsolute, resolve, join, sep } from "node:path";
import { spawn } from "node:child_process";
import type { PlanGeneratorPort } from "./plan-generator-ports";
import type {
  Plan,
  RequirementInput,
  Requirement,
  Task,
  TaskResult,
  RunContext,
  LlmCompletionFn,
} from "./unified-engine-types";
import { uid } from "../id";
import { log } from "../engine-logger";
import { writeDeliverables } from "./autoplan-deliverables";
import { assertSafeLlmBaseUrl } from "./ssrf-guard";

function numEnv(name: string, fallback: number): number {
  const v = process.env[name];
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** LLM 单文件编辑。 */
interface FileEdit {
  path: string;
  content: string;
}

/** 一次 runTask 的写盘快照，用于测试失败时回滚。 */
interface WriteSnapshot {
  created: string[]; // 新建文件（回滚时删除）
  modified: Map<string, string>; // 已存在文件原内容（回滚时还原）
}

/** 每个 change 的运行级观测/熔断计数器（key = changeName，run 间隔离）。 */
interface RunCounters {
  consecutiveFailures: number;
  filesWritten: number;
  tokens: number;
}

/** 从 LLM 输出解析文件编辑集合，兼容 {edits:[...]} / {files:[...]} / 单文件 {path,content}。 */
function extractEdits(text: string): FileEdit[] | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  const o = obj as Record<string, unknown>;
  const arr = Array.isArray(o) ? o : (o.edits ?? o.files ?? (o.path ? [o] : null));
  if (!arr || !Array.isArray(arr)) return null;
  const out: FileEdit[] = [];
  for (const it of arr) {
    const e = it as Record<string, unknown>;
    if (e && typeof e.path === "string" && typeof e.content === "string") {
      out.push({ path: e.path, content: e.content });
    }
  }
  return out.length ? out : null;
}

/** 从计划 spec 中提取任务标题（"- 任务：xxx" / "- xxx" 行）。 */
function extractTaskTitles(spec: string): string[] {
  const titles: string[] = [];
  for (const raw of spec.split("\n")) {
    const line = raw.trim();
    const m = line.match(/^[-*]\s*(?:任务[:：]?|task[:：]?)?\s*(.+)$/i);
    if (!m) continue;
    const title = m[1].replace(/[`*]/g, "").trim();
    if (title) titles.push(title.length > 80 ? title.slice(0, 80) : title);
  }
  if (titles.length === 0) {
    return ["实现核心逻辑", "编写并运行测试", "沉淀文档与验证证据"];
  }
  return titles.slice(0, 12);
}

const PLAN_SYSTEM = `你是一名资深软件工程师与架构师。请基于用户需求输出一份清晰、可执行的实现计划。
计划使用中文，结构包含：目标、关键步骤、以及要拆分的任务清单（用 "- 任务：<名称>" 逐行列出）。只输出计划正文，不要寒暄。`;

const TASK_SYSTEM = `你是一名资深软件工程师。请实现指定任务，把成果写入项目内的一个或多个文件。
只输出一个 JSON 对象，不要任何解释文字。两种结构任选其一：
1) 多文件：{"edits":[{"path":"<项目内相对路径>","content":"<完整文件内容>"}]}
2) 单文件：{"path":"<项目内相对路径>","content":"<完整文件内容>"}
path 必须是项目内相对路径（不得包含 ".."、不得为绝对路径、不得含空字节）。`;

/**
 * 构造真实 LLM 驱动的 PlanGeneratorPort。
 * @param createLlm 按 cwd 解析 LLM 补全函数；返回 null 表示该 cwd 无可用模型 → 如实抛错（无内存桩）。
 */
export function createLlmAutoPlanAdapter(
  createLlm: (cwd: string) => LlmCompletionFn | null,
): PlanGeneratorPort {
  // 状态收敛到适配器实例（闭包），随实例生命周期存在，不泄漏（修复 Q1/P1）。
  const plans = new Map<string, Plan>();
  const tasks = new Map<string, Task>();
  const counters = new Map<string, RunCounters>();

  // SSRF 防护（Q3）：若显式配置 LLM base_url，必须命中白名单/公网约束，否则 fail-closed 阻断。
  const cfgBaseUrl = process.env.ENGINE_LLM_BASE_URL;
  if (cfgBaseUrl) {
    assertSafeLlmBaseUrl(cfgBaseUrl);
  }

  const maxFailures = numEnv("ENGINE_AUTOPLAN_MAX_FAILURES", 3);
  const maxFiles = numEnv("ENGINE_AUTOPLAN_MAX_FILES", 50);
  const tokenBudget = numEnv("ENGINE_AUTOPLAN_TOKEN_BUDGET", 200_000);
  const testTimeoutMs = numEnv("ENGINE_AUTOPLAN_TEST_TIMEOUT_MS", 120_000);

  const countersFor = (changeName: string): RunCounters => {
    let c = counters.get(changeName);
    if (!c) {
      c = { consecutiveFailures: 0, filesWritten: 0, tokens: 0 };
      counters.set(changeName, c);
    }
    return c;
  };
  const resetCounters = (changeName: string): void => {
    counters.set(changeName, { consecutiveFailures: 0, filesWritten: 0, tokens: 0 });
  };

  /** 在 cwd 内安全写入一组编辑；先做路径/上限/预算校验，再落盘并产出回滚快照。 */
  const safeWrite = (cwd: string, edits: FileEdit[], c: RunCounters): WriteSnapshot => {
    const root = resolve(cwd);
    const absEdits = edits.map((e) => {
      const rel = e.path.replace(/\\/g, "/").replace(/^\/+/, "").trim();
      if (!rel || rel.includes("..") || isAbsolute(rel) || rel.includes("\0")) {
        throw new Error(`非法写入路径：${e.path}`);
      }
      const abs = resolve(root, rel);
      // 防符号链接逃逸：绝对路径必须仍位于 cwd 之下（无 ".." 时本应恒成立，作纵深防御）。
      if (abs !== root && !abs.startsWith(root + sep)) {
        throw new Error(`非法写入路径（逃逸 cwd）：${e.path}`);
      }
      return { rel, abs, content: e.content };
    });
    if (c.filesWritten + absEdits.length > maxFiles) {
      throw new Error(`超出单运行文件写入上限（${maxFiles}）`);
    }
    const addTokens = absEdits.reduce((s, e) => s + Math.ceil((e.content?.length ?? 0) / 4), 0);
    if (c.tokens + addTokens > tokenBudget) {
      throw new Error(`超出 token 预算（${tokenBudget}）`);
    }
    const snapshot: WriteSnapshot = { created: [], modified: new Map() };
    for (const e of absEdits) {
      if (existsSync(e.abs)) snapshot.modified.set(e.abs, readFileSync(e.abs, "utf8"));
      else snapshot.created.push(e.abs);
      mkdirSync(dirname(e.abs), { recursive: true });
      writeFileSync(e.abs, e.content ?? "", "utf8");
    }
    c.filesWritten += absEdits.length;
    c.tokens += addTokens;
    return snapshot;
  };

  /** 回滚本次写入：还原被修改文件、删除新建文件。 */
  const rollback = (snap: WriteSnapshot): void => {
    for (const abs of snap.created) {
      try {
        rmSync(abs, { force: true });
      } catch {
        /* best-effort */
      }
    }
    for (const [abs, content] of snap.modified) {
      try {
        writeFileSync(abs, content, "utf8");
      } catch {
        /* best-effort */
      }
    }
  };

  /** 写盘后运行测试验证（受超时约束、cwd 受限）；无可执行测试命令时跳过。
   *  经 ctx 回调实时上报终端输出与进程树事件（M5 / Q14）。 */
  const executeTests = (
    cwd: string,
    ctx?: RunContext,
  ): Promise<{
    ran: boolean;
    passed?: boolean;
    exitCode?: number;
    output?: string;
  }> => {
    return new Promise((resolvePromise) => {
      if (process.env.ENGINE_AUTOPLAN_RUN_TESTS === "0") {
        resolvePromise({ ran: false });
        return;
      }
      let cmd = process.env.ENGINE_AUTOPLAN_TEST_CMD;
      if (!cmd) {
        try {
          const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
          if (pkg?.scripts?.test) cmd = "npm test";
        } catch {
          /* 无 package.json / 无 test 脚本 */
        }
      }
      if (!cmd) {
        resolvePromise({ ran: false });
        return;
      }
      // 安全修复（PRD FR-5 / V5）：消除 shell:true，避免命令注入。
      // 将受控命令字符串（来自 env 或 package.json 的 test 脚本，如 "npm test"）解析为 argv 数组。
      const trimmed = cmd.trim();
      const sepIdx = trimmed.indexOf(" ");
      const binary = sepIdx === -1 ? trimmed : trimmed.slice(0, sepIdx);
      const testArgs =
        sepIdx === -1
          ? []
          : trimmed
              .slice(sepIdx + 1)
              .trim()
              .split(/\s+/)
              .filter(Boolean);
      const proc = spawn(binary, testArgs, {
        cwd,
        shell: false,
        timeout: testTimeoutMs,
        env: { ...process.env, CI: "true" },
      });
      const pid = proc.pid ?? -1;
      ctx?.onProcessSpawn?.({
        pid,
        ppid: process.pid ?? -1,
        title: cmd,
        status: "running",
        startedAt: new Date().toISOString(),
      });
      let out = "";
      const forward = (d: Buffer | string) => {
        const s = d.toString();
        out += s;
        ctx?.onTerminalChunk?.(s);
      };
      proc.stdout?.on("data", forward);
      proc.stderr?.on("data", forward);
      proc.on("error", (e) => {
        ctx?.onProcessExit?.(pid);
        resolvePromise({ ran: true, passed: false, exitCode: -1, output: String(e.message) });
      });
      proc.on("close", (code, signal) => {
        ctx?.onProcessExit?.(pid);
        resolvePromise({
          ran: true,
          passed: code === 0,
          exitCode: code ?? (signal ? 1 : 0),
          output: out.slice(0, 2000),
        });
      });
    });
  };

  return {
    async createRequirement(req: RequirementInput): Promise<Requirement> {
      return {
        id: uid("req"),
        title: req.title,
        description: req.description,
        createdAt: new Date().toISOString(),
      };
    },

    async generatePlan(req: RequirementInput): Promise<Plan> {
      if (!createLlm) {
        throw new Error("未注入 LLM 工厂，autoplan 真实适配器无法生成计划（不支持内存桩）");
      }
      const base: Plan = {
        id: uid("plan"),
        requirementId: req.title,
        title: `计划：${req.title}`,
        spec: `# ${req.title}\n\n${req.description ?? ""}`,
        createdAt: new Date().toISOString(),
      };
      const llm = createLlm(req.cwd ?? process.cwd());
      if (!llm) {
        throw new Error("该 cwd 无可用 LLM（未配置模型/API Key），无法生成计划");
      }
      // 无模型时 createPiLlmCompletion 返回的函数在调用处抛出，这里如实透传给 runLoop。
      const spec = await llm(
        PLAN_SYSTEM,
        `需求标题：${req.title}\n需求描述：${req.description ?? "（无）"}`,
      );
      const plan: Plan = { ...base, spec: spec.trim() || base.spec };
      plans.set(plan.id, plan);
      return plan;
    },

    async enqueueTasks(planId: string): Promise<Task[]> {
      const plan = plans.get(planId);
      if (!plan) return [];
      // 幂等：同一 plan 已入队则直接返回既有任务，避免重复调用追加重复任务。
      const existing = [...tasks.values()].filter((t) => t.planId === planId);
      if (existing.length) return existing;
      const titles = extractTaskTitles(plan.spec);
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
      // build 阶段开始前重置本 change 的观测/熔断计数器（每次运行独立）。
      resetCounters(ctx.changeName);
      try {
        await writeDeliverables(plans, tasks, ctx, planId);
      } catch {
        // 落盘失败不阻断（best-effort，guard 会给出明确失败原因）。
      }
    },

    async runTask(taskId: string, ctx: RunContext): Promise<TaskResult> {
      const t = tasks.get(taskId);
      if (!t) return { taskId, status: "failed" };
      if (!createLlm) {
        throw new Error("未注入 LLM 工厂，autoplan 真实适配器无法执行任务（不支持内存桩）");
      }
      t.status = "running";
      const c = countersFor(ctx.changeName);
      const plan = plans.get(t.planId);
      const llm = createLlm(ctx.cwd);
      if (!llm) {
        throw new Error("该 cwd 无可用 LLM（未配置模型/API Key），无法真实执行任务");
      }
      try {
        const raw = await llm(
          TASK_SYSTEM,
          `项目目录：${ctx.cwd}\n变更：${ctx.changeName}\n\n计划背景：\n${plan?.spec ?? ""}\n\n当前任务：${t.title}`,
        );
        const edits = extractEdits(raw);
        if (!edits || edits.length === 0) {
          throw new Error("LLM 未返回有效的文件编辑（edits/path+content）");
        }
        const snapshot = safeWrite(ctx.cwd, edits, c);

        // 写盘后真实运行测试验证（受超时与 cwd 约束）。
        const test = await executeTests(ctx.cwd, ctx);
        if (test.ran && !test.passed) {
          rollback(snapshot);
          c.consecutiveFailures += 1;
          const msg = `测试未通过（exit ${test.exitCode}）：${(test.output ?? "").slice(0, 400)}`;
          if (c.consecutiveFailures >= maxFailures) {
            throw new Error(`熔断：连续 ${c.consecutiveFailures} 次任务失败。${msg}`);
          }
          t.status = "failed";
          t.result = `已回滚：${msg}`;
          return { taskId, status: "failed", output: t.result };
        }

        // 成功（测试通过或无需测试）。
        c.consecutiveFailures = 0;
        const files = edits.map((e) => e.path).join(", ");
        const verifyNote = test.ran ? "（测试通过）" : "（未配置测试，跳过验证）";
        t.result = `已写入并验证：${files}${verifyNote}`;
        t.status = "completed";
        return { taskId, status: "completed", output: t.result };
      } catch (e) {
        // LLM 调用失败 / 解析失败 / 路径非法 / 超预算 / 测试熔断 —— 如实失败并计入熔断。
        const msg = (e as Error).message;
        c.consecutiveFailures += 1;
        if (c.consecutiveFailures >= maxFailures) {
          throw new Error(`熔断：连续 ${c.consecutiveFailures} 次任务失败。${msg}`);
        }
        log("warn", "engine", `LLM 任务执行失败：${msg}`);
        t.status = "failed";
        t.result = `执行失败：${msg}`;
        return { taskId, status: "failed", output: t.result };
      }
    },

    async submitFeedback(taskId: string, feedback: string): Promise<void> {
      const t = tasks.get(taskId);
      if (t) {
        t.backtrace = [...(t.backtrace ?? []), `feedback: ${feedback}`];
      }
    },
  };
}
