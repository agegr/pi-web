import { NextResponse } from "next/server";
import { getRpcSession } from "@/lib/rpc-manager";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import {
  displayMcpPath,
  isValidMcpServerName,
  loadMcpServerList,
  setMcpServerDisabled,
} from "@/lib/mcp-servers";

export const dynamic = "force-dynamic";

async function requireAllowedCwd(cwd: string): Promise<string | null> {
  const allowedRoots = await getAllowedFileRoots();
  if (!isExistingFilePathAllowed(cwd, allowedRoots)) return "Access denied";
  return null;
}

// GET /api/mcp?cwd=<path>
// Lists the effective MCP servers from the pi-owned config files
// (global agent mcp.json merged with <cwd>/.pi/mcp.json, project wins).
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const cwd = searchParams.get("cwd");
  if (!cwd) return NextResponse.json({ error: "cwd required" }, { status: 400 });

  try {
    const denied = await requireAllowedCwd(cwd);
    if (denied) return NextResponse.json({ error: denied }, { status: 403 });
    const list = loadMcpServerList(cwd);
    return NextResponse.json({
      servers: list.servers,
      globalPath: displayMcpPath(list.globalPath),
      projectPath: displayMcpPath(list.projectPath),
      projectFileExists: list.projectFileExists,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

// POST /api/mcp — { cwd, server, action, sessionId? }
// enable/disable edits <cwd>/.pi/mcp.json (same file /mcp enable|disable
// writes) and reloads the live session so it applies immediately.
// reconnect dispatches /mcp reconnect through the live session; results
// arrive as extension notices over the session's SSE stream.
export async function POST(req: Request) {
  let body: { cwd?: unknown; server?: unknown; action?: unknown; sessionId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { cwd, server, action, sessionId } = body;
  if (typeof cwd !== "string" || !cwd) return NextResponse.json({ error: "cwd required" }, { status: 400 });
  if (typeof server !== "string" || !isValidMcpServerName(server)) {
    return NextResponse.json({ error: "Valid server name required" }, { status: 400 });
  }
  if (action !== "enable" && action !== "disable" && action !== "reconnect") {
    return NextResponse.json({ error: 'action must be "enable", "disable", or "reconnect"' }, { status: 400 });
  }
  if (sessionId !== undefined && typeof sessionId !== "string") {
    return NextResponse.json({ error: "sessionId must be a string" }, { status: 400 });
  }

  try {
    const denied = await requireAllowedCwd(cwd);
    if (denied) return NextResponse.json({ error: denied }, { status: 403 });

    if (action === "reconnect") {
      if (!sessionId) return NextResponse.json({ error: "sessionId required for reconnect" }, { status: 400 });
      const wrapper = getRpcSession(sessionId);
      if (!wrapper?.isAlive()) {
        return NextResponse.json({ error: "Session is not running; start it first" }, { status: 409 });
      }
      if (wrapper.isRunning()) {
        return NextResponse.json({ error: "Session is busy", busy: true }, { status: 409 });
      }
      // Without the adapter there is no /mcp command, and the prompt would
      // fall through to the model as a literal message. Refuse instead.
      const { commands } = await wrapper.send({ type: "get_commands" }) as {
        commands: { name: string; source: string }[];
      };
      const hasMcpCommand = (commands ?? []).some((command) =>
        (command.name === "mcp" || command.name === "pi-mcp") && command.source === "extension",
      );
      if (!hasMcpCommand) {
        return NextResponse.json({ error: "MCP adapter is not installed in this session" }, { status: 409 });
      }
      // Dispatched as an extension command: no chat message is created and
      // the adapter reports the outcome via ui.notify (SSE notice).
      await wrapper.send({ type: "prompt", message: `/mcp reconnect ${server}` });
      return NextResponse.json({ success: true });
    }

    const { changed, path: filePath } = setMcpServerDisabled(cwd, server, action === "disable");
    let reloaded = false;
    let busy = false;
    if (changed && sessionId) {
      const wrapper = getRpcSession(sessionId);
      if (wrapper?.isAlive()) {
        if (wrapper.isRunning()) {
          busy = true;
        } else {
          await wrapper.send({ type: "reload" });
          reloaded = true;
        }
      }
    }
    return NextResponse.json({
      success: true,
      changed,
      path: displayMcpPath(filePath),
      reloaded,
      ...(busy ? { busy: true as const } : {}),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
