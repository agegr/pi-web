import { NextResponse } from "next/server";
import { createDirectory, deleteDirectory, renameDirectory } from "@/lib/directory-browser";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const runtime = "nodejs";

function errorStatus(error: unknown): number {
  const code = (error as NodeJS.ErrnoException)?.code;
  if (code === "ENOENT") return 404;
  if (code === "EEXIST" || code === "ENOTEMPTY") return 409;
  if (code === "EACCES" || code === "EPERM") return 403;
  return 400;
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return NextResponse.json({ error: message }, { status: errorStatus(error) });
}

function checkRequest(request: Request): NextResponse | null {
  if (!isApiRequestAllowed(request)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(request)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  return null;
}

// POST /api/cwd/directories body: { parentPath: string; name: string }
export async function POST(request: Request) {
  const rejected = checkRequest(request);
  if (rejected) return rejected;

  try {
    const body = await request.json() as { parentPath?: unknown; name?: unknown };
    if (typeof body.parentPath !== "string" || !body.parentPath.trim()) {
      return NextResponse.json({ error: "parentPath is required" }, { status: 400 });
    }
    if (typeof body.name !== "string") {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const entry = await createDirectory(body.parentPath.trim(), body.name.trim());
    return NextResponse.json({ entry }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

// PATCH /api/cwd/directories body: { path: string; name: string }
export async function PATCH(request: Request) {
  const rejected = checkRequest(request);
  if (rejected) return rejected;

  try {
    const body = await request.json() as { path?: unknown; name?: unknown };
    if (typeof body.path !== "string" || !body.path.trim()) {
      return NextResponse.json({ error: "path is required" }, { status: 400 });
    }
    if (typeof body.name !== "string") {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const entry = await renameDirectory(body.path.trim(), body.name.trim());
    return NextResponse.json({ entry });
  } catch (error) {
    return errorResponse(error);
  }
}

// DELETE /api/cwd/directories body: { path: string }
export async function DELETE(request: Request) {
  const rejected = checkRequest(request);
  if (rejected) return rejected;

  try {
    const body = await request.json() as { path?: unknown };
    if (typeof body.path !== "string" || !body.path.trim()) {
      return NextResponse.json({ error: "path is required" }, { status: 400 });
    }

    await deleteDirectory(body.path.trim());
    return NextResponse.json({ deletedPath: body.path.trim() });
  } catch (error) {
    return errorResponse(error);
  }
}
