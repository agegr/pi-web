import { NextResponse } from "next/server";
import { listAllSessions, invalidateSessionListCache } from "@/lib/session-reader";
import { getRunningRpcSessionIds } from "@/lib/rpc-manager";

export async function GET() {
  try {
    const runningSessionIds = getRunningRpcSessionIds();
    let sessions = await listAllSessions();

    // 兜底：正在运行的会话不在列表里，说明其 .jsonl 文件刚落盘而列表缓存
    // 还是旧的（SSE 断线等场景可能漏掉 events 路由里的失效）。失效后重扫一次。
    const missingRunning = runningSessionIds.filter((id) => !sessions.some((s) => s.id === id));
    if (missingRunning.length > 0) {
      invalidateSessionListCache();
      sessions = await listAllSessions();
    }

    return NextResponse.json({ sessions, runningSessionIds });
  } catch (error) {
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
