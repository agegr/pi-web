// GET /api/engine/log → 引擎结构化日志尾部（?scope=engine|orchestrator&limit=N）
// 读磁盘 pi-engine.log，跨重启可追踪历史，便于排错。
import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api-utils";
import { readLogFileTail } from "@/lib/engine-logger";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const limitRaw = Number(searchParams.get("limit"));
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 500;
    const scope = searchParams.get("scope");
    let entries = readLogFileTail(limit);
    if (scope) entries = entries.filter((e) => e.scope === scope);
    return NextResponse.json({ logs: entries });
  } catch (error) {
    return errorResponse(error);
  }
}
