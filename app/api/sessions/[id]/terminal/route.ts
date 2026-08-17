import { NextResponse } from "next/server";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { createTerminal } from "@/lib/terminal-manager";
import { getTerminalAccessError } from "@/lib/terminal-security";

export const dynamic = "force-dynamic";

function blockedResponse(error: { error: string; status: number }): NextResponse {
  // `blocked` marks a refusal by policy — no password, not loopback — as opposed
  // to a per-request failure, so the UI can stop offering terminals altogether.
  return NextResponse.json(
    { error: error.error, blocked: true },
    {
      status: error.status,
      headers: error.status === 401
        ? { "WWW-Authenticate": 'Basic realm="Pi Web", charset="UTF-8"' }
        : undefined,
    },
  );
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const blocked = getTerminalAccessError(req, { requireJson: true });
  if (blocked) return blockedResponse(blocked);

  try {
    const { id } = await params;
    const body = await parseJsonWithinLimit<{ columns?: unknown; rows?: unknown }>(req, 1024);
    const columns = body.columns === undefined ? 80 : body.columns;
    const rows = body.rows === undefined ? 24 : body.rows;
    if (typeof columns !== "number" || typeof rows !== "number") {
      return NextResponse.json({ error: "Terminal dimensions must be numbers" }, { status: 400 });
    }
    const terminal = await createTerminal(id, columns, rows);
    return NextResponse.json(terminal, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ error: error.message }, { status: 413 });
    }
    const message = error instanceof Error ? error.message : String(error);
    const status = message === "Session not found" ? 404 : message.startsWith("Trust this project") ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
