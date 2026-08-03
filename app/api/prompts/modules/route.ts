import { type NextRequest, NextResponse } from "next/server";
import { validateCsrf } from "@/lib/csrf";
import { errorResponse, safeJsonBody } from "@/lib/api-utils";
import { gatherManagedModules, findManagedModule } from "@/lib/prompt-system/catalog";
import {
  getModuleEnabled,
  setModuleEnabled,
  getCompressedOverride,
  setCompressedOverride,
  getAgentsMdModular,
  setAgentsMdModular,
} from "@/lib/prompt-modules-state";
import { effectiveText } from "@/lib/prompt-system/switches";
import { estimateTokens } from "@/lib/prompt-system/tokenize";
// 副作用 import：触发 enhance 模块注册（registerModules），使 app 模块在 gather 时可见。
import "@/lib/prompt-system/enhance-modules";

export const dynamic = "force-dynamic";

// GET /api/prompts/modules → 列出全部可管理模块 + 开关/压缩态 + Token 概览
export async function GET(req: NextRequest) {
  try {
    const cwd = req.nextUrl.searchParams.get("cwd") ?? undefined;
    const modules = gatherManagedModules(cwd);
    const list = modules.map((m) => ({
      id: m.id,
      source: m.source,
      category: m.category,
      tags: m.tags,
      heading: m.heading,
      alwaysOn: Boolean(m.alwaysOn),
      enabled: getModuleEnabled(m.id, true),
      text: m.text,
      compressedText: effectiveText(m) !== m.text ? effectiveText(m) : undefined,
      estimatedTokens: estimateTokens(m.text),
    }));
    const totalTokens = modules.reduce((s, m) => s + estimateTokens(m.text), 0);
    const enabledTokens = modules
      .filter((m) => m.alwaysOn || getModuleEnabled(m.id, true))
      .reduce((s, m) => s + estimateTokens(m.text), 0);
    return NextResponse.json({
      modules: list,
      summary: {
        count: list.length,
        totalTokens,
        enabledTokens,
        savedTokens: totalTokens - enabledTokens,
      },
      agentsMdModular: getAgentsMdModular(),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

// PUT /api/prompts/modules — 切换模块启用 或 写入压缩覆盖
// body: { id: string, enabled?: boolean } | { id: string, compressedOverride?: string|null }
export async function PUT(req: NextRequest) {
  const csrfError = validateCsrf(req);
  if (csrfError) return csrfError;

  try {
    const [body, parseError] = await safeJsonBody<{
      id?: string;
      enabled?: boolean;
      compressedOverride?: string | null;
      agentsMdModular?: boolean;
      cwd?: string;
    }>(req);
    if (parseError) return parseError;

    // 总闸：开启后 coding-agent 系统提示词按模块动态裁剪（全局开关，不需要 id）。
    if (typeof body.agentsMdModular === "boolean") {
      setAgentsMdModular(body.agentsMdModular);
      return NextResponse.json({ ok: true, agentsMdModular: getAgentsMdModular() });
    }

    const id = body.id;
    if (!id) return errorResponse("Missing module id", 400);

    // 校验模块存在（避免对任意 id 写状态）
    const mod = findManagedModule(id, body.cwd);
    if (!mod) return errorResponse(`Unknown module: ${id}`, 404);

    if (typeof body.enabled === "boolean") {
      setModuleEnabled(id, body.enabled);
    } else if ("compressedOverride" in body) {
      setCompressedOverride(id, body.compressedOverride ?? undefined);
    } else {
      return errorResponse("Provide 'enabled' or 'compressedOverride'", 400);
    }

    return NextResponse.json({
      ok: true,
      enabled: getModuleEnabled(id, true),
      compressedOverride: getCompressedOverride(id),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
