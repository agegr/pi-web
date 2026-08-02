// GET /api/engine/history → 自主引擎历史运行列表（含磁盘 rehydrate，防空闲丢失）
import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api-utils";
import { getEngineRuntimeInstance } from "@/lib/unified-engine/unified-engine-adapter";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const runs = getEngineRuntimeInstance().listRuns();
    return NextResponse.json({ runs });
  } catch (error) {
    return errorResponse(error);
  }
}
