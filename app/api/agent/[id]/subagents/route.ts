import { attachSessionRelations } from "@/lib/session-relations";
import { buildSubagentTree, collectLiveSubagentSessionIds, findOwnedSubagent } from "@/lib/subagent-tree";
import { getRpcSession, notifyRunningChange, startRpcSession, type AgentSessionWrapper } from "@/lib/rpc-manager";
import { listAllSessions, resolveSessionPath } from "@/lib/session-reader";
import type { SubagentTreeResponse, SubagentControlResponse } from "@/lib/api-types";
import type { SessionInfo } from "@/lib/types";

type SubagentTreeReason = NonNullable<SubagentTreeResponse["unavailableReason"]>;

function rpcErrorOf(error: unknown): { code: string; stage?: string; message: string } | null {
  if (!(error instanceof Error)) return null;
  const code = (error as { code?: unknown }).code;
  if (typeof code !== "string" || code.length === 0) return null;
  const stage = (error as { stage?: unknown }).stage;
  return { code, stage: typeof stage === "string" ? stage : undefined, message: error.message };
}

// ============================================================================
// GET  /api/agent/[rootId]/subagents
// POST /api/agent/[rootId]/subagents
//
// Root-scoped subagent tree and controls. All status/control traffic executes
// through the owning root parent session's RPC client; the browser never
// supplies run ids, indexes, or run directories.
// ============================================================================

export interface SubagentRouteDeps {
  listSessions: () => Promise<SessionInfo[]>;
  getWrapper: (id: string) => AgentSessionWrapper | undefined;
  startWrapper: (id: string, filePath: string) => Promise<{ session: AgentSessionWrapper }>;
  resolveSessionPath: (id: string) => Promise<string | null>;
}

const defaultDeps: SubagentRouteDeps = {
  // The cached session list (30s TTL) is fresh enough for durable tree nodes;
  // forcing a full re-scan on every poll made 1.5s polling rebuild the whole
  // session index (including nested discovery) per tick. Live children still
  // appear instantly as RPC placeholders.
  listSessions: () => listAllSessions(),
  getWrapper: (id) => getRpcSession(id),
  startWrapper: async (id, filePath) => startRpcSession(id, filePath, undefined),
  resolveSessionPath: async (id) => resolveSessionPath(id),
};

async function startRootWrapper(rootId: string, deps: SubagentRouteDeps): Promise<AgentSessionWrapper | null> {
  const existing = deps.getWrapper(rootId);
  if (existing?.isAlive()) return existing;
  const filePath = await deps.resolveSessionPath(rootId);
  if (!filePath) return null;
  try {
    return (await deps.startWrapper(rootId, filePath)).session;
  } catch {
    return null;
  }
}

function durableTree(rootId: string, sessions: SessionInfo[], reason: SubagentTreeReason): SubagentTreeResponse {
  return buildSubagentTree({
    rootId,
    sessions,
    runs: null,
    rpcAvailable: false,
    unavailableReason: reason,
    polledAt: Date.now(),
  });
}

function rememberLiveChildren(wrapper: AgentSessionWrapper, sessions: SessionInfo[], runs: Parameters<typeof collectLiveSubagentSessionIds>[1]): void {
  if (typeof wrapper.setLiveSubagentSessionIds !== "function") return;
  if (wrapper.setLiveSubagentSessionIds(collectLiveSubagentSessionIds(sessions, runs))) {
    notifyRunningChange();
  }
}

export function createSubagentHandlers(deps: SubagentRouteDeps = defaultDeps) {
  async function GET(
    _req: Request,
    { params }: { params: Promise<{ id: string }> },
  ): Promise<Response> {
    const { id: rootId } = await params;
    try {
      const sessions = await deps.listSessions();
      const related = attachSessionRelations(sessions);
      const root = related.find((session) => session.id === rootId);
      if (!root) {
        return Response.json({ error: "Session not found" }, { status: 404 });
      }
      if (root.sessionRole !== "primary") {
        return Response.json({ error: "Subagent tree requires a primary root session" }, { status: 400 });
      }

      const fallback = durableTree(rootId, sessions, "offline");
      const wrapper = await startRootWrapper(rootId, deps);
      if (!wrapper) {
        return Response.json(fallback);
      }

      const client = await wrapper.getSubagentRpcClient();
      try {
        const runs = await client.getRunStatus();
        if (runs) {
          rememberLiveChildren(wrapper, sessions, runs);
          return Response.json(buildSubagentTree({
            rootId,
            sessions,
            runs,
            rpcAvailable: true,
            polledAt: Date.now(),
          }));
        }
        rememberLiveChildren(wrapper, sessions, null);
        const reason = client.lastNegotiationReason === "incompatible" ? "incompatible" : "not-installed";
        return Response.json(durableTree(rootId, sessions, reason));
      } catch (error) {
        const rpcError = rpcErrorOf(error);
        if (rpcError?.stage === "status" && rpcError.code === "timeout") {
          return Response.json({
            error: "subagent status timeout",
            fallback,
            ...(wrapper.isRunning() ? { busy: true } : {}),
          }, { status: 504 });
        }
        return Response.json(fallback);
      }
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
    }
  }

  async function POST(
    req: Request,
    { params }: { params: Promise<{ id: string }> },
  ): Promise<Response> {
    const { id: rootId } = await params;
    try {
      const body = await req.json() as {
        childSessionId?: unknown;
        action?: unknown;
        message?: unknown;
      };
      const action = body.action;
      if (action !== "steer" && action !== "interrupt" && action !== "resume") {
        return Response.json({ error: "Unsupported subagent control action" }, { status: 400 });
      }
      if (typeof body.childSessionId !== "string" || body.childSessionId.length === 0) {
        return Response.json({ error: "childSessionId is required" }, { status: 400 });
      }
      if (action === "interrupt") {
        if (body.message !== undefined && body.message !== null && String(body.message).trim().length > 0) {
          return Response.json({ error: "interrupt does not accept a message" }, { status: 400 });
        }
      } else if (typeof body.message !== "string" || body.message.trim().length === 0) {
        return Response.json({ error: `${action} requires a non-empty message` }, { status: 400 });
      }

      const sessions = await deps.listSessions();
      const child = findOwnedSubagent(rootId, body.childSessionId, sessions);
      if (!child) {
        return Response.json({ error: "Child session does not belong to this root" }, { status: 400 });
      }
      if (!child.subagentRunId) {
        return Response.json({ error: "Child session has no run identity" }, { status: 400 });
      }

      const wrapper = await startRootWrapper(rootId, deps);
      if (!wrapper) {
        return Response.json({ error: "Root session is offline" }, { status: 409 });
      }

      const client = await wrapper.getSubagentRpcClient();
      const params = {
        runId: child.subagentRunId,
        ...(child.subagentIndex !== undefined ? { index: child.subagentIndex } : {}),
        ...(action !== "interrupt" ? { message: (body.message as string).trim() } : {}),
      };
      try {
        const controlResult = await client.control(action, params);
        let tree: SubagentTreeResponse | undefined;
        try {
          const runs = await client.getRunStatus();
          if (runs) {
            rememberLiveChildren(wrapper, sessions, runs);
            tree = buildSubagentTree({ rootId, sessions, runs, rpcAvailable: true, polledAt: Date.now() });
          }
        } catch {
          // The control succeeded; a failed follow-up snapshot keeps last data.
        }
        return Response.json({
          success: true,
          data: {
            action,
            childSessionId: body.childSessionId,
            ...(tree ? { tree } : {}),
          },
        } satisfies SubagentControlResponse);
      } catch (error) {
        const rpcError = rpcErrorOf(error);
        if (rpcError) {
          if (rpcError.code === "not_found" || rpcError.code === "invalid_state" || rpcError.code === "no_active_session") {
            return Response.json({ error: rpcError.message }, { status: 409 });
          }
          if (rpcError.code === "invalid_params" || rpcError.code === "invalid_request") {
            return Response.json({ error: rpcError.message }, { status: 400 });
          }
          if (rpcError.code === "timeout") {
            return Response.json({ error: rpcError.message }, { status: 504 });
          }
        }
        return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 });
      }
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
    }
  }

  return { GET, POST };
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return createSubagentHandlers().GET(req, ctx);
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return createSubagentHandlers().POST(req, ctx);
}
