import { NextResponse } from "next/server";
import { assertTrustedRequest } from "@/app/api/_security/api-auth";
import { isWorkspaceTrusted, normalizeWorkspacePath, trustWorkspace } from "@/app/api/_security/workspace-trust";

export const dynamic = "force-dynamic";

function getCwdFromUrl(req: Request): string | null {
  const { searchParams } = new URL(req.url);
  const cwd = searchParams.get("cwd")?.trim();
  return cwd || null;
}

export async function GET(req: Request) {
  const blocked = assertTrustedRequest(req);
  if (blocked) return blocked;

  const cwd = getCwdFromUrl(req);
  if (!cwd) return NextResponse.json({ error: "cwd required" }, { status: 400 });

  return NextResponse.json({
    cwd: normalizeWorkspacePath(cwd),
    trusted: isWorkspaceTrusted(cwd),
  });
}

export async function POST(req: Request) {
  const blocked = assertTrustedRequest(req);
  if (blocked) return blocked;

  try {
    const body = (await req.json()) as { cwd?: string };
    if (!body.cwd?.trim()) return NextResponse.json({ error: "cwd required" }, { status: 400 });

    const cwd = trustWorkspace(body.cwd);
    return NextResponse.json({ ok: true, cwd, trusted: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes("Directory does not exist") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
