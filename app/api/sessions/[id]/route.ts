import { NextResponse } from "next/server";
import { readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
  resolveSessionPath,
  invalidateSessionPathCache,
  buildSessionContext,
  listAllSessions,
} from "@/lib/session-reader";
import { getRpcSession } from "@/lib/rpc-manager";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    let sm: any;
    try {
      sm = SessionManager.open(filePath);
    } catch (openErr) {
      console.error("[pi-web] Failed to open session file:", filePath, openErr);
      return NextResponse.json({ error: "Failed to open session file. It may be corrupted." }, { status: 500 });
    }

    let entries: any[];
    try {
      entries = sm.getEntries() as never;
    } catch (parseErr) {
      console.error("[pi-web] Failed to parse session entries:", filePath, parseErr);
      return NextResponse.json({ error: "Failed to read session data. The session file may be corrupted." }, { status: 500 });
    }

    let tree;
    try {
      tree = sm.getTree();
    } catch (treeErr) {
      console.error("[pi-web] Failed to get session tree:", filePath, treeErr);
      return NextResponse.json({ error: "Failed to read session structure. The session file may be corrupted." }, { status: 500 });
    }

    let leafId;
    try {
      leafId = sm.getLeafId();
    } catch (leafErr) {
      console.error("[pi-web] Failed to get leaf ID:", filePath, leafErr);
      leafId = null;
    }

    let context;
    try {
      context = buildSessionContext(entries, leafId);
      // Truncate if too many messages to avoid serialization stack overflow
      if (context.messages.length > 500) {
        console.warn(`[pi-web] Session ${id} has ${context.messages.length} messages, truncating to last 500`);
        const keep = context.messages.slice(-500);
        const keepIds = context.entryIds.slice(-500);
        context = { ...context, messages: keep, entryIds: keepIds };
      }
    } catch (ctxErr) {
      console.error("[pi-web] Failed to build session context:", filePath, ctxErr);
      return NextResponse.json({ error: "Failed to build session context. The session data may be corrupted." }, { status: 500 });
    }

    let header;
    try {
      header = sm.getHeader();
    } catch (headerErr) {
      console.error("[pi-web] Failed to get session header:", filePath, headerErr);
      return NextResponse.json({ error: "Failed to read session header. The session file may be corrupted." }, { status: 500 });
    }

    let modified = header?.timestamp ?? new Date().toISOString();
    try { modified = statSync(filePath).mtime.toISOString(); } catch { /* use header timestamp */ }
    const allSessions = await listAllSessions();
    const parentSessionId = allSessions.find((s) => s.id === id)?.parentSessionId;
    const info = header ? {
      path: filePath,
      id: header.id,
      cwd: header.cwd ?? "",
      name: (() => {
        try { return sm.getSessionName(); } catch (e) { console.error("[pi-web] Failed to get session name:", e); return undefined; }
      })(),
      created: header.timestamp,
      modified,
      messageCount: (context?.messages ?? []).length,
      firstMessage: (context?.messages ?? []).find((m: any) => m.role === "user")
        ? (() => {
            const msg = (context?.messages ?? []).find((m: any) => m.role === "user")!;
            const c = (msg as { content: unknown }).content;
            return typeof c === "string" ? c : (Array.isArray(c) ? (c.find((b: { type: string }) => b.type === "text") as { text: string } | undefined)?.text ?? "" : "") || "(no messages)";
          })()
        : "(no messages)",
      parentSessionId,
    } : null;

    const url = new URL(req.url);
    let agentState: { running: boolean; state?: { isStreaming?: boolean; isCompacting?: boolean; contextUsage?: { percent: number | null; contextWindow: number; tokens: number | null } | null; systemPrompt?: string; thinkingLevel?: string } } | undefined;
    if (url.searchParams.has("includeState")) {
      const rpc = getRpcSession(id);
      if (rpc?.isAlive()) {
        try {
          const rawState = await rpc.send({ type: "get_state" });
          // Extract only the fields we actually need — avoid deep serialization issues
          const state = extractState(rawState as any);
          agentState = { running: true, state };
        } catch (stateErr) {
          console.error("[pi-web] Failed to get agent state:", stateErr);
          agentState = { running: true, state: { error: "Failed to retrieve state" } };
        }
      } else {
        agentState = { running: false };
      }
    }

    const responseBody = {
      sessionId: id,
      filePath,
      info,
      tree,
      leafId,
      context,
      ...(agentState !== undefined ? { agentState } : {}),
    };
    // Safety: test serialization before sending
    try {
      JSON.stringify(responseBody);
    } catch (serErr) {
      console.error("[pi-web] Serialization safety net triggered:", serErr);
      // Return minimal safe response
      const safeBody = {
        sessionId: id,
        filePath,
        info: {
          ...info,
          messageCount: context?.messages?.length ?? 0,
          firstMessage: info?.firstMessage,
        },
        tree: [],
        leafId,
        context: {
          messages: context?.messages?.slice(-50) ?? [],
          entryIds: context?.entryIds?.slice(-50) ?? [],
          thinkingLevel: context?.thinkingLevel,
          model: context?.model,
        },
        ...(agentState !== undefined ? { agentState } : {}),
      };
      return NextResponse.json(safeBody);
    }
    return NextResponse.json(responseBody);
  } catch (error) {
    console.error(`[pi-web] GET /api/sessions/[id] failed for id=${id}:`, error);
    return NextResponse.json({
      error: "Internal server error",
      details: String(error),
      stack: error instanceof Error ? error.stack : undefined
    }, { status: 500 });
  }
}

// Helper to extract only the needed fields from agent state
function extractState(
  raw: any
): { isStreaming?: boolean; isCompacting?: boolean; contextUsage?: { percent: number | null; contextWindow: number; tokens: number | null } | null; systemPrompt?: string; thinkingLevel?: string } {
  if (!raw || typeof raw !== "object") return {};
  const result: any = {};
  const copyIfPrimitive = (val: any) => {
    const t = typeof val;
    if (t === "string" || t === "number" || t === "boolean") return val;
    if (t === "object" && val !== null) {
      if (Array.isArray(val)) return val.slice(0, 10);
      if (val.percent !== undefined || val.contextWindow !== undefined || val.tokens !== null) {
        return { percent: val.percent, contextWindow: val.contextWindow, tokens: val.tokens };
      }
      return undefined;
    }
    return undefined;
  };

  if ("isStreaming" in raw) result.isStreaming = copyIfPrimitive(raw.isStreaming);
  if ("isCompacting" in raw) result.isCompacting = copyIfPrimitive(raw.isCompacting);
  if ("contextUsage" in raw) result.contextUsage = copyIfPrimitive(raw.contextUsage);
  if ("systemPrompt" in raw) result.systemPrompt = copyIfPrimitive(raw.systemPrompt);
  if ("thinkingLevel" in raw) result.thinkingLevel = copyIfPrimitive(raw.thinkingLevel);

  return result;
}

// PATCH /api/sessions/[id]  body: { name: string }
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const { name } = await req.json() as { name?: string };
    if (typeof name !== "string") {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    const sm = SessionManager.open(filePath);
    sm.appendSessionInfo(name.trim());
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// DELETE /api/sessions/[id]
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    // Read header before deleting to get parentSession path
    const firstLine = readFileSync(filePath, "utf8").split("\n")[0];
    let parentSessionPath: string | undefined;
    try {
      const header = JSON.parse(firstLine) as { type?: string; parentSession?: string };
      if (header.type === "session") parentSessionPath = header.parentSession;
    } catch { /* ignore */ }

    // Re-attach all direct children to this session's parent (cascade re-parent)
    // Scan sibling files in the same directory
    const dir = filePath.replace(/\\/g, "/").split("/").slice(0, -1).join("/");
    try {
      const files = readdirSync(dir).filter((f) => f.endsWith(".jsonl") && join(dir, f) !== filePath);
      for (const file of files) {
        const childPath = join(dir, file);
        try {
          const content = readFileSync(childPath, "utf8");
          const lines = content.split("\n");
          const header = JSON.parse(lines[0]) as { type?: string; parentSession?: string };
          if (header.type === "session" && header.parentSession === filePath) {
            // Rewrite header with new parentSession
            header.parentSession = parentSessionPath;
            lines[0] = JSON.stringify(header);
            writeFileSync(childPath, lines.join("\n"));
          }
        } catch { /* skip malformed */ }
      }
    } catch { /* skip if dir unreadable */ }

    getRpcSession(id)?.destroy();
    unlinkSync(filePath);
    invalidateSessionPathCache(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
