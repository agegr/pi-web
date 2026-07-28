import { NextResponse } from "next/server";
import { mkdirSync, realpathSync } from "fs";
import { resolve, sep } from "path";
import { allowFileRoot } from "@/lib/file-access";
import { normalizeDirectory } from "@/lib/directory-browser";

const INVALID_NAME_RE = /[\/\\]|^\.\.?$/;

export async function POST(req: Request) {
  try {
    const body = await req.json() as Record<string, unknown>;
    const parent = typeof body.parent === "string" ? body.parent : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";

    if (!parent || !name) {
      return NextResponse.json({ error: "parent and name are required" }, { status: 400 });
    }

    if (INVALID_NAME_RE.test(name) || name.startsWith(".")) {
      return NextResponse.json({ error: "Invalid folder name" }, { status: 400 });
    }

    const normalizedParent = normalizeDirectory(parent);
    let resolvedParent: string;
    try {
      resolvedParent = realpathSync(normalizedParent);
    } catch {
      resolvedParent = resolve(normalizedParent);
    }

    const targetPath = resolve(resolvedParent, name);
    const parentWithSep = resolvedParent.endsWith(sep) ? resolvedParent : resolvedParent + sep;

    if (targetPath !== resolvedParent + sep + name && !targetPath.startsWith(parentWithSep)) {
      return NextResponse.json({ error: "Invalid folder name" }, { status: 400 });
    }

    mkdirSync(targetPath, 0o755);

    if (typeof globalThis !== "undefined") {
      (globalThis as Record<string, unknown>).__piAllowedRootsCache = undefined;
    }
    allowFileRoot(targetPath);

    return NextResponse.json({ path: targetPath });
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err) {
      const code = (err as { code: string }).code;
      if (code === "EEXIST") {
        return NextResponse.json({ error: "Folder already exists" }, { status: 409 });
      }
      if (code === "EACCES" || code === "EPERM") {
        return NextResponse.json({ error: "Permission denied" }, { status: 403 });
      }
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
