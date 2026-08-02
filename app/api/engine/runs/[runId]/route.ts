import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api-utils";
import {
  registerDefaultEngine,
  getUnifiedEngineAdapter,
} from "@/lib/unified-engine/unified-engine-adapter";

// GET /api/engine/runs/[runId] —— 读取运行全状态
export async function GET(_req: Request, ctx: { params: Promise<{ runId: string }> }) {
  try {
    const { runId } = await ctx.params;
    registerDefaultEngine();
    const run = getUnifiedEngineAdapter().getRunState(runId);
    return NextResponse.json(run);
  } catch (error) {
    return errorResponse(error);
  }
}
