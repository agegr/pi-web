// POST /api/plan/[id]/confirm  body: { planId?, mode? }
// 交互确认闭环的「确认」出口。用户在 PlanPanel 二选一：
//   - mode: "engine"（默认，向后兼容）→ 落盘方案 + 创建自主编程变更 + 启动运行 + 跳转引擎
//   - mode: "plan"（普通模式）         → 仅落盘方案文档，不创建引擎变更、不启动引擎
// 无论哪种模式，方案都会完整保存到 docs/plans/<task-slug>.md（lib/plan-doc-store）。
import { type NextRequest, NextResponse } from "next/server";
import { validateCsrf } from "@/lib/csrf";
import { errorResponse, safeJsonBody } from "@/lib/api-utils";
import { getOrchestrator } from "@/lib/agent-orchestrator";
import {
  registerDefaultEngine,
  getUnifiedEngineAdapter,
} from "@/lib/unified-engine/unified-engine-adapter";
import { savePlanDoc, type PlanDocMode } from "@/lib/plan-doc-store";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const csrf = validateCsrf(req);
  if (csrf) return csrf;
  try {
    const { id } = await params;
    const orch = getOrchestrator(id);
    if (!orch) return NextResponse.json({ error: "编排会话不存在" }, { status: 404 });

    const [body, parseError] = await safeJsonBody<{
      planId?: unknown;
      mode?: unknown;
    }>(req);
    if (parseError) return parseError;
    const planId = typeof body.planId === "string" ? body.planId : undefined;
    // mode 缺省为 "engine"，保持对旧调用方的向后兼容。
    const mode: PlanDocMode = body.mode === "plan" ? "plan" : "engine";

    // prepareTasks 会校验选中方案是否存在并拆解任务；同时确认 selectedPlanId。
    const payload = orch.prepareTasks(planId);
    if (!payload.cwd) {
      return NextResponse.json(
        { error: "缺少项目目录（cwd），无法创建自主编程变更" },
        { status: 400 },
      );
    }

    // 从快照取结构化方案数据用于落盘（payload 已拍平为 markdown 描述）。
    const snap = orch.getSnapshot();
    const selectedPlan = snap.plans.find((p) => p.id === snap.selectedPlanId) ?? snap.plans[0];

    // 落盘方案文档（best-effort：失败不阻断确认主流程，仅不产出文件）。
    let docPath: string | null = null;
    if (selectedPlan) {
      try {
        const saved = savePlanDoc({
          cwd: payload.cwd,
          requirement: snap.requirement,
          plan: selectedPlan,
          tasks: snap.tasks,
          mode,
          orchestratorId: id,
        });
        docPath = saved.path;
      } catch {
        // 落盘失败继续，引擎模式仍可启动。
      }
    }

    if (mode === "plan") {
      // 普通模式：仅产出方案文档，不创建引擎变更、不启动引擎。
      orch.markDone();
      return NextResponse.json({ ok: true, mode: "plan", docPath });
    }

    // 引擎模式：创建变更并启动自主编程循环。
    registerDefaultEngine();
    const adapter = getUnifiedEngineAdapter();
    const run = await adapter.createChange({
      title: payload.title,
      description: payload.description,
      cwd: payload.cwd,
    });
    const started = await adapter.startRun(run.runId);
    orch.markDone();

    return NextResponse.json({
      ok: true,
      mode: "engine",
      runId: started.runId,
      changeName: started.changeName,
      status: started.status,
      docPath,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
