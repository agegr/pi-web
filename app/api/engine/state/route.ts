import {
  registerDefaultEngine,
  getEngineRuntimeInstance,
} from "@/lib/unified-engine/unified-engine-adapter";
import { getEngineRuntimeStore } from "@/lib/engine-runtime-store";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// GET /api/engine/state —— 统一引擎监控状态快照（双引擎合并后的唯一状态表面）
// 前端经 hooks/useEngineRuntime 订阅 SSE 触发拉取，或 REST 直取。
export async function GET() {
  registerDefaultEngine();
  getEngineRuntimeInstance(); // 触发引擎单例就绪（首次调用会发布初始快照）
  return NextResponse.json(getEngineRuntimeStore().getSnapshot());
}
