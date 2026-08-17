import { NextResponse } from "next/server";
import { parseJsonWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { closeTerminal, getTerminal, MAX_INPUT_BYTES } from "@/lib/terminal-manager";
import { getTerminalAccessError } from "@/lib/terminal-security";

export const dynamic = "force-dynamic";

/**
 * The wire body is JSON, so one control byte costs six characters after
 * escaping. Bounding the wire body at twice the accepted payload keeps the
 * reader from buffering megabytes only for `write` to reject them, while still
 * clearing the largest chunk the client will ever send.
 */
const MAX_COMMAND_BODY_BYTES = MAX_INPUT_BYTES * 2;

function blockedResponse(error: { error: string; status: number }): NextResponse {
  // `blocked` marks a refusal by policy — no password, not loopback — as opposed
  // to a per-request failure, so the UI can stop offering terminals altogether.
  return NextResponse.json({ error: error.error, blocked: true }, { status: error.status });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; terminalId: string }> },
) {
  const blocked = getTerminalAccessError(req, { requireJson: true });
  if (blocked) return blockedResponse(blocked);

  try {
    const { id, terminalId } = await params;
    const terminal = getTerminal(id, terminalId);
    if (!terminal) return NextResponse.json({ error: "Terminal not found" }, { status: 404 });
    const body = await parseJsonWithinLimit<{
      type?: unknown;
      data?: unknown;
      columns?: unknown;
      rows?: unknown;
    }>(req, MAX_COMMAND_BODY_BYTES);
    if (body.type === "input" && typeof body.data === "string") {
      terminal.write(body.data);
    } else if (
      body.type === "resize"
      && typeof body.columns === "number"
      && typeof body.rows === "number"
    ) {
      terminal.resize(body.columns, body.rows);
    } else {
      return NextResponse.json({ error: "Invalid terminal command" }, { status: 400 });
    }
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ error: error.message }, { status: 413 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; terminalId: string }> },
) {
  const blocked = getTerminalAccessError(req);
  if (blocked) return blockedResponse(blocked);
  const { id, terminalId } = await params;
  closeTerminal(id, terminalId);
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
