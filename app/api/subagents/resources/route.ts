import { NextResponse } from "next/server";
import { existsSync } from "node:fs";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { readSubagentResourceCatalog } from "@/lib/subagent-resource-catalog";

export const dynamic = "force-dynamic";

/** Files/SDK metadata only: no services, model runtime, extension imports, or installation. */
export async function GET(req: Request) {
  try {
    const cwd = new URL(req.url).searchParams.get("cwd");
    if (!cwd || !existsSync(cwd)) throw new Error("Valid cwd required");
    if (!isExistingFilePathAllowed(cwd, await getAllowedFileRoots())) return NextResponse.json({ error: "Access denied" }, { status: 403 });
    return NextResponse.json(await readSubagentResourceCatalog(cwd, getAgentDir()));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
