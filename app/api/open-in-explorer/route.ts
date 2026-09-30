import { stat } from "fs/promises";
import { resolve } from "path";
import { NextResponse } from "next/server";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { isFileManagerSupported, isLoopbackHost, launchFileManager } from "@/lib/open-in-file-manager";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 当前请求是否可以在服务端拉起文件管理器。 */
function availabilityFor(request: Request): { supported: boolean; reason: string | null } {
  if (!isLoopbackHost(request.headers.get("host"))) return { supported: false, reason: "remote" };
  if (!isFileManagerSupported(process.platform)) return { supported: false, reason: "unsupported-platform" };
  return { supported: true, reason: null };
}

/** 供前端选择按钮文案并在不支持时禁用。 */
export async function GET(request: Request) {
  const { supported, reason } = availabilityFor(request);
  return NextResponse.json({ supported, reason, platform: process.platform });
}

/** 在系统文件管理器中打开会话工作目录。 */
export async function POST(request: Request) {
  try {
    const { supported, reason } = availabilityFor(request);
    if (!supported) {
      return NextResponse.json({ error: reason }, { status: 403 });
    }

    const body = await request.json() as { cwd?: unknown };
    if (typeof body.cwd !== "string" || !body.cwd.trim()) {
      return NextResponse.json({ error: "cwd-required" }, { status: 400 });
    }
    const target = resolve(body.cwd);
    if (!(await stat(target)).isDirectory()) {
      return NextResponse.json({ error: "not-a-directory" }, { status: 400 });
    }
    const roots = await getAllowedFileRoots();
    if (!isExistingFilePathAllowed(target, roots)) {
      return NextResponse.json({ error: "access-denied" }, { status: 403 });
    }

    await launchFileManager(target);
    return NextResponse.json({ opened: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
