import { NextResponse } from "next/server";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import type { McpServersResponse } from "@/lib/api-types";
import {
  type McpConfigScope,
  readMcpServers,
  removeMcpServer,
  saveMcpServer,
  validateServerName,
} from "@/lib/mcp-config-store";
import { getProjectTrustStatus } from "@/lib/project-trust";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

type McpAction = "save" | "remove";

function readScope(scope: unknown): McpConfigScope {
  return scope === "project" ? "project" : "global";
}

function snapshot(cwd: string, agentDir: string): McpServersResponse {
  const { servers, diagnostics } = readMcpServers(cwd, agentDir);
  return {
    servers,
    diagnostics,
    projectResourcesLoaded: getProjectTrustStatus(cwd, agentDir).trusted,
  };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const cwd = searchParams.get("cwd");
  if (!cwd) return NextResponse.json({ error: "cwd required" }, { status: 400 });

  try {
    const allowedRoots = await getAllowedFileRoots();
    if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    return NextResponse.json(snapshot(cwd, getAgentDir()));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

// POST /api/mcp body: { action, cwd, scope?, name, config? }
export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  try {
    const body = await req.json() as {
      action?: McpAction;
      cwd?: string;
      scope?: string;
      name?: string;
      config?: unknown;
    };
    if (!body.cwd) return NextResponse.json({ error: "cwd required" }, { status: 400 });
    if (!body.action) return NextResponse.json({ error: "action required" }, { status: 400 });

    const allowedRoots = await getAllowedFileRoots();
    if (!isExistingFilePathAllowed(body.cwd, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const agentDir = getAgentDir();
    const scope = readScope(body.scope);
    // A project config can spawn an arbitrary command, so it is gated exactly
    // like project extensions: no edits while the project is untrusted.
    if (scope === "project" && !getProjectTrustStatus(body.cwd, agentDir).trusted) {
      return NextResponse.json(
        { error: "Project resources must be trusted before editing project MCP servers" },
        { status: 403 },
      );
    }

    const nameError = validateServerName(body.name);
    if (nameError) return NextResponse.json({ error: nameError }, { status: 400 });
    const name = (body.name as string).trim();

    if (body.action === "save") {
      const configError = saveMcpServer(scope, body.cwd, name, body.config);
      if (configError) return NextResponse.json({ error: configError }, { status: 400 });
    } else if (body.action === "remove") {
      if (!removeMcpServer(scope, body.cwd, name)) {
        return NextResponse.json(
          { error: `server "${name}" not found in the ${scope} config` },
          { status: 404 },
        );
      }
    } else {
      return NextResponse.json({ error: `Unsupported action: ${String(body.action)}` }, { status: 400 });
    }

    return NextResponse.json(snapshot(body.cwd, agentDir));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
