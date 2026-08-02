// POST /api/plan/[id]/rediscuss  body: { feedback }
// 交互确认闭环的「退回」出口：注入用户修改意见，重新讨论直至新共识。
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
    const [body, parseError] = await safeJsonBody<{ feedback?: unknown }>(req);
    if (parseError) return parseError;
    const feedback = typeof body.feedback === "string" ? body.feedback.trim() : "";
    if (!feedback) return NextResponse.json({ error: "缺少修改意见（feedback）" }, { status: 400 });

    orch.rediscuss(feedback); // 异步重跑，事件经 SSE 推送
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
