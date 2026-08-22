import { NextResponse } from "next/server";
import { isApiRequestAllowed } from "@/lib/request-security";
import { closeTerminalSession, getTerminalSession } from "@/lib/terminal-manager";

export const dynamic = "force-dynamic";

const MAX_INPUT_BYTES = 256 * 1024;

// POST /api/terminal/[id] - write input or resize a running terminal
// body: { type: "input", data: string } | { type: "resize", cols, rows }
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }

  const { id } = await params;
  const session = getTerminalSession(id);
  if (!session || !session.isRunning) {
    return NextResponse.json({ error: "Terminal not found" }, { status: 404 });
  }

  try {
    const body = (await req.json().catch(() => null)) as
      | { type?: unknown; data?: unknown; cols?: unknown; rows?: unknown }
      | null;
    if (!body) {
      return NextResponse.json({ error: "Missing request body" }, { status: 400 });
    }
    const type = body.type;

    if (type === "input") {
      if (typeof body.data !== "string") {
        return NextResponse.json({ error: "data must be a string" }, { status: 400 });
      }
      if (body.data.length > MAX_INPUT_BYTES) {
        return NextResponse.json({ error: "Input too large" }, { status: 413 });
      }
      session.write(body.data);
      return NextResponse.json({ success: true });
    }

    if (type === "resize") {
      const clamp = (value: unknown, fallback: number, min: number, max: number) => {
        const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
        if (!Number.isFinite(n)) return fallback;
        return Math.min(max, Math.max(min, Math.floor(n)));
      };
      const cols = clamp(body.cols, 1, 1, 500);
      const rows = clamp(body.rows, 1, 1, 200);
      session.resize(cols, rows);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// DELETE /api/terminal/[id] - kill the shell process and discard the session
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }

  const { id } = await params;
  if (!closeTerminalSession(id)) {
    return NextResponse.json({ error: "Terminal not found" }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}