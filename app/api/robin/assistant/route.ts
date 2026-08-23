import { NextResponse } from "next/server";
import {
  ASSISTANT_SESSION_KINDS,
  attachMailReport,
  clearAssistantSession,
  type AssistantSessionKind,
} from "@/extension/robin/store";
import { runAssistantTurn, resolveMode } from "@/lib/robin-assistant";
import { validateAgentImages } from "@/lib/image-attachments";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";
// The scoring mode walks a whole batch of postings in one turn.
export const maxDuration = 360;

export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  try {
    const body = await req.json() as {
      message?: unknown;
      readOnly?: unknown;
      mode?: unknown;
      images?: unknown;
    };
    const message = typeof body.message === "string" ? body.message.trim() : "";
    const imageError = body.images === undefined ? null : validateAgentImages(body.images);
    if (imageError) {
      return NextResponse.json({ error: imageError }, { status: 400 });
    }
    const images = (body.images ?? []) as Array<{ type: "image"; data: string; mimeType: string }>;
    if (!message && images.length === 0) {
      return NextResponse.json({ error: "message is required" }, { status: 400 });
    }

    const mode = resolveMode(body);
    const { reply, usedTools, sessionId } = await runAssistantTurn(mode, message, images);
    // The mail-review turn is also run by the Telegram bridge; its report must
    // reach the dashboard's review store, not just the chat that asked for it.
    if (mode === "mail") attachMailReport(reply);
    return NextResponse.json({ reply, usedTools, sessionId });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

/**
 * Start a mode's conversation over.
 *
 * The remembered session id is dropped, so the next turn opens a fresh one. The
 * session file stays where it is — this is "new conversation", not "delete the
 * transcript", and the old one is still worth being able to read.
 *
 * Exists because the assistant session is long-lived by design: it is the same
 * conversation from the dashboard and from Telegram, for weeks. That is what
 * makes it useful and also what makes a way out of a drifted or expensive
 * context necessary.
 */
export async function DELETE(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  try {
    const body = await req.json().catch(() => ({})) as { mode?: unknown };
    const mode = typeof body.mode === "string" ? body.mode : "default";
    if (!ASSISTANT_SESSION_KINDS.includes(mode as AssistantSessionKind)) {
      return NextResponse.json(
        { error: `mode must be one of: ${ASSISTANT_SESSION_KINDS.join(", ")}` },
        { status: 400 },
      );
    }
    const cleared = clearAssistantSession(mode as AssistantSessionKind);
    return NextResponse.json({ cleared, mode });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
