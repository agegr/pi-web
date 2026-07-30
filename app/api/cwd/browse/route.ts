import { NextRequest, NextResponse } from "next/server";
import { homedir } from "os";
import { stat } from "fs/promises";
import {
  getParentDirectory,
  listDirectories,
  listDrives,
  resolveDirectory,
} from "@/lib/directory-browser";

// GET /api/cwd/browse?path=...：列出文件系统中的可读子目录。
// 不带 path 时返回磁盘列表（Windows 盘符）+ 主目录快捷入口，
// 作为目录选择器的起始「选择磁盘」视图。
export async function GET(request: NextRequest) {
  try {
    const requested = request.nextUrl.searchParams.get("path")?.trim();

    if (!requested) {
      // 磁盘选择起始视图：列出可用磁盘 + 主目录快捷入口。
      const drives = await listDrives();
      return NextResponse.json({
        path: "",
        parentPath: null,
        home: homedir(),
        drives,
        directories: [],
      });
    }

    let resolved: string;
    try {
      resolved = await resolveDirectory(requested);
    } catch {
      return NextResponse.json({ error: "Directory does not exist" }, { status: 404 });
    }


    const directoryStat = await stat(resolved);
    if (!directoryStat.isDirectory()) {
      return NextResponse.json({ error: "Path is not a directory" }, { status: 400 });
    }

    const directories = await listDirectories(resolved);

    return NextResponse.json({
      path: resolved,
      parentPath: getParentDirectory(resolved),
      directories,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
