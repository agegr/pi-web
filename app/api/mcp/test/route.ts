import { NextResponse } from "next/server";
import type { McpErrorResponse, McpTestResponse } from "@/lib/api-types";
import { isMcpEntryRefusal, readConnectableMcpEntry } from "@/lib/mcp-entry-request";
import { testMcpServer } from "@/lib/mcp-test";

export const dynamic = "force-dynamic";

// Settings › MCP's Test (ADR 0006): connects one server of the global
// `mcp.json` or the panel's project `.pi/mcp.json` once, outside any session,
// and answers with what it found (`lib/mcp-test.ts`). It starts a process or
// contacts a URL, and may run a `!command` value, so it re-checks everything
// a session's start would (`readConnectableMcpEntry()`, shared with sign-in):
// MCP is not off, the entry is read from its file (never a config from the
// browser) and valid, it does not reference PI_WEB_PASSWORD, and a project
// entry's folder is allowed and trusted. A global stdio server runs in the
// panel's project when it has one (checked like any cwd), else in the home
// folder, which the answer names.

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// POST /api/mcp/test body: { scope, name, cwd? }
// `cwd` is the panel's project: required for a project server, and the
// folder a global stdio server runs in.
export async function POST(req: Request) {
  const entry = await readConnectableMcpEntry(req);
  if (isMcpEntryRefusal(entry)) return NextResponse.json(entry.body, { status: entry.status });
  const { scope, name, sourcePath, configKey, config, cwd, internals } = entry;
  try {
    const result = await testMcpServer({ scope, name, sourcePath, configKey, config, cwd }, internals, { signal: req.signal });
    return NextResponse.json({ scope, name, configKey, result } satisfies McpTestResponse);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error), reason: "internal" } satisfies McpErrorResponse, { status: 500 });
  }
}
