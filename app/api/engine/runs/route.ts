import { NextResponse } from "next/server";
import { validateCsrf } from "@/lib/csrf";
import { errorResponse, safeJsonBody } from "@/lib/api-utils";
import {
  registerDefaultEngine,
  getUnifiedEngineAdapter,
} from "@/lib/unified-engine/unified-engine-adapter";

// POST /api/engine/runs  body: { runId, action: "start" | "pause" | "resume" }
// 注：列举运行改为统一状态面 GET /api/engine/state（前端经 hooks/useEngineRuntime 订阅），
// 此处不再提供 GET 直读，避免与 engine-runtime-store 形成平行状态面（FR-1）。
export async function POST(req: Request) {
  const csrf = validateCsrf(req);
  if (csrf) return csrf;

  try {
    const [body, parseError] = await safeJsonBody<{ runId?: unknown; action?: unknown }>(req);
    if (parseError) return parseError;
    const runId = typeof body.runId === "string" ? body.runId : "";
    const action = typeof body.action === "string" ? body.action : "";
    if (!runId) return NextResponse.json({ error: "runId 必填" }, { status: 400 });

    registerDefaultEngine();
    const adapter = getUnifiedEngineAdapter();
    let run;
    if (action === "start") {
      const current = await adapter.getRunState(runId);
      if (current.status === "completed" || current.status === "failed") {
        return NextResponse.json({ error: "运行已处于终态，不可重新启动" }, { status: 409 });
      }
      run = await adapter.startRun(runId);
    } else if (action === "pause") {
      await adapter.pauseRun(runId);
      run = await adapter.getRunState(runId);
    } else if (action === "resume") {
      const current = await adapter.getRunState(runId);
      if (current.status === "completed" || current.status === "failed") {
        return NextResponse.json({ error: "运行已处于终态，不可恢复" }, { status: 409 });
      }
      run = await adapter.resumeRun(runId);
    } else
      return NextResponse.json(
        { error: "未知 action（应为 start/pause/resume）" },
        { status: 400 },
      );

    return NextResponse.json(run);
  } catch (error) {
    return errorResponse(error);
  }
}
