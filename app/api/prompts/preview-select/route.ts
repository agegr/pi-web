import { type NextRequest, NextResponse } from "next/server";
import { validateCsrf } from "@/lib/csrf";
import { errorResponse, safeJsonBody } from "@/lib/api-utils";
import { gatherManagedModules } from "@/lib/prompt-system/catalog";
import { isModuleActive } from "@/lib/prompt-system/switches";
import { selectModulesAdaptive } from "@/lib/prompt-system/select-llm";
import { estimateTokens } from "@/lib/prompt-system/tokenize";

export const dynamic = "force-dynamic";

// POST /api/prompts/preview-select — 预览按任务动态提交将选中的模块
// body: { userInput?: string, context?: string, useLlmSelect?: boolean, cwd?: string }
// → { selected, skipped, tokensBefore, tokensAfter, tokensSaved, usedLlm }
export async function POST(req: NextRequest) {
  const csrfError = validateCsrf(req);
  if (csrfError) return csrfError;

  try {
    const [body, parseError] = await safeJsonBody<{
      userInput?: string;
      context?: string;
      useLlmSelect?: boolean;
      cwd?: string;
    }>(req);
    if (parseError) return parseError;

    const all = gatherManagedModules();
    // 候选 = 通过开关（alwaysOn 恒真 + 持久化开关）的模块
    const candidates = all.filter((m) => isModuleActive(m));

    const { selected, skipped, usedLlm } = await selectModulesAdaptive(candidates, {
      userInput: body.userInput,
      context: body.context,
      useLlmSelect: body.useLlmSelect,
      cwd: body.cwd,
    });

    const tokensBefore = candidates.reduce((s, m) => s + estimateTokens(m.text), 0);
    const tokensAfter = selected.reduce((s, m) => s + estimateTokens(m.text), 0);

    return NextResponse.json({
      selected: selected.map((m) => ({ id: m.id, source: m.source, category: m.category })),
      skipped: skipped.map((m) => ({ id: m.id, source: m.source, category: m.category })),
      tokensBefore,
      tokensAfter,
      tokensSaved: tokensBefore - tokensAfter,
      usedLlm,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
