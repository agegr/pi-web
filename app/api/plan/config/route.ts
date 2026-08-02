// GET/PUT /api/plan/config
// 读取 / 保存计划模式的「角色 → 底层模型」映射。模型下拉选项复用 /api/models。
import { type NextRequest, NextResponse } from "next/server";
import { validateCsrf } from "@/lib/csrf";
import { errorResponse, safeJsonBody } from "@/lib/api-utils";
import {
  loadPlanModelConfig,
  savePlanModelConfig,
  type RoleModelMap,
} from "@/lib/plan-mode-config";

export const dynamic = "force-dynamic";

/** 读取当前角色→模型映射。 */
export async function GET() {
  try {
    return NextResponse.json({ map: loadPlanModelConfig() });
  } catch (error) {
    return errorResponse(error);
  }
}

/** 保存角色→模型映射（整体覆盖）。body: { map: Record<roleId, modelId> } */
export async function PUT(req: NextRequest) {
  const csrf = validateCsrf(req);
  if (csrf) return csrf;

  try {
    const [body, parseError] = await safeJsonBody<{ map?: unknown }>(req);
    if (parseError) return parseError;
    if (!body || typeof body.map !== "object" || body.map === null) {
      return NextResponse.json({ error: "map 字段缺失或类型错误" }, { status: 400 });
    }
    const raw = body.map as Record<string, unknown>;
    const map: RoleModelMap = {};
    for (const [k, v] of Object.entries(raw)) {
      if (typeof k === "string" && typeof v === "string" && v.trim().length > 0) {
        map[k] = v.trim();
      }
    }
    savePlanModelConfig(map);
    return NextResponse.json({ map });
  } catch (error) {
    return errorResponse(error);
  }
}
