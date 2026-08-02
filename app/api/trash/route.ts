import { NextResponse } from "next/server";
import { clearTrashedSessions, listTrashedSessions, purgeTrashedSession } from "@/lib/trash";

// GET /api/trash — 列出回收站中的会话（按最后更新时间倒序）
export async function GET() {
  return NextResponse.json({ sessions: listTrashedSessions() });
}

// DELETE /api/trash?name=<fileName> — 从回收站彻底删除单个会话
// DELETE /api/trash — 清空回收站中的全部会话
export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const name = searchParams.get("name");
  // 只有未传 name 参数才清空；空字符串走单删分支，由 assertTrashFileName 拒绝
  if (name !== null) {
    try {
      purgeTrashedSession(name);
      return NextResponse.json({ ok: true });
    } catch (error) {
      return NextResponse.json({ error: String(error) }, { status: 400 });
    }
  }
  return NextResponse.json({ ok: true, removed: clearTrashedSessions() });
}
