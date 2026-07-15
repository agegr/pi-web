import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { resolve, relative } from "path";
import { existsSync } from "fs";

export const runtime = "nodejs";

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

// Windows reserved filenames (case-insensitive)
const RESERVED_NAMES = new Set([
  "con", "prn", "aux", "nul",
  "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
  "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
]);

function sanitizeFilename(name: string): string | null {
  // Strip path separators
  let sanitized = name.replace(/[/\\]/g, "_");

  // Remove null bytes and control characters
  sanitized = sanitized.replace(/[\x00-\x1f]/g, "");

  if (!sanitized) return null;

  // Reject dot-only names (., ..)
  if (/^\.+$/.test(sanitized)) return null;

  // Reject Windows reserved names (check without extension)
  const nameWithoutExt = sanitized.includes(".") ? sanitized.split(".")[0] : sanitized;
  if (RESERVED_NAMES.has(nameWithoutExt.toLowerCase())) return null;

  // Limit filename length (255 bytes is common max)
  const encoder = new TextEncoder();
  if (encoder.encode(sanitized).length > 255) {
    // Truncate to 255 bytes, preserving extension
    const extIdx = sanitized.lastIndexOf(".");
    if (extIdx > 0) {
      const base = sanitized.substring(0, extIdx);
      const ext = sanitized.substring(extIdx);
      const maxBase = 255 - encoder.encode(ext).length;
      if (maxBase <= 0) return null;
      sanitized = base.substring(0, maxBase) + ext;
    } else {
      sanitized = sanitized.substring(0, 255);
    }
  }

  return sanitized;
}

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

    // Resolve save directory: current working directory (where pi-web-dev.js was started)
    const root = process.cwd();

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
