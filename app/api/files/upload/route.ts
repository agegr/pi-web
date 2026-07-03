import { NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { resolve, relative, normalize } from "path";
import { existsSync } from "fs";
import { getAllowedFileRoots, isFilePathAllowed } from "@/lib/file-access";

export const runtime = "nodejs";

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // Size check
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File too large (${file.size} bytes). Maximum is 50MB.` },
        { status: 413 }
      );
    }

    // Sanitize filename: strip path separators, keep only basename
    const rawName = file.name.replace(/[/\\]/g, "_");
    if (!rawName) {
      return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
    }

    // Resolve save directory: first allowed root (typically cwd)
    const allowedRoots = await getAllowedFileRoots();
    const roots = Array.from(allowedRoots);
    if (roots.length === 0) {
      return NextResponse.json({ error: "No allowed file roots configured" }, { status: 500 });
    }
    const root = roots[0];

    // Ensure uploads directory exists
    const uploadDir = resolve(root, ".uploads");
    await mkdir(uploadDir, { recursive: true });

    // Resolve target path and check path traversal
    let targetPath = resolve(uploadDir, rawName);
    if (!targetPath.startsWith(uploadDir)) {
      return NextResponse.json({ error: "Invalid path" }, { status: 400 });
    }

    // Handle name collision: append timestamp
    if (existsSync(targetPath)) {
      const extIdx = rawName.lastIndexOf(".");
      if (extIdx > 0) {
        const base = rawName.substring(0, extIdx);
        const ext = rawName.substring(extIdx);
        targetPath = resolve(uploadDir, `${base}-${Date.now()}${ext}`);
      } else {
        targetPath = resolve(uploadDir, `${rawName}-${Date.now()}`);
      }
    }

    // Write file
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(targetPath, buffer);

    // Return relative path from root
    const relativePath = relative(root, targetPath);
    return NextResponse.json({ path: normalize(relativePath).replace(/\\/g, "/") });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
