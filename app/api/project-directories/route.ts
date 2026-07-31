import { NextResponse } from "next/server";
import { allowFileRoot } from "@/lib/file-access";
import {
  addProjectDirectory,
  normalizeProjectDirectory,
  readProjectDirectories,
  removeProjectDirectory,
} from "@/lib/project-directories";

export const dynamic = "force-dynamic";

export async function GET() {
  const projects = readProjectDirectories();
  projects.forEach(allowFileRoot);
  return NextResponse.json({ projects });
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { cwd?: unknown };
    const cwd = normalizeProjectDirectory(body.cwd);
    allowFileRoot(cwd);
    return NextResponse.json({ projects: addProjectDirectory(cwd), cwd });
  } catch (error) {
    console.error("保存 Pi Web 项目目录失败", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json() as { cwd?: unknown };
    if (typeof body.cwd !== "string" || !body.cwd.trim()) {
      return NextResponse.json({ error: "cwd required" }, { status: 400 });
    }
    return NextResponse.json({ projects: removeProjectDirectory(body.cwd.trim()) });
  } catch (error) {
    console.error("移除 Pi Web 项目目录失败", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
