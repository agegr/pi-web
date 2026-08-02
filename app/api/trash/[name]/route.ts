import { NextResponse } from "next/server";
import { restoreTrashedSession } from "@/lib/trash";
import { cacheSessionPath, invalidateSessionListCache } from "@/lib/session-reader";

// POST /api/trash/[name] — 恢复回收站中的会话到原 cwd
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  try {
    const { restoredPath, sessionId } = restoreTrashedSession(name);
    // 重建路径缓存并让侧边栏会话列表重新扫描
    cacheSessionPath(sessionId, restoredPath);
    invalidateSessionListCache();
    return NextResponse.json({ ok: true, path: restoredPath });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 400 });
  }
}
