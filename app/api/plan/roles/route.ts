// GET /api/plan/roles → 角色库列表（id / 名称 / 默认模型），供 PlanPanel 配置每角色底层模型下拉。
import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api-utils";
import { ROLE_LIBRARY } from "@/lib/agent-orchestrator/role-library";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const roles = ROLE_LIBRARY.map((r) => ({
      id: r.id,
      name: r.name,
      modelId: r.modelId ?? null,
    }));
    return NextResponse.json({ roles });
  } catch (error) {
    return errorResponse(error);
  }
}
