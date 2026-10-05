import { NextResponse } from "next/server";
import { lstatSync, readdirSync, realpathSync, rmdirSync, rmSync, unlinkSync } from "fs";
import { dirname, isAbsolute, join, relative, resolve as resolvePath, sep } from "path";
import type {
  ProjectDeleteErrorResponse,
  ProjectDeleteFailure,
  ProjectDeleteRefusalReason,
  ProjectDeleteResponse,
} from "@/lib/api-types";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { hasParentDirectorySegment } from "@/lib/path-security";
import {
  attachSessionProjectInfo,
  getAgentDir,
  invalidateSessionListCache,
  invalidateSessionManagerCache,
  invalidateSessionPathCache,
  listAllSessions,
  mergeSessionLists,
  piSubagentChildRootDir,
} from "@/lib/session-reader";
import { getAliveRpcSessionIds, getRpcSessionInfos, hasAliveRpcSessionForCwd } from "@/lib/rpc-manager";
import { workspaceKeyOf } from "@/lib/workspace-memory";
import type { SessionInfo } from "@/lib/types";
import { invalidateProjectCache } from "@/lib/worktree";

export const dynamic = "force-dynamic";

// DELETE /api/projects/delete  body: { projectKey }
//
// "A project" is a derived grouping, not an entity on disk: every session
// whose `cwd`/`projectRoot` resolve to one identity (`workspaceKeyOf`), across
// every cwd it has sessions in — a git repo's linked worktrees are separate
// session directories under the same project. So the request names the group
// by its key and the server finds it again in the session catalogue; the
// posted string is never turned into a path. Every directory removed is
// `dirname()` of a real enumerated session, checked for containment under
// `<agent-dir>/sessions` first, so nothing outside the sessions tree can be
// reached even if the catalogue were wrong.
//
// Only session data goes: the project's own folder, its `.pi/`, `trust.json`,
// and the hash-keyed stores under the agent directory are all left alone.

const SESSIONS_SUBDIR = "sessions";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function refusal(
  status: number,
  reason: ProjectDeleteRefusalReason,
  error: string,
  extra: { runningSessionTitles?: string[] } = {},
) {
  return NextResponse.json(
    { error, reason, ...extra } satisfies ProjectDeleteErrorResponse,
    { status },
  );
}

/**
 * The sessions root exactly as the scanner spells it. Grouping must use this
 * path, not its realpath: the catalogue's session paths are built by joining
 * `getAgentDir()` as given (`lib/session-reader.ts`), so on a host whose agent
 * directory sits behind a link (macOS `/var` → `/private/var`, or a symlinked
 * `~/.pi`) every session path is virtual while its realpath is not — relative
 * containment against the realpath would reject all of them. `dirRefusal()`
 * realpaths both sides instead, which keeps the check symlink-safe.
 */
function sessionsRoot(): string {
  return resolvePath(join(getAgentDir(), SESSIONS_SUBDIR));
}

/**
 * The per-cwd project directory one session belongs to, or null when the path
 * is not inside the sessions root at all. Every path the route removes is
 * derived from here, so a malformed catalogue entry can never widen the
 * removal: the directory is `<root>/<first path segment>` of a real session
 * path, never a path built from the posted key.
 */
function projectDirOf(sessionPath: string, root: string): string | null {
  const candidate = resolvePath(sessionPath);
  if (hasParentDirectorySegment(candidate)) return null;
  const relativePath = relative(root, candidate);
  if (!relativePath || relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    return null;
  }
  const [projectDirName] = relativePath.split(sep);
  if (!projectDirName) return null;
  return join(root, projectDirName);
}

/** True for a session file directly inside a project directory, rather than nested in a child tree. */
function isTopLevelSessionPath(sessionPath: string, projectDir: string): boolean {
  return dirname(resolvePath(sessionPath)) === resolvePath(projectDir);
}

/**
 * The pi-subagents child tree one nested transcript lives in:
 * `<projectDir>/<parentBase>/`, the directory `piSubagentChildRootDir()` names
 * for that child's parent session. Null when the file is not nested below the
 * project directory at all.
 */
function childCarryingDir(sessionPath: string, projectDir: string): string | null {
  const relativePath = relative(resolvePath(projectDir), resolvePath(sessionPath));
  if (!relativePath || relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    return null;
  }
  const [parentBase] = relativePath.split(sep);
  return parentBase ? join(projectDir, parentBase) : null;
}

/**
 * Why a project directory cannot be removed as a whole, or null when it can.
 * Containment is checked between realpaths, so the answer does not depend on
 * how either side is spelled: a link among the project's directories resolves
 * to its target and is rejected for being outside the tree, which is exactly
 * the escape `rm -r` through the link would make.
 */
function dirRefusal(dir: string, root: string): "symlink" | "internal" | null {
  let stats;
  try {
    stats = lstatSync(dir);
  } catch (error) {
    // Already gone is not a refusal: the sessions under it are gone too.
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? null : "internal";
  }
  // A link is removed as the link itself, never followed: `rm -r` through one
  // would delete whatever it points at, outside the sessions tree.
  if (stats.isSymbolicLink()) return "symlink";
  let realDir: string;
  let realRoot: string;
  try {
    realDir = realpathSync(dir);
    realRoot = realpathSync(root);
  } catch {
    return "internal";
  }
  const relativePath = relative(realRoot, realDir);
  if (!relativePath || relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    return "internal";
  }
  // Exactly one level below the root: the project directory itself, never the
  // root and never something nested deeper.
  if (relativePath.includes(sep)) return "internal";
  return null;
}

/** The sidebar's title for a session, matching what the row shows. */
function sessionTitle(session: { name?: string; firstMessage?: string; id: string }): string {
  const message = (session.firstMessage ?? "").trim();
  return session.name?.trim() || message.slice(0, 50) || session.id.slice(0, 12);
}

/**
 * What the project's directories hold beyond its session files: each top-level
 * session's pi-subagents child tree (`<parentBase>/`) and the
 * `subagent-artifacts/` transcripts beside it. Both are pi state under the
 * project directory and go with it; the scan excludes artifacts, so they are
 * found by reading the directory rather than from the catalogue.
 */
function nestedStateDirs(dir: string, sessionPaths: readonly string[]): string[] {
  const dirs = new Set<string>();
  for (const sessionPath of sessionPaths) {
    const childRoot = piSubagentChildRootDir(sessionPath);
    if (childRoot) dirs.add(childRoot);
  }
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "subagent-artifacts") dirs.add(join(dir, entry.name));
    }
  } catch {
    // Unreadable project directory: the session files under it are gone anyway.
  }
  return [...dirs];
}

export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) return refusal(403, "request-denied", "Untrusted API request");
  if (!hasJsonContentType(req)) {
    return refusal(415, "content-type", "Content-Type must be application/json");
  }

  let body: { projectKey?: unknown } | null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  const projectKey = body?.projectKey;
  if (typeof projectKey !== "string" || projectKey.length === 0 || projectKey.length > 4096) {
    return refusal(400, "invalid-request", "projectKey must be a non-empty string");
  }

  try {
    // The catalogue decides which sessions are the project's. A posted key that
    // matches no enumerated project is simply not one — including anything
    // trying to name a path (`..`, a directory outside the sessions tree).
    const sessions = await attachSessionProjectInfo(
      mergeSessionLists(await listAllSessions({ force: true }), getRpcSessionInfos({ includeTransient: true })),
    );
    const projectSessions = sessions.filter((session) => workspaceKeyOf(session) === projectKey);
    if (projectSessions.length === 0) {
      return refusal(404, "project-not-found", "No sessions belong to this project");
    }

    const root = sessionsRoot();

    // Live wrappers are refused, never killed. A wrapper owns its session file
    // from the moment it exists, not only while it runs: while its chat tab
    // stays open it survives as idle-alive and its next flush or prompt writes
    // there, so removing the file under it would corrupt that session. That is
    // also the everyday case here — the button lives in the selected project's
    // dropdown, whose session is exactly the open one. Every cwd of the project
    // counts, not just the one the sidebar selected: a worktree session has its
    // own wrapper.
    const projectCwds = [...new Set(projectSessions.map((session) => session.cwd).filter(Boolean))];
    const aliveIds = new Set(getAliveRpcSessionIds());
    const live = projectSessions.filter((session) => aliveIds.has(session.id));
    if (live.length > 0 || projectCwds.some((cwd) => hasAliveRpcSessionForCwd(cwd))) {
      return refusal(
        409,
        "session-busy",
        "A session of this project is still open (or running). Close it, or wait for it to finish, before deleting the project.",
        { runningSessionTitles: live.map(sessionTitle) },
      );
    }

    // Group by the project directory each session lives in: one per cwd, and
    // several for a project whose worktrees have their own sessions. A nested
    // pi-subagents child belongs to the same directory as its parent — it is
    // removed with that parent's child tree rather than unlinked itself.
    const sessionsByDir = new Map<string, typeof projectSessions>();
    const skipped: ProjectDeleteFailure[] = [];
    for (const session of projectSessions) {
      if (!session.path) continue;
      const projectDir = projectDirOf(session.path, root);
      if (!projectDir) {
        // A path the sessions root does not own: left alone, and reported
        // rather than deleted through a guessed directory.
        skipped.push({ path: session.path, error: `Not a project directory under ${SESSIONS_SUBDIR}` });
        continue;
      }
      sessionsByDir.set(projectDir, [...(sessionsByDir.get(projectDir) ?? []), session]);
    }
    if (sessionsByDir.size === 0) {
      // The project was found but none of its session paths lies in the tree
      // this route owns, so there is nothing it may remove. That is an internal
      // inconsistency, not a missing project: reporting 404 would tell the user
      // the project does not exist while the sidebar is showing it.
      return refusal(
        500,
        "internal",
        `No session of this project is under ${SESSIONS_SUBDIR}: ${skipped.map((entry) => entry.path).join(", ")}`,
      );
    }

    // Every directory is checked before anything is removed, so a link among
    // them refuses the whole request instead of half-deleting the project.
    for (const dir of sessionsByDir.keys()) {
      const refusalReason = dirRefusal(dir, root);
      if (refusalReason === "symlink") {
        return refusal(409, "symlink", "A project directory is a symbolic link, so it was not removed");
      }
      if (refusalReason === "internal") {
        return refusal(500, "internal", `Project directory is outside ${SESSIONS_SUBDIR}: ${dir}`);
      }
    }

    const failures: ProjectDeleteFailure[] = [...skipped];
    let deletedSessions = 0;
    let removedDirs = 0;

    for (const [dir, dirSessions] of sessionsByDir) {
      // A nested pi-subagents child has no file of its own to unlink: the tree
      // below its parent carries it away. It is therefore counted only once
      // that tree's removal has succeeded, so `deletedSessions` never claims a
      // child that is still on disk.
      const nestedChildren: SessionInfo[] = [];
      for (const session of dirSessions) {
        if (isTopLevelSessionPath(session.path, dir)) continue;
        nestedChildren.push(session);
        invalidateSessionPathCache(session.id);
        invalidateSessionManagerCache(session.path);
      }

      for (const session of dirSessions) {
        if (!isTopLevelSessionPath(session.path, dir)) continue;
        try {
          unlinkSync(session.path);
        } catch (error) {
          // A file already gone is the outcome asked for; anything else is
          // reported and does not stop the rest of the project.
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            failures.push({ path: session.path, error: errorMessage(error) });
            continue;
          }
        }
        deletedSessions += 1;
        invalidateSessionPathCache(session.id);
        invalidateSessionManagerCache(session.path);
      }

      // pi-subagents child trees and artifact transcripts: not part of the
      // session graph (a foreground child carries no relation metadata), so
      // they are removed by directory rather than through the cascade above.
      const carryingDirs = new Set<string>();
      for (const nestedDir of nestedStateDirs(dir, dirSessions.map((session) => session.path))) {
        try {
          rmSync(nestedDir, { recursive: true, force: true });
          carryingDirs.add(nestedDir);
        } catch (error) {
          failures.push({ path: nestedDir, error: errorMessage(error) });
        }
      }
      for (const child of nestedChildren) {
        const carrying = childCarryingDir(child.path, dir);
        if (!carrying || !carryingDirs.has(carrying)) continue;
        deletedSessions += 1;
      }

      // The project directory itself: every session file in it is gone, so it
      // is empty apart from pi state that is itself project-scoped. `rmdirSync`
      // refuses a directory that still holds anything, which is what keeps an
      // unexpected file safe.
      try {
        rmdirSync(dir);
        removedDirs += 1;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "ENOENT") failures.push({ path: dir, error: errorMessage(error) });
      }
    }

    invalidateSessionListCache();
    // The project's cwd may no longer resolve as a git repo (a removed
    // worktree), and grouping must not keep answering from a stale resolution.
    invalidateProjectCache();

    return NextResponse.json({
      deletedSessions,
      removedDirs,
      ...(failures.length > 0 ? { failures } : {}),
    } satisfies ProjectDeleteResponse);
  } catch (error) {
    return refusal(500, "internal", errorMessage(error));
  }
}
