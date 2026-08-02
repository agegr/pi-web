// GET /api/plan/[id]/export → 导出计划讨论快照为 Markdown(?format=md,默认) 或 HTML(?format=html)
// 复用 getOrchestrator(id).getSnapshot() 读取完整讨论数据（messages+plans+rounds 全量保留），
// 由 lib/agent-orchestrator/plan-export.ts 的纯函数序列化。不依赖 pi CLI（计划讨论非 .jsonl）。
// Content-Disposition 走 getAttachmentDisposition（与普通会话导出一致，支持中文文件名）。
import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api-utils";

// 内联极简版（原 @/lib/api-shared.getAttachmentDisposition 已随上游重构删除）：
// 生成 Content-Disposition，支持中文文件名（RFC 5987）。
function getAttachmentDisposition(fileName: string): string {
  const ascii = /^[\x20-\x7e]*$/.test(fileName);
  if (ascii) return `attachment; filename="${fileName}"`;
  const encoded = encodeURIComponent(fileName);
  return `attachment; filename*=UTF-8''${encoded}`;
}

import {
  getOrchestrator,
  setOrchestratorRunnerFactory,
  createRoleAwareRunner,
  resolveLlmForRole,
} from "@/lib/agent-orchestrator";
import { snapshotToMarkdown, snapshotToHtml } from "@/lib/agent-orchestrator/plan-export";
import { loadPlanModelConfig } from "@/lib/plan-mode-config";

export const dynamic = "force-dynamic";

// 注册真实 runner 工厂（幂等），确保刷新时 rehydrate 出的编排器可继续真实讨论。
setOrchestratorRunnerFactory((cwd) =>
  createRoleAwareRunner((role) => resolveLlmForRole(cwd, role, loadPlanModelConfig())),
);

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const format = new URL(req.url).searchParams.get("format") === "html" ? "html" : "md";
    const orch = getOrchestrator(id);
    if (!orch) {
      return NextResponse.json({ error: "编排会话不存在" }, { status: 404 });
    }
    const snap = orch.getSnapshot();
    const content = format === "html" ? snapshotToHtml(snap) : snapshotToMarkdown(snap);
    const fileName = `plan-${id.slice(0, 8)}.${format}`;
    return new Response(content, {
      headers: {
        "Content-Type":
          format === "html" ? "text/html; charset=utf-8" : "text/markdown; charset=utf-8",
        "Content-Disposition": getAttachmentDisposition(fileName),
        "Cache-Control": "no-cache",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
