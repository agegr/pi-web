import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { resolve, relative } from "path";
import { existsSync } from "fs";
import { sanitizeFilename } from "@/lib/sanitize-filename";

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
      return NextResponse.json({ error: "File too large. Maximum is 50MB." }, { status: 413 });
    }

    // Sanitize filename
    const safeName = sanitizeFilename(file.name);
    if (!safeName) {
      return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
    }

    // Resolve save directory: use session cwd if provided, else fall back to server cwd
    const sessionCwd = formData.get("cwd") as string | null;
    const root = sessionCwd ? resolve(sessionCwd) : process.cwd();

    // Ensure uploads directory exists
    const uploadDir = resolve(root, ".uploads");
    await mkdir(uploadDir, { recursive: true });

    // Resolve target path and check path traversal
    let targetPath = resolve(uploadDir, safeName);
    const rel = relative(uploadDir, targetPath);
    if (rel.startsWith("..")) {
      return NextResponse.json({ error: "Invalid path" }, { status: 400 });
    }

    // Handle name collision: append UUID suffix
    if (existsSync(targetPath)) {
      const extIdx = safeName.lastIndexOf(".");
      if (extIdx > 0) {
        const base = safeName.substring(0, extIdx);
        const ext = safeName.substring(extIdx);
        targetPath = resolve(uploadDir, `${base}-${randomUUID().slice(0, 8)}${ext}`);
      } else {
        targetPath = resolve(uploadDir, `${safeName}-${randomUUID().slice(0, 8)}`);
      }
    }

    // Write file
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(targetPath, buffer);

    // Return path relative to root (includes .uploads/ prefix)
    const relativePath = relative(root, targetPath).replace(/\\/g, "/");
    return NextResponse.json({ path: relativePath });
  } catch (error) {
    console.error("Upload failed:", error);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
