import { NextResponse } from "next/server";
import type { McpErrorResponse, McpSignInFlowInfo } from "@/lib/api-types";
import { isMcpDisabledByOperator } from "@/lib/builtin-extensions";
import { isMcpEntryRefusal, mcpProjectTrustRefusal, readConnectableMcpEntry } from "@/lib/mcp-entry-request";
import { createMcpSignInDeps, mcpOAuthUrl, startMcpSignIn } from "@/lib/mcp-sign-in";

export const dynamic = "force-dynamic";

// Settings › MCP's sign-in (ADR 0006): starts signing in to one OAuth server
// of the global `mcp.json` or the panel's project `.pi/mcp.json`, or joins the
// sign-in already under way for its URL, and answers at once with the flow
// (`lib/mcp-sign-in.ts`). The browser then polls, pastes and cancels through
// `/api/mcp/sign-in/[flowId]`; the flow is never tied to this request.
// Connecting may run a `!command` value (a header, `oauth.clientSecret`), so
// the entry passes every check a Test makes (`readConnectableMcpEntry()`),
// and only an HTTP server without an Authorization header signs in with OAuth.

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// POST /api/mcp/sign-in body: { scope, name, cwd? }
export async function POST(req: Request) {
  const entry = await readConnectableMcpEntry(req);
  if (isMcpEntryRefusal(entry)) return NextResponse.json(entry.body, { status: entry.status });
  const { scope, name, sourcePath, configKey, config, cwd, project, agentDir, internals } = entry;
  const url = mcpOAuthUrl(config);
  if (url === undefined) {
    return NextResponse.json({
      error: `MCP server "${name}" does not use OAuth: only an HTTP server without an Authorization header does`,
      reason: "sign-in-not-oauth",
      name,
    } satisfies McpErrorResponse, { status: 409 });
  }
  // Asked again before the connection with the new tokens, which can come minutes later.
  const mayConnect = () => !isMcpDisabledByOperator()
    && (scope !== "project" || !project || mcpProjectTrustRefusal(project.cwd, agentDir) === undefined);
  try {
    const { flow, joined } = startMcpSignIn(
      { scope, name, sourcePath, configKey, config, cwd, url, mayConnect },
      createMcpSignInDeps(internals),
    );
    return NextResponse.json({ ...flow, ...(joined ? { joined: true as const } : {}) } satisfies McpSignInFlowInfo);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error), reason: "internal" } satisfies McpErrorResponse, { status: 500 });
  }
}
