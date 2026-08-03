import { NextResponse } from "next/server";
import { isCometAvailable } from "@/lib/unified-engine/guards/comet-cli";

export const dynamic = "force-dynamic";

// GET /api/engine/available → { available: boolean }
// comet 运行时探测：面板列（WorkspacePanelsHost）挂载时异步调用，
// 决定是否展示 Engine tab（comet 缺失时不注册，避免点进去才报错）。
// 探测逻辑复用 guards/comet-cli 的 isCometAvailable（existsSync 白名单守卫脚本）。
export async function GET() {
  return NextResponse.json({ available: isCometAvailable() });
}
