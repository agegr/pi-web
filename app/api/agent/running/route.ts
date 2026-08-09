import { NextResponse } from "next/server";
import { buildRunningSessionSnapshot } from "@/lib/running-sessions";
import type { GlobalSessionSnapshot } from "@/lib/types";
import { listAllSessions } from "@/lib/session-reader";
import { getRunningRpcSessionSnapshots } from "@/lib/rpc-manager";
import { resolveProject } from "@/lib/worktree";

export const dynamic = "force-dynamic";

// GET /api/agent/running - One navigation/status snapshot for all running sessions.
export async function GET() {
  const runtimeSnapshots = getRunningRpcSessionSnapshots();
  // A newly-created session may not have flushed a file yet. Runtime data is
  // still returned when the session listing is temporarily unavailable.
  const sessions = await listAllSessions().catch(() => []);
  const runningSessionIds = runtimeSnapshots.map((snapshot) => snapshot.id);
  const sessionById = new Map(sessions.map((session) => [session.id, session]));
  const projectByCwd = new Map<string, { projectRoot: string; branch?: string | null; isWorktree?: boolean }>();
  for (const runtime of runtimeSnapshots) {
    const session = sessionById.get(runtime.id);
    if (session?.projectRoot) {
      projectByCwd.set(runtime.cwd, {
        projectRoot: session.projectRoot,
        ...(session.worktreeBranch ? { branch: session.worktreeBranch, isWorktree: true } : {}),
      });
    }
  }
  const unresolvedCwds = [...new Set(runtimeSnapshots
    .map((runtime) => runtime.cwd)
    .filter((cwd) => !projectByCwd.has(cwd)))];
  const projectEntries = await Promise.all(
    unresolvedCwds.map(async (cwd) => [cwd, await resolveProject(cwd)] as const),
  );
  for (const [cwd, project] of projectEntries) projectByCwd.set(cwd, project);

  const runningSessions = runtimeSnapshots.map((runtime) => buildRunningSessionSnapshot(
    runtime,
    sessionById.get(runtime.id),
    projectByCwd.get(runtime.cwd) ?? { projectRoot: runtime.cwd, isWorktree: false },
  ));

  const snapshot: GlobalSessionSnapshot = { runningSessions, runningSessionIds };
  return NextResponse.json(
    snapshot,
    { headers: { "Cache-Control": "no-store" } },
  );
}
