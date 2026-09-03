import { NextResponse } from "next/server";
import { killTerminal, resizeTerminal, writeTerminal } from "@/lib/terminal-manager";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await req.json() as { type?: unknown; data?: unknown; cols?: unknown; rows?: unknown };
    if (body.type === "input" && typeof body.data === "string") {
      return writeTerminal(id, body.data)
        ? NextResponse.json({ success: true })
        : NextResponse.json({ error: "Terminal not found" }, { status: 404 });
    }
    if (body.type === "resize" && typeof body.cols === "number" && typeof body.rows === "number") {
      return resizeTerminal(id, body.cols, body.rows)
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
