// POST /api/plan/orchestrate
// 创建并启动一次多 Agent 协同讨论。body: { requirement, cwd?, config?, mock? }
// → { id, status }
import { type NextRequest, NextResponse } from "next/server";
import { validateCsrf } from "@/lib/csrf";
import { errorResponse, safeJsonBody } from "@/lib/api-utils";
import {
  createRoleAwareRunner,
  createMockRunner,
  createOrchestrator,
  createPiLlmCompletion,
  resolveLlmForRole,
  setOrchestratorRunnerFactory,
  type OrchestratorConfig,
} from "@/lib/agent-orchestrator";
import { loadPlanModelConfig } from "@/lib/plan-mode-config";

export const dynamic = "force-dynamic";

// 注册「真实角色感知 runner 工厂」，使 rehydrate 出的编排器可继续真实讨论（幂等）。
setOrchestratorRunnerFactory((cwd) =>
  createRoleAwareRunner((role) => resolveLlmForRole(cwd, role, loadPlanModelConfig())),
);

export async function POST(req: NextRequest) {
  const csrf = validateCsrf(req);
  if (csrf) return csrf;

  try {
    const [body, parseError] = await safeJsonBody<{
      requirement?: unknown;
      cwd?: unknown;
      config?: Partial<OrchestratorConfig>;
      mock?: unknown;
    }>(req);
    if (parseError) return parseError;
    const requirement = typeof body.requirement === "string" ? body.requirement.trim() : "";
    if (!requirement) {
      return NextResponse.json({ error: "需求内容为空" }, { status: 400 });
    }
    const cwd = typeof body.cwd === "string" ? body.cwd.trim() : undefined;
    const useMock = body.mock === true;

    const runner = useMock
      ? createMockRunner({ planCount: body.config?.planCount ?? 2 })
      : createRoleAwareRunner((role) => resolveLlmForRole(cwd, role, loadPlanModelConfig()));

    const orch = createOrchestrator({
      requirement,
      cwd,
      config: body.config,
      runner,
      // 混合/llm 模式下，总控用默认模型做一次轻量裁定（失败兜底为确定性调度）。
      controllerLlm: useMock ? undefined : createPiLlmCompletion(cwd),
    });
    orch.start();

    return NextResponse.json({ id: orch.id, status: orch.status });
  } catch (error) {
    return errorResponse(error);
  }
}
