import { NextResponse } from "next/server";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { generateSessionTitle } from "@/lib/session-title";
import { acquireTitleGenerationLock } from "@/lib/auto-title";
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

    const existing = getRpcSession(id);
    const { session } = existing?.isAlive()
      ? { session: existing }
      : await startRpcSession(id, filePath, undefined);

    // globalThis keeps wrappers alive across dev hot reloads; older instances
    // may predate waitUntilReady(), but those have already completed startup.
    await session.waitUntilReady?.();

    // Shares the in-flight guard with the automatic post-run titling so a
    // manual click can never race the automatic shadow agent.
    const release = acquireTitleGenerationLock(session.sessionId);
    if (!release) {
      return NextResponse.json(
        { error: "A session title is already being generated" },
        { status: 409 },
      );
    }

    try {
      const result = await generateSessionTitle(session.inner as unknown as AgentSession);

      if (!session.isAlive()) {
        return NextResponse.json(
          { error: "The session was closed while its title was being generated. Please try again." },
          { status: 409 },
        );
      }

      session.inner.setSessionName(result.title);
      invalidateSessionListCache();
      return NextResponse.json({ title: result.title, usage: result.usage ?? null });
    } finally {
      release();
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
