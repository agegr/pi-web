// GET /api/plan/history → 已持久化的计划编排列表（按 updatedAt 倒序，轻量摘要）
// 用于面板「运行历史」视图：刷新/重启后仍可恢复此前讨论。
import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api-utils";
import { loadAllOrchestratorSnapshots } from "@/lib/agent-orchestrator/persistence";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const stored = loadAllOrchestratorSnapshots();
    const items = stored
      .map((rec) => {
        const s = rec.snapshot as {
          id: string;
          status?: string;
          requirement?: string;
          updatedAt?: number;
          rounds?: unknown[];
          plans?: unknown[];
          control?: { tokensSavedEstimate?: number };
        };
        return {
          id: s.id,
          status: s.status ?? "unknown",
          requirement: s.requirement ?? "",
          updatedAt: s.updatedAt ?? rec.updatedAt,
          roundCount: Array.isArray(s.rounds) ? s.rounds.length : 0,
          planCount: Array.isArray(s.plans) ? s.plans.length : 0,
          tokensSavedEstimate: s.control?.tokensSavedEstimate ?? 0,
        };
      })
      .sort((a, b) => b.updatedAt - a.updatedAt);
    return NextResponse.json({ orchestrations: items });
  } catch (error) {
    return errorResponse(error);
  }
}
