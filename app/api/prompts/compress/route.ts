import { type NextRequest, NextResponse } from "next/server";
import { validateCsrf } from "@/lib/csrf";
import { errorResponse, safeJsonBody } from "@/lib/api-utils";
import { findManagedModule } from "@/lib/prompt-system/catalog";
import { setCompressedOverride } from "@/lib/prompt-modules-state";
import { compressModule } from "@/lib/prompt-system/compress-llm";

export const dynamic = "force-dynamic";

// POST /api/prompts/compress — 压缩单个模块
// body: { id: string, useLlm?: boolean, cwd?: string }
// → { id, text, ratio, usedLlm }
export async function POST(req: NextRequest) {
  const csrfError = validateCsrf(req);
  if (csrfError) return csrfError;

  try {
    const [body, parseError] = await safeJsonBody<{
      id?: string;
      useLlm?: boolean;
      cwd?: string;
    }>(req);
    if (parseError) return parseError;
    const id = body.id;
    if (!id) return errorResponse("Missing module id", 400);

    const mod = findManagedModule(id);
    if (!mod) return errorResponse(`Unknown module: ${id}`, 404);

    // 基于原文压缩；useLlm 时走 LLM 精炼，失败兜底离线。
    const result = await compressModule(mod.text, { useLlm: body.useLlm, cwd: body.cwd });
    // 持久化压缩覆盖，compose 将优先使用。
    setCompressedOverride(id, result.text);

    return NextResponse.json({
      id,
      text: result.text,
      ratio: result.ratio,
      charsBefore: result.charsBefore,
      charsAfter: result.charsAfter,
      usedLlm: result.usedLlm,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
