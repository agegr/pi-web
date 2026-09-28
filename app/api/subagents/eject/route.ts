import { NextResponse } from "next/server";
import { existsSync, statSync } from "fs";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { listAgentCatalog, type AgentCatalogAgent } from "@/lib/pi-subagents-catalog";
import { samePath } from "@/lib/paths";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { ejectSubagentProfile, SubagentProfileExistsError, type SubagentWritableScope } from "@/lib/subagents";

export const dynamic = "force-dynamic";

async function validateCwd(cwd: unknown): Promise<string> {
  if (typeof cwd !== "string" || !cwd || !existsSync(cwd)) throw new Error("Valid cwd required");
  if (!isExistingFilePathAllowed(cwd, await getAllowedFileRoots())) throw new Error("Access denied");
  return cwd;
}

/**
 * The source must be a file the pi-subagents catalog itself discovered for this
 * cwd. Eject only ever targets a catalog row the panel showed, and the catalog
 * is the module whose reads already constrain which agent files exist, so
 * membership here is the same path-security posture applied to a write.
 */
function catalogSource(cwd: string, sourcePath: string): AgentCatalogAgent {
  if (!existsSync(sourcePath) || !statSync(sourcePath).isFile()) {
    throw new Error("Source agent file not found");
  }
  const row = listAgentCatalog(cwd).find((agent) => samePath(agent.filePath, sourcePath));
  if (!row) throw new Error("Source path is not a catalog agent file");
  return row;
}

function validateScope(scope: unknown): SubagentWritableScope {
  if (scope !== "global" && scope !== "project") throw new Error("scope must be global or project");
  return scope;
}

export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  try {
    const body = await req.json() as { cwd?: unknown; scope?: unknown; sourcePath?: unknown; name?: unknown };
    const cwd = await validateCwd(body.cwd);
    const scope = validateScope(body.scope);
    if (typeof body.sourcePath !== "string" || !body.sourcePath) {
      return NextResponse.json({ error: "sourcePath required" }, { status: 400 });
    }
    if (body.name !== undefined && typeof body.name !== "string") {
      return NextResponse.json({ error: "name must be a string" }, { status: 400 });
    }
    // Default the copy to the source's canonical runtime name, so the ejected
    // file shadows the original, matching pi-subagents' own eject action.
    const source = catalogSource(cwd, body.sourcePath);
    const profile = ejectSubagentProfile(cwd, scope, body.sourcePath, body.name ?? source.name, source.source);
    return NextResponse.json({ profile });
  } catch (error) {
    if (error instanceof SubagentProfileExistsError) {
      return NextResponse.json({ error: error.message, path: error.filePath }, { status: 409 });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: message === "Access denied" ? 403 : 400 });
  }
}
