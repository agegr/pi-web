import { NextResponse } from "next/server";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { existsSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import {
  attachSessionProjectInfo,
  resolveSessionPath,
  resolveSessionIdByPath,
  invalidateSessionPathCache,
  invalidateSessionListCache,
  buildSessionContext,
  readSessionHeader,
} from "@/lib/session-reader";
import { sessionPathKey } from "@/lib/session-path";
import { getRpcSession } from "@/lib/rpc-manager";
import { projectTreeForResponse } from "@/lib/project-tree";
import { computeSessionTotalActiveMs } from "@/lib/session-timing";
import { createServerTiming } from "@/lib/server-timing";
import {
  getParsedSessionSnapshot,
  getSessionContextFromSnapshot,
  invalidateParsedSession,
} from "@/lib/session-detail-cache";
import {
  computeSessionContextStats,
  computeSessionInputHistory,
  paginateSessionContext,
  parseSessionContextPageRequest,
  SessionContextPageRequestError,
} from "@/lib/session-context-page";
import { computeSessionStats } from "@/lib/session-stats";
import type { SessionEntry } from "@/lib/types";
import { readSubagentRun, readSubagentSessionResources, SUBAGENT_META_TYPE } from "@/lib/subagents";
import { readSessionToolSelection } from "@/lib/session-tool-selection";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const timing = createServerTiming();
  const { id } = await params;
  try {
    const rpc = getRpcSession(id);
    const liveRpc = rpc?.isAlive() ? rpc : undefined;
    const resolvedPath = liveRpc
      ? null
      : await timing.time("resolve", () => resolveSessionPath(id));
    if (!liveRpc && !resolvedPath) {
      return timing.finish(NextResponse.json({ error: "Session not found" }, { status: 404 }));
    }

    const diskSnapshot = liveRpc
      ? null
      : await timing.time("parse", () => getParsedSessionSnapshot(resolvedPath!));
    const sm = liveRpc?.inner.sessionManager;
    const { filePath, entries, leafId, tree } = timing.timeSync("session-read", () => ({
      filePath: liveRpc?.sessionFile || diskSnapshot?.filePath || resolvedPath || "",
      entries: sm?.getEntries() ?? diskSnapshot!.entries,
      leafId: sm ? sm.getLeafId() : diskSnapshot!.leafId,
      tree: sm ? projectTreeForResponse(sm.getTree()) : diskSnapshot!.tree,
    }));
    const searchParams = new URL(req.url).searchParams;
    const deferThinking = searchParams.has("deferThinking");
    const deferToolResultImages = searchParams.has("deferMedia");
    const pageRequest = parseSessionContextPageRequest(searchParams);
    const contextOptions = { deferThinking, deferToolResultImages, sessionId: id };
    const { fullContext, totalActiveMs } = timing.timeSync("context", () => ({
      fullContext: diskSnapshot
        ? getSessionContextFromSnapshot(
            diskSnapshot,
            leafId,
            contextOptions,
            () => buildSessionContext(entries as never, leafId, contextOptions),
          )
        : buildSessionContext(entries as never, leafId, contextOptions),
      totalActiveMs: computeSessionTotalActiveMs(entries),
    }));
    const { context, page: contextPage } = pageRequest
      ? paginateSessionContext(fullContext, pageRequest)
      : {
          context: fullContext,
          page: {
            startIndex: 0,
            endIndex: fullContext.messages.length,
            totalMessages: fullContext.messages.length,
            hasEarlier: false,
          },
        };
    const contextStats = computeSessionContextStats(fullContext);
    const inputHistory = computeSessionInputHistory(fullContext);

    const stats = diskSnapshot?.stats ?? computeSessionStats(entries as unknown as SessionEntry[]);
    const toolNames = readSubagentSessionResources(entries as never)?.tools
      ?? readSessionToolSelection(entries as never);
    const info = await timing.time("metadata", async () => {
      const header = sm?.getHeader() ?? diskSnapshot?.header ?? null;
      if (!header) return null;
      let modified = header.timestamp;
      try { modified = statSync(filePath).mtime.toISOString(); } catch { /* use header timestamp */ }
      const subagent = readSubagentRun(entries as never, header.id, filePath);
      const originSessionId = header.parentSession
        ? await resolveSessionIdByPath(header.parentSession)
        : undefined;
      const firstEntry = entries.find((entry) => entry.type === "message" && entry.message.role === "user");
      const content = firstEntry?.type === "message" && firstEntry.message.role === "user"
        ? firstEntry.message.content
        : undefined;
      const firstMessage = typeof content === "string" ? content
        : Array.isArray(content) ? content.filter((block) => block.type === "text").map((block) => block.text).join(" ") : "";
      return (await attachSessionProjectInfo([{
        path: filePath,
        id: header.id,
        cwd: header.cwd ?? "",
        name: sm?.getSessionName() ?? diskSnapshot?.sessionName,
        created: header.timestamp,
        modified,
        messageCount: stats.totalMessages,
        firstMessage: firstMessage || "(no messages)",
        parentSessionId: subagent?.parentSessionId ?? originSessionId,
        ...(subagent
          ? { relation: { kind: "subagent" as const, parentSessionId: subagent.parentSessionId, profile: subagent.profile, description: subagent.description, status: liveRpc?.isRunning() ? "running" as const : subagent.status } }
          : header.parentSession
            ? { relation: { kind: "fork" as const, ...(originSessionId ? { originSessionId } : {}) } }
            : {}),
        transient: !filePath || !existsSync(filePath),
      }]))[0];
    });

    const response = timing.timeSync("serialize", () => NextResponse.json({
      sessionId: id,
      filePath,
      info,
      leafId,
      tree,
      context,
      contextPage,
      contextStats,
      inputHistory,
      stats,
      totalActiveMs,
      ...(toolNames !== undefined ? { toolNames } : {}),
    }));
    return timing.finish(response);
  } catch (error) {
    const status = error instanceof SessionContextPageRequestError ? 400 : 500;
    return timing.finish(NextResponse.json({ error: String(error) }, { status }));
  }
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
    const manager = SessionManager.open(filePath);
    manager.appendSessionInfo(name.trim());
    invalidateParsedSession(filePath);
    invalidateSessionListCache([filePath]);
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

    // Read only the bounded header before deleting.
    const parentSessionPath = readSessionHeader(filePath)?.parentSession;
    let parentSessionId: string | undefined;
    if (parentSessionPath) {
      try {
        // The parent may have been deleted or moved already; treat it as absent.
        parentSessionId = readSessionHeader(parentSessionPath)?.id;
      } catch {
        parentSessionId = undefined;
      }
    }

    // Re-attach all direct children to this session's parent (cascade re-parent)
    // Scan sibling files in the same directory
    const targetPathKey = sessionPathKey(filePath);
    const reparentedPaths: string[] = [];
    const dir = dirname(filePath);
    try {
      const files = readdirSync(dir).filter(
        (file) => file.endsWith(".jsonl") && sessionPathKey(join(dir, file)) !== targetPathKey,
      );
      for (const file of files) {
        const childPath = join(dir, file);
        try {
          const content = readFileSync(childPath, "utf8");
          const lines = content.split("\n");
          const header = JSON.parse(lines[0]) as { type?: string; parentSession?: string };
          if (
            header.type === "session" &&
            header.parentSession &&
            sessionPathKey(header.parentSession) === targetPathKey
          ) {
            // Rewrite header with new parentSession
            header.parentSession = parentSessionPath;
            lines[0] = JSON.stringify(header);
            if (parentSessionPath && parentSessionId) {
              for (let index = 1; index < lines.length; index += 1) {
                let entry: { type?: string; customType?: string; data?: unknown };
                try {
                  entry = JSON.parse(lines[index]);
                } catch {
                  continue;
                }
                if (
                  entry.type !== "custom"
                  || entry.customType !== SUBAGENT_META_TYPE
                  || typeof entry.data !== "object"
                  || entry.data === null
                  || Array.isArray(entry.data)
                ) continue;
                entry.data = {
                  ...entry.data,
                  parentSessionId,
                  parentSessionPath,
                };
                lines[index] = JSON.stringify(entry);
                break;
              }
            }
            writeFileSync(childPath, lines.join("\n"));
            invalidateParsedSession(childPath);
            reparentedPaths.push(childPath);
          }
        } catch { /* skip malformed */ }
      }
    } catch { /* skip if dir unreadable */ }

    await getRpcSession(id)?.shutdown();
    unlinkSync(filePath);
    invalidateParsedSession(filePath);
    invalidateSessionPathCache(id);
    invalidateSessionListCache([filePath, ...reparentedPaths]);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
