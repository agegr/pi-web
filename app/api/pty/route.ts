import { NextResponse } from "next/server";
import { createPtySession } from "@/lib/pty-manager";

export const dynamic = "force-dynamic";

// POST /api/pty  body: { cwd?, cols?, rows? }
// Spawns a shell in the requested directory, falling back to ~ when missing.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({})) as { cwd?: unknown; cols?: unknown; rows?: unknown };
    const session = createPtySession({
      cwd: typeof body.cwd === "string" ? body.cwd : null,
      cols: typeof body.cols === "number" ? body.cols : undefined,
      rows: typeof body.rows === "number" ? body.rows : undefined,
    });
    return NextResponse.json({ id: session.id, cwd: session.cwd });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
