import { NextResponse } from "next/server";
import { resolveSessionPath, openSessionManager } from "@/lib/session-reader";
import { getRpcSession } from "@/lib/rpc-manager";
import { branchArtifactVersions } from "@/lib/interactive-artifacts";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const query = new URL(req.url).searchParams;
  try {
    const rpc = getRpcSession(id);
    const live = rpc?.isAlive() ? rpc : undefined;
    const path = live ? null : await resolveSessionPath(id);
    if (!live && !path) return NextResponse.json({ error: "Session not found" }, { status: 404 });
    const sm = live?.inner.sessionManager ?? openSessionManager(path!);
    const requestedLeaf = query.get("leafId");
    const leaf = requestedLeaf === "null" ? null : requestedLeaf ?? sm.getLeafId();
    if (leaf && !sm.getEntry(leaf)) return NextResponse.json({ error: "Branch not found" }, { status: 404 });
    const versions = branchArtifactVersions(leaf ? sm.getBranch(leaf) : []);
    const key = query.get("key");
    if (key !== null) {
      const version = versions.find((item) => item.key === key);
      return version ? NextResponse.json({ version }, { headers: { "Cache-Control": "no-store" } })
        : NextResponse.json({ error: "Artifact version not found on this branch" }, { status: 404 });
    }
    return NextResponse.json({ leafId: leaf, versions: versions.map(({ id, key, entryId, blockIndex, ordinal }) => ({ id, key, entryId, blockIndex, ordinal })) }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
