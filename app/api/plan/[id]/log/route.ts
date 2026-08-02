// GET /api/plan/[id]/log → 该编排器的结构化日志尾部（?limit=N）
// 复用统一引擎日志文件（scope=orchestrator），按 orchestratorId 过滤，跨重启可追踪。
import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api-utils";
import { readLogFileTail } from "@/lib/engine-logger";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const limit = Number(searchParams.get("limit") ?? "300");
    const n = Number.isFinite(limit) && limit > 0 ? limit : 300;
    const entries = readLogFileTail(1000)
      .filter((e) => (e.meta as Record<string, unknown> | undefined)?.orchestratorId === id)
      .slice(-n);
    return NextResponse.json({ logs: entries });
  } catch (error) {
    return errorResponse(error);
  }
}
