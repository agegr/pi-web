import { NextResponse } from "next/server";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { generateSessionTitle } from "@/lib/session-title";
import { getRpcSession, startRpcSession } from "@/lib/rpc-manager";
import { invalidateSessionListCache, resolveSessionPath } from "@/lib/session-reader";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    // Title generation needs a model, not the checkout: it runs with shadow
    // tools and never writes files. Reuse an attached session when one exists,
    // otherwise borrow a throwaway so this never counts as an attachment and
    // never leaves a registry entry that would satisfy a later attach.
    const existing = getRpcSession(id);
    const attached = existing?.isAlive() === true;
    const { session } = attached
      ? { session: existing as NonNullable<typeof existing> }
      : await startRpcSession(id, filePath, undefined, { ephemeral: true });

    // globalThis keeps wrappers alive across dev hot reloads; older instances
    // may predate waitUntilReady(), but those have already completed startup.
    try {
      await session.waitUntilReady?.();
      const result = await generateSessionTitle(session.inner as unknown as AgentSession);

      if (!session.isAlive()) {
        return NextResponse.json(
          { error: "The session was closed while its title was being generated. Please try again." },
          { status: 409 },
        );
      }

      // An attach may have completed while the model was working. Name the
      // session through the attached wrapper so both do not write the file.
      const target = attached ? session : (getRpcSession(id) ?? session);
      target.inner.setSessionName(result.title);
      invalidateSessionListCache();
      return NextResponse.json({ title: result.title, usage: result.usage ?? null });
    } finally {
      if (!attached) session.destroy();
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
