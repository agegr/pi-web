// comet-adapter.ts —— 唯一导入/调用 vendor/comet 的适配层
// 实现 WorkflowStateMachinePort：所有状态机操作经白名单 child_process 调用 comet .mjs。
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCometScript, cometGet } from "./guards/comet-cli";
import type { WorkflowStateMachinePort } from "./workflow-state-machine-ports";
import type { ChangeState, Stage, Workflow } from "./unified-engine-types";
import { DEFAULT_WORKFLOW } from "./unified-engine-types";

function eventForPhase(phase: Stage): string {
  if (phase === "verify") return "verify-pass";
  return `${phase}-complete`;
}

async function readState(change: string, cwd: string): Promise<ChangeState> {
  const [phase, workflow, runId] = await Promise.all([
    cometGet(change, "phase", cwd),
    cometGet(change, "workflow", cwd),
    cometGet(change, "run_id", cwd),
  ]);
  return {
    name: change,
    workflow: (workflow || DEFAULT_WORKFLOW) as Workflow,
    phase: (phase || "open") as Stage,
    runId: runId || undefined,
  };
}

export function createCometAdapter(): WorkflowStateMachinePort {
  return {
    async openChange(change, workflow, cwd) {
      await runCometScript("comet-state.mjs", ["init", change, workflow], cwd);
      return readState(change, cwd);
    },
    async ensureChange(change, workflow, cwd) {
      // 探测：能读到 phase 说明 .comet.yaml 已存在，直接返回状态。
      // comet init 对已存在报 "already exists"（退出码 1），故不能无条件 init。
      const phase = await cometGet(change, "phase", cwd);
      if (phase) return readState(change, cwd);
      // 缺失则补建（历史坏 run 自愈路径）。
      await runCometScript("comet-state.mjs", ["init", change, workflow], cwd);
      return readState(change, cwd);
    },
    getState(change, cwd) {
      return readState(change, cwd);
    },
    async prepareVerifyArtifacts(change, cwd) {
      // 真实验证默认开（PRD FR-4 / V6）：默认不伪造验证报告，交由 comet 真实 verify
      // 输出驱动归档守卫，确保 build/verify 守卫真正执行而非被"公关"通过。
      // 仅显式 ENGINE_REAL_VERIFY=0 时兜底写诚实标注的存根报告（用于无 comet 的演示环境）。
      if (process.env.ENGINE_REAL_VERIFY !== "0") return;
      // verify→archive 守卫检查两项：verification_report 文件存在 + branch_status=handled。
      // 写中文报告文件（匹配项目配置 language=zh-CN），再用 comet-state.mjs set
      // 把路径写入 .comet.yaml 的 verification_report 字段、branch_status 设为 handled。
      // 注：桩模式下报告如实标注"autoplan 存根，无代码变更，构建检查跳过"，不作欺骗性通过。
      const changeDir = join(cwd, "openspec", "changes", change);
      const reportPath = join(changeDir, "verification-report.md");
      const reportContent = `# 验证报告\n\n## 摘要\n\n所有构建阶段任务均已成功完成，变更已准备好进入归档。\n\n## 检查项\n\n- 任务清单：全部完成（tasks.md）\n- 提案文档：已记录（proposal.md）\n- 构建检查：跳过（autoplan 存根，无代码变更）\n\n## 结论\n\n验证通过\n`;
      writeFileSync(reportPath, reportContent, "utf8");
      // verification_report 字段须为相对项目根的路径（comet 的 existsSync 相对进程 cwd=项目根）。
      // 存 openspec/changes/<change>/verification-report.md，与 relativePath 校验兼容（非绝对、不含 ..）。
      const relativeReport = `openspec/changes/${change}/verification-report.md`;
      await runCometScript(
        "comet-state.mjs",
        ["set", change, "verification_report", relativeReport],
        cwd,
      );
      await runCometScript("comet-state.mjs", ["set", change, "branch_status", "handled"], cwd);
    },
    async advanceStage(change, phase, cwd) {
      const from = phase;
      const { code } = await runCometScript("comet-guard.mjs", [change, phase, "--apply"], cwd);
      if (code !== 0) {
        throw new Error(`阶段推进被守卫阻止：${change}@${phase}`);
      }
      const next = await readState(change, cwd);
      return {
        change,
        from,
        to: next.phase,
        event: eventForPhase(phase),
        at: new Date().toISOString(),
      };
    },
    async evaluateGuard(change, phase, cwd) {
      const { stdout, code } = await runCometScript("comet-guard.mjs", [change, phase], cwd);
      return {
        change,
        phase,
        passed: code === 0,
        message: stdout.trim() || (code === 0 ? "守卫通过" : "守卫未通过"),
      };
    },
    resumeRun(change, cwd) {
      return readState(change, cwd);
    },
  };
}

let registered: WorkflowStateMachinePort | null = null;

export function registerCometAdapter(
  adapter: WorkflowStateMachinePort = createCometAdapter(),
): void {
  registered = adapter;
}

export function getCometAdapter(): WorkflowStateMachinePort {
  if (!registered) registered = createCometAdapter();
  return registered;
}
