import { NextResponse } from "next/server";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type {
  ProjectMcpListing,
  ProjectTrustResponse,
  ProjectTrustUnreadableResponse,
} from "@/lib/api-types";
import { readProjectMcpServers } from "@/lib/mcp-config-read";
import { isMcpEntryRefusal, mcpEntryRefusalResponse, mcpRefusalResponse, validateMcpProject } from "@/lib/mcp-entry-request";
import { invalidateModelsCache } from "@/lib/models-cache";
import { getProjectTrustStatus, trustProject } from "@/lib/project-trust";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { destroyRpcSessionsForCwd, hasBusyRpcSessionForCwd } from "@/lib/rpc-manager";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

/**
 * The folder, checked as Settings › MCP's routes check theirs
 * (`validateMcpProject()`): absolute, inside the allowed roots as given, then
 * a directory. A relative path is refused rather than resolved against the
 * server process's own folder, and a folder outside the roots gets 403
 * whether or not it exists.
 */
async function validateCwd(value: unknown): Promise<
  { cwd: string; allowedRoots: Set<string> } | { response: Response }
> {
  const result = await validateMcpProject(value);
  if (isMcpEntryRefusal(result)) return { response: mcpEntryRefusalResponse(result) };
  return result;
}

async function listProjectMcpServers(agentDir: string, cwd: string, allowedRoots: Set<string>): Promise<ProjectMcpListing> {
  try {
    const { file, servers } = await readProjectMcpServers({ agentDir, cwd, allowedRoots });
    return { mcpFile: file, mcpServers: servers };
  } catch (error) {
    return { mcpServers: [], mcpError: errorMessage(error) };
  }
}

// GET /api/project-trust?cwd=<folder>: the trust status, and the servers the
// project's `.pi/mcp.json` declares, so the trust dialog lists what trusting
// would connect before anyone trusts the folder (ADR 0006). The listing reads
// the files only, like GET /api/mcp: no server is spawned, no value resolved,
// no `!command` run, and env and header values never leave the server.
export async function GET(req: Request) {
  const result = await validateCwd(new URL(req.url).searchParams.get("cwd"));
  if ("response" in result) return result.response;
  const agentDir = getAgentDir();
  // Listed whatever the trust store says: the listing does not depend on it,
  // and a dialog left without one would offer Trust with nothing listed.
  const listing = await listProjectMcpServers(agentDir, result.cwd, result.allowedRoots);
  try {
    return NextResponse.json({ ...getProjectTrustStatus(result.cwd, agentDir), ...listing } satisfies ProjectTrustResponse);
  } catch (error) {
    // trust.json unparsable, or locked by another process (the pi CLI) past the
    // store's short wait; trusting would fail the same way right now.
    return NextResponse.json(
      { error: errorMessage(error), reason: "trust-unreadable", ...listing } satisfies ProjectTrustUnreadableResponse,
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) return mcpRefusalResponse(403, "request-denied", "Untrusted API request");
  if (!hasJsonContentType(req)) return mcpRefusalResponse(415, "content-type", "Content-Type must be application/json");
  try {
    // A body that is not JSON names no cwd.
    const body = await req.json().catch(() => null) as { cwd?: unknown } | null;
    const result = await validateCwd(body?.cwd);
    if ("response" in result) return result.response;

    const agentDir = getAgentDir();
    const current = getProjectTrustStatus(result.cwd, agentDir);
    if (!current.requiresTrust) {
      return mcpRefusalResponse(409, "trust-not-required", "This project has no resources that require trust");
    }
    if (hasBusyRpcSessionForCwd(result.cwd)) {
      return mcpRefusalResponse(409, "session-busy", "Wait for the active session to finish before trusting this project");
    }

    const status = trustProject(result.cwd, agentDir);
    invalidateModelsCache();
    await destroyRpcSessionsForCwd(result.cwd);
    return NextResponse.json(status);
  } catch (error) {
    return mcpRefusalResponse(500, "internal", errorMessage(error));
  }
}
