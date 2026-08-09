import { NextResponse } from "next/server";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { resolveSessionPath, buildSessionContext } from "@/lib/session-reader";
import { loadModelsWithCache } from "@/lib/models-cache";
import { loadModels } from "@/lib/models-loader";
import { computeSessionContextUsage } from "@/lib/context-usage";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(req.url);
  const leafId = url.searchParams.get("leafId") ?? undefined;
  const deferThinking = url.searchParams.has("deferThinking");
  const deferToolResultImages = url.searchParams.has("deferMedia");

  try {
    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const sm = SessionManager.open(filePath);
    const context = buildSessionContext(sm.getEntries() as never, leafId, {
      deferThinking,
      deferToolResultImages,
    });

    let contextUsage = null;
    try {
      const cwd = sm.getCwd();
      const modelsData = await loadModelsWithCache(cwd, () => loadModels(cwd));
      contextUsage = computeSessionContextUsage(sm as never, leafId, modelsData);
    } catch { /* usage is best-effort; never fail the context response */ }

    return NextResponse.json({ context, contextUsage });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
