import { NextRequest, NextResponse } from "next/server";
import { stat } from "fs/promises";
import {
  createChildDirectory,
  getBrowseStartDirectory,
  getParentDirectory,
  listDirectories,
  listWindowsDrives,
  resolveDirectory,
  shouldShowWindowsDrivePicker,
} from "@/lib/directory-browser";
import { allowFileRoot } from "@/lib/file-access";

// GET /api/cwd/browse?path=...：列出文件系统中的可读子目录。
export async function GET(request: NextRequest) {
  try {
    const requested = request.nextUrl.searchParams.get("path")?.trim();

    if (shouldShowWindowsDrivePicker(requested)) {
      return NextResponse.json({
        path: "",
        parentPath: null,
        drives: await listWindowsDrives(),
        directories: [],
      });
    }

    const candidate = getBrowseStartDirectory(requested);

    let resolved: string;
    try {
      resolved = await resolveDirectory(candidate);
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

// POST /api/cwd/browse：在当前目录中创建一个直接子目录。
export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { parentPath?: unknown; name?: unknown };
    if (typeof body.parentPath !== "string" || typeof body.name !== "string") {
      return NextResponse.json({ error: "Parent path and folder name are required" }, { status: 400 });
    }

    const createdPath = await createChildDirectory(body.parentPath, body.name);
    allowFileRoot(createdPath);
    return NextResponse.json({ path: createdPath }, { status: 201 });
  } catch (error) {
    if (error instanceof TypeError || error instanceof SyntaxError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      return NextResponse.json({ error: "A folder with this name already exists" }, { status: 409 });
    }
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json({ error: "Parent directory does not exist" }, { status: 404 });
    }
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
