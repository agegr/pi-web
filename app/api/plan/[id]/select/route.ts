// POST /api/plan/[id]/select  body: { planId } —— 用户选择某推荐方案
import { type NextRequest, NextResponse } from "next/server";
import { validateCsrf } from "@/lib/csrf";
import { errorResponse, safeJsonBody } from "@/lib/api-utils";
import { getOrchestrator } from "@/lib/agent-orchestrator";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const csrf = validateCsrf(req);
  if (csrf) return csrf;
  try {
    const { id } = await params;
    const orch = getOrchestrator(id);
    if (!orch) return NextResponse.json({ error: "编排会话不存在" }, { status: 404 });
    const [body, parseError] = await safeJsonBody<{ planId?: unknown }>(req);
    if (parseError) return parseError;
    const planId = typeof body.planId === "string" ? body.planId : "";
    if (!planId) return NextResponse.json({ error: "planId 必填" }, { status: 400 });
    orch.selectPlan(planId);
    return NextResponse.json({ ok: true, selectedPlanId: planId });
  } catch (error) {
    return errorResponse(error);
  }
}
