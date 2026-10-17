import { NextResponse } from "next/server";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { Api, Model } from "@earendil-works/pi-ai";
import { generateSessionTitle, type TitleModelOverride } from "@/lib/session-title";
import { readTitleModelPreference } from "@/lib/title-model-preference";
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

    // The instance's own choice, made from the Generate title button's menu (see
    // lib/title-model-preference.ts); the session's own model and its cheapest
    // thinking level when there is none.
    const preference = readTitleModelPreference();
    let override: TitleModelOverride | undefined;
    if (preference?.provider && preference.modelId) {
      const runtime = session.inner.modelRuntime;
      let model = runtime.getModel(preference.provider, preference.modelId);
      if (!model) {
        // A provider an extension registers at session_start, or a models.json
        // edited since the choice was made: reload once before giving up on it.
        await runtime.refresh({ allowNetwork: false });
        model = runtime.getModel(preference.provider, preference.modelId);
      }
      if (model) {
        override = {
          model: model as unknown as Model<Api>,
          ...(preference.thinkingLevel ? { thinkingLevel: preference.thinkingLevel } : {}),
        };
      } else {
        // A stale choice, not a broken title: name the session anyway, keeping a
        // level the user asked for.
        console.warn(`[pi-web] the title model ${preference.provider}/${preference.modelId} is not available; naming with the session's own model`);
        if (preference.thinkingLevel) override = { thinkingLevel: preference.thinkingLevel };
      }
    } else if (preference?.thinkingLevel) {
      override = { thinkingLevel: preference.thinkingLevel };
    }

    const result = await generateSessionTitle(session.inner as unknown as AgentSession, override);

    if (!session.isAlive()) {
      return NextResponse.json(
        { error: "The session was closed while its title was being generated. Please try again." },
        { status: 409 },
      );
    }

    session.inner.setSessionName(result.title);
    invalidateSessionListCache();
    return NextResponse.json({ title: result.title, usage: result.usage ?? null });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
