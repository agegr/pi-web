import { NextResponse } from "next/server";
import { getTerminalCwd, killTerminal, resizeTerminal, writeTerminal } from "@/lib/terminal-manager";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cwd = getTerminalCwd(id);
  return cwd
    ? NextResponse.json({ id, cwd })
    : NextResponse.json({ error: "Terminal expired or closed" }, { status: 404 });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await req.json() as { type?: unknown; data?: unknown; cols?: unknown; rows?: unknown };
    if (body.type === "input" && typeof body.data === "string" && body.data.length <= 64 * 1024) {
      return writeTerminal(id, body.data)
        ? NextResponse.json({ success: true })
        : NextResponse.json({ error: "Terminal not found" }, { status: 404 });
    }
    if (body.type === "resize" && Number.isInteger(body.cols) && Number.isInteger(body.rows)
      && (body.cols as number) >= 2 && (body.cols as number) <= 1000
      && (body.rows as number) >= 2 && (body.rows as number) <= 1000) {
      return resizeTerminal(id, body.cols as number, body.rows as number)
        ? NextResponse.json({ success: true })
        : NextResponse.json({ error: "Terminal not found" }, { status: 404 });
    }
    return NextResponse.json({ error: "Invalid terminal command" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  killTerminal(id);
  return NextResponse.json({ success: true });
}
