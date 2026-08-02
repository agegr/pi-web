// GET  /api/plan/[id] → 当前编排快照（供前端初次加载 / 轮询）
// DELETE /api/plan/[id] → 清理该 orchestrator 的持久化快照（幂等；不抛错）
import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api-utils";
import { validateCsrf } from "@/lib/csrf";
import {
  getOrchestrator,
  setOrchestratorRunnerFactory,
  createRoleAwareRunner,
  resolveLlmForRole,
} from "@/lib/agent-orchestrator";
import { removeOrchestratorSnapshot } from "@/lib/agent-orchestrator/persistence";
import { loadPlanModelConfig } from "@/lib/plan-mode-config";

export const dynamic = "force-dynamic";

// 注册真实 runner 工厂，确保刷新时 rehydrate 出的编排器可继续真实讨论（幂等）。
setOrchestratorRunnerFactory((cwd) =>
  createRoleAwareRunner((role) => resolveLlmForRole(cwd, role, loadPlanModelConfig())),
);

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const orch = getOrchestrator(id);
    if (!orch) return NextResponse.json({ error: "编排会话不存在" }, { status: 404 });
    return NextResponse.json(orch.getSnapshot());
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * DELETE /api/plan/[id]
 * 清理 orchestrator 的持久化快照（pi-web-orchestrations.jsonl 中匹配 id 的行）。
 * - 幂等：记录不存在时返回 ok=true、removedCount=0
 * - 失败 best-effort：服务端写入异常时返回 ok=false、reason（前端可重试）
 * 调用时机：
 *   - 用户删除侧栏中 plan-mode 入口会话（AppShell.handleSessionDeleted 反向清理）
 *   - 用户在 PlanPanel 中取消 / 终止讨论后立即调用
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const csrf = validateCsrf(_req);
  if (csrf) return csrf;
  try {
    const { id } = await params;
    if (!id || typeof id !== "string") {
      return NextResponse.json(
        { ok: false, planId: id ?? null, reason: "invalid id" },
        { status: 400 },
      );
    }
    const { removedCount, remaining } = removeOrchestratorSnapshot(id);
    return NextResponse.json({ ok: true, planId: id, removedCount, remaining });
  } catch (error) {
    // 上层 fs 失败按 ok=false 返回，不抛 500——让前端可观察、可重试
    return NextResponse.json(
      { ok: false, planId: null, reason: error instanceof Error ? error.message : String(error) },
      { status: 200 },
    );
  }
}
