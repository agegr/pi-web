import { execFile } from "child_process";
import { existsSync, mkdirSync, readFileSync, realpath, realpathSync } from "fs";
import { access } from "fs/promises";
import { basename, dirname, join, resolve } from "path";
import { promisify } from "util";
import { allowFileRoot } from "./allowed-roots";
import { projectGitEnvironment } from "./git-environment";
import { samePath, toNativePath } from "./paths";

const execFileAsync = promisify(execFile);

// ============================================================================
// Project resolution: cwd → { projectRoot, branch }
//
// A worktree's `git rev-parse --git-common-dir` points at the *main* repo's
// .git directory, so its parent is the project root shared by all worktrees
// (a bare clone is its own root). Non-git directories resolve to themselves.
// Results are cached on globalThis (hot-reload safe) with a short TTL;
// add/remove worktree invalidates eagerly.
// ============================================================================

export interface ProjectInfo {
  projectRoot: string;
  /** Current branch of the cwd, null for non-git dirs or detached HEAD */
  branch: string | null;
  /** True when cwd is a linked worktree (not the main checkout) */
  isWorktree: boolean;
  /** True when cwd is the top-level directory of a checkout (main or linked).
   *  False for repo subdirectories and non-git dirs — the worktree switcher
   *  is only meaningful at the top level. */
  isTopLevel: boolean;
}

export interface WorktreeInfo {
  path: string;
  branch: string | null;
  isMain: boolean;
}

declare global {
  var __piProjectCache: Map<string, { info: ProjectInfo; expiresAt: number }> | undefined;
  var __piProjectRefresh: Map<string, Promise<ProjectInfo>> | undefined;
  var __piProjectCacheGeneration: number | undefined;
}

const PROJECT_CACHE_TTL_MS = 60_000;

function getProjectCache(): Map<string, { info: ProjectInfo; expiresAt: number }> {
  if (!globalThis.__piProjectCache) globalThis.__piProjectCache = new Map();
  return globalThis.__piProjectCache;
}

export function invalidateProjectCache(): void {
  globalThis.__piProjectCache?.clear();
  globalThis.__piProjectCacheGeneration = (globalThis.__piProjectCacheGeneration ?? 0) + 1;
  globalThis.__piProjectRefresh?.clear();
}

async function git(cwd: string, args: string[], timeoutMs = 10_000): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], {
    timeout: timeoutMs,
    maxBuffer: 1024 * 1024,
    // Pin the message locale so error-text matching (e.g. the dirty-worktree
    // detection in the DELETE route) works regardless of system language.
    env: projectGitEnvironment(),
  });
  return stdout.trim();
}

/** Spawn failures that clear up on their own: out of fds, processes or memory. */
const TRANSIENT_SPAWN_CODES = new Set(["EMFILE", "ENFILE", "EAGAIN", "ENOMEM"]);

/**
 * A git run that never gave its answer: the spawn failed for want of
 * resources, or git was killed (the timeout). Anything git itself exits with
 * (outside a repository, at a mount point, dubious ownership, a broken .git)
 * and a missing git binary are the folder's answer for now, cached like a
 * resolved repo; caching them also keeps a permanently broken cwd from
 * spawning git and logging on every session list.
 */
function isTransientGitError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const { code, killed, signal } = error as { code?: unknown; killed?: unknown; signal?: unknown };
  return killed === true || (typeof signal === "string" && signal !== "")
    || (typeof code === "string" && TRANSIENT_SPAWN_CODES.has(code));
}

function realPathOrSelf(filePath: string): string {
  try {
    return realpathSync(filePath);
  } catch {
    return filePath;
  }
}

/**
 * The folder a repository's worktrees group under, from its common git dir.
 * A checkout's `.git` stands in that folder, and so does a bare repo that a
 * `.git` file beside it points at (`project/.bare`). Any other bare clone
 * (`parent/repo.git`) is its own root: its parent may hold other repositories,
 * whose worktrees would otherwise all land in one project.
 */
function repoRootFromCommonDir(commonDir: string): string {
  const parent = dirname(commonDir);
  if (basename(commonDir) === ".git") return parent;
  try {
    const match = /^gitdir:\s*(.+?)\s*$/m.exec(readFileSync(join(parent, ".git"), "utf8"));
    if (match && samePath(realPathOrSelf(resolve(parent, match[1])), realPathOrSelf(commonDir))) return parent;
  } catch {
    // No `.git` file beside it (a `.git` directory belongs to another repo).
  }
  return commonDir;
}

const projectFallback = (cwd: string): ProjectInfo => ({
  projectRoot: cwd, branch: null, isWorktree: false, isTopLevel: false,
});

function pathExists(filePath: string): Promise<boolean> {
  return access(filePath).then(() => true, () => false);
}

const realpathAsync = promisify(realpath);

// Node's JS realpath, as `realpathSync`: `fs/promises.realpath` is the OS one, which on macOS
// rewrites a cwd's letter case and on Windows resolves `subst` drives, so a project would
// group differently from the sync path.
function realPathOrSelfAsync(filePath: string): Promise<string> {
  return realpathAsync(filePath).catch(() => filePath);
}

const inferredRepoChecks = new Map<string, Promise<string | null>>();

function checkInferredRepo(repoRoot: string): Promise<string | null> {
  const current = inferredRepoChecks.get(repoRoot);
  if (current) return current;
  const task = (async () => {
    const isRepo = await pathExists(join(repoRoot, ".git"))
      || (await Promise.all(["HEAD", "objects", "refs"].map((name) => pathExists(join(repoRoot, name))))).every(Boolean);
    return isRepo ? realPathOrSelfAsync(repoRoot) : null;
  })().finally(() => inferredRepoChecks.delete(repoRoot));
  inferredRepoChecks.set(repoRoot, task);
  return task;
}

async function inferRemovedWorktreeAsync(cwd: string): Promise<ProjectInfo | null> {
  const repoRoot = removedWorktreeRepo(cwd);
  const projectRoot = repoRoot && await checkInferredRepo(repoRoot);
  return projectRoot ? { projectRoot, branch: basename(cwd), isWorktree: true, isTopLevel: true } : null;
}

function removedWorktreeRepo(cwd: string): string | null {
  const parent = dirname(cwd);
  return parent.endsWith("-worktrees") ? parent.slice(0, -"-worktrees".length) || null : null;
}

/**
 * addWorktree() places worktrees in `<repoRoot>-worktrees/<dir>`. When such a
 * directory no longer exists (worktree removed), group its sessions back
 * under the main repo instead of letting them dangle as a phantom project.
 * The dir name is the sanitized branch name — close enough for display.
 *
 * Inference is by that naming convention and a sibling that is a repository
 * (`<repoRoot>/.git`, or a bare clone), never by `git worktree list`: `git worktree remove`
 * deletes the directory *and* its admin entry, so nothing survives to ask. It names one
 * folder and nothing else — the parent of the cwd with a `-worktrees` suffix stripped.
 * `/api/models`, which answers *for* such a cwd, takes the repo as just another cwd and
 * re-checks it against the allowed roots itself. `resolveProject()` asks the same
 * question without blocking (`inferRemovedWorktreeAsync()`).
 */
export function inferRemovedWorktree(cwd: string): ProjectInfo | null {
  const repoRoot = removedWorktreeRepo(cwd);
  if (!repoRoot) return null;
  // A bare clone has no `.git`; git takes HEAD, objects/ and refs/ for a git dir.
  const isRepo = existsSync(join(repoRoot, ".git"))
    || ["HEAD", "objects", "refs"].every((name) => existsSync(join(repoRoot, name)));
  if (!isRepo) return null;
  return { projectRoot: realPathOrSelf(repoRoot), branch: basename(cwd), isWorktree: true, isTopLevel: true };
}

/**
 * Resolve a cwd's project identity with stale-while-revalidate caching.
 *
 * Within PROJECT_CACHE_TTL_MS the cached value is returned directly. After
 * that the stale value is still returned immediately while a background
 * refresh re-runs git; callers (chiefly the session list, which fans out over
 * every project cwd) therefore never wait on git subprocesses once a cwd has
 * been resolved once. Concurrent lookups for the same cwd, cold or stale, share one promise.
 * add/removeWorktree invalidate eagerly via invalidateProjectCache().
 *
 * Transient git failures are the exception: the caller gets a cwd-only
 * fallback for that request only, never cached, so a failing git cannot pin
 * a phantom project identity (and the error is logged).
 */
export async function resolveProject(cwd: string): Promise<ProjectInfo> {
  const cache = getProjectCache();
  const cached = cache.get(cwd);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.info;

  const task = refreshProject(cwd);
  if (cached) {
    void task.catch(() => undefined);
    return cached.info;
  }

  try {
    return await task;
  } catch (error) {
    // A transient failure must not pin a phantom project identity.
    console.error(`[pi-web] resolveProject: git failed for ${cwd}, not cached: ${error instanceof Error ? error.message : String(error)}`);
    return projectFallback(cwd);
  }
}

function refreshProject(cwd: string): Promise<ProjectInfo> {
  const inflight = (globalThis.__piProjectRefresh ??= new Map<string, Promise<ProjectInfo>>());
  const current = inflight.get(cwd);
  if (current) return current;
  const generation = globalThis.__piProjectCacheGeneration ?? 0;
  const task = resolveProjectUncached(cwd)
    .then((info) => {
      if ((globalThis.__piProjectCacheGeneration ?? 0) === generation) {
        getProjectCache().set(cwd, { info, expiresAt: Date.now() + PROJECT_CACHE_TTL_MS });
      }
      return info;
    })
    .finally(() => {
      if (inflight.get(cwd) === task) inflight.delete(cwd);
    });
  inflight.set(cwd, task);
  return task;
}

async function resolveProjectUncached(cwd: string): Promise<ProjectInfo> {
  let info: ProjectInfo;
  try {
    if (!await pathExists(cwd)) {
      return (await inferRemovedWorktreeAsync(cwd)) ?? projectFallback(cwd);
    }
    const out = await git(cwd, [
      "rev-parse", "--path-format=absolute",
      "--git-common-dir", "--git-dir", "--show-toplevel",
      "--abbrev-ref", "HEAD",
    ]);
    const [commonDirRaw, gitDirRaw, toplevelRaw, ref] = out.split("\n").map((l) => l.trim());
    // Only the first three lines are paths — `ref` is a branch name and must
    // keep its forward slashes (`feature/foo`).
    const [commonDir, gitDir, toplevel] = [commonDirRaw, gitDirRaw, toplevelRaw].map(toNativePath);
    // git prints resolved (symlink-free) paths; normalize cwd the same way
    const realCwd = await realPathOrSelfAsync(cwd);
    // For a linked worktree, --git-dir differs from --git-common-dir.
    // Only collapse *worktree toplevels* into the main repo. A session whose
    // cwd is a subdirectory of a repo keeps its own project identity —
    // grouping subdirs under the repo root would change where new sessions
    // are created for existing users. samePath, never `===`: git prints POSIX
    // paths on Windows, where raw equality is always false and hides the
    // worktree switcher.
    const isTopLevel = samePath(toplevel, realCwd);
    const isWorktreeTopLevel = !samePath(gitDir, commonDir) && isTopLevel;
    const topLevelProjectRoot = isWorktreeTopLevel ? repoRootFromCommonDir(commonDir) : toplevel;
    info = {
      projectRoot: isTopLevel ? await realPathOrSelfAsync(topLevelProjectRoot) : cwd,
      branch: ref && ref !== "HEAD" ? ref : null,
      isWorktree: isWorktreeTopLevel,
      isTopLevel,
    };
  } catch (error) {
    // A transient failure propagates so resolveProject keeps it out of the
    // cache; whatever git itself answered is this folder's identity for now.
    if (isTransientGitError(error)) throw error;
    info = projectFallback(cwd);
  }

  return info;
}

// ============================================================================
// Worktree operations
//
// These take any directory inside the repo (a worktree, the main checkout, or
// a subdirectory) and resolve the main repo root themselves via the git
// common dir, so callers can pass session cwds directly.
// ============================================================================

/** Main repo root (parent of the shared .git dir, or a bare clone), or throws for non-git dirs */
async function getRepoRoot(cwd: string): Promise<string> {
  const commonDir = await git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  return realPathOrSelf(repoRootFromCommonDir(toNativePath(commonDir)));
}

/** Every worktree git has registered, `missing` when it is prunable or its folder is gone. */
async function listRegisteredWorktrees(cwd: string): Promise<{ path: string; branch: string | null; missing: boolean }[]> {
  const out = await git(cwd, ["worktree", "list", "--porcelain"]);
  const worktrees: { path: string; branch: string | null; missing: boolean }[] = [];
  let current: { path: string; branch?: string; prunable?: boolean } | null = null;

  const flush = () => {
    if (current?.path) {
      worktrees.push({
        path: current.path,
        branch: current.branch ?? null,
        missing: current.prunable === true || !existsSync(current.path),
      });
    }
    current = null;
  };

  for (const line of out.split("\n")) {
    if (line.startsWith("worktree ")) {
      flush();
      current = { path: toNativePath(line.slice("worktree ".length).trim()) };
    } else if (line.startsWith("branch ") && current) {
      current.branch = line.slice("branch ".length).trim().replace(/^refs\/heads\//, "");
    } else if (line.startsWith("prunable") && current) {
      current.prunable = true;
    } else if (line.trim() === "") {
      flush();
    }
  }
  flush();
  return worktrees;
}

export async function listWorktrees(cwd: string): Promise<WorktreeInfo[]> {
  // Prunable worktrees point at missing/broken gitdirs and cannot be browsed
  // or selected usefully. Also skip vanished paths even if git has not marked
  // them prunable yet.
  return (await listRegisteredWorktrees(cwd))
    .filter((worktree) => !worktree.missing)
    .map(({ path, branch }, index) => ({ path, branch, isMain: index === 0 }));
}

function findWorktreeByPath(worktrees: readonly WorktreeInfo[], candidate: string): WorktreeInfo | undefined {
  return worktrees.find((worktree) => samePath(worktree.path, candidate));
}

export function findCurrentWorktreePath(worktrees: readonly WorktreeInfo[], cwd: string): string | null {
  return findWorktreeByPath(worktrees, realPathOrSelf(cwd))?.path ?? null;
}

function sanitizeBranchForDir(branch: string): string {
  return branch.replace(/[\/\\:*?"<>|\s]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * A branch git will not check out twice: it is the branch of another worktree.
 * `missing`: that worktree's folder is gone, and git keeps the branch until
 * `git worktree prune` clears the entry (never run here).
 */
export class WorktreeBranchInUseError extends Error {
  constructor(readonly branch: string, readonly worktreePath: string, readonly missing: boolean) {
    super(missing
      ? `Branch '${branch}' belongs to a worktree whose folder is gone: ${worktreePath}; git worktree prune clears it`
      : `Branch '${branch}' is already checked out at ${worktreePath}`);
  }
}

export async function addWorktree(cwd: string, branch: string): Promise<{ path: string; branch: string }> {
  const trimmed = branch.trim();
  if (!trimmed) throw new Error("Branch name is required");

  const dirName = sanitizeBranchForDir(trimmed);
  if (!dirName) throw new Error(`Invalid branch name: ${branch}`);

  const repoRoot = await getRepoRoot(cwd);
  // Before the folder check: a branch pi-web already made a worktree for also
  // has its folder, and the answer is where that checkout is, not the folder.
  // Missing entries too: a deleted folder's entry still holds the branch.
  const holder = (await listRegisteredWorktrees(repoRoot)).find((worktree) => worktree.branch === trimmed);
  if (holder) throw new WorktreeBranchInUseError(trimmed, holder.path, holder.missing);
  const baseDir = `${resolve(repoRoot)}-worktrees`;
  const worktreePath = join(baseDir, dirName);
  if (existsSync(worktreePath)) {
    throw new Error(`Directory already exists: ${worktreePath}`);
  }
  mkdirSync(baseDir, { recursive: true });

  // Reuse the branch if it already exists, otherwise create it (from the
  // already-fetched remote tip when available, else local HEAD). We do not
  // fetch here: worktree creation must stay a local, offline-safe operation.
  let branchExists = false;
  try {
    await git(repoRoot, ["rev-parse", "--verify", "--quiet", `refs/heads/${trimmed}`]);
    branchExists = true;
  } catch {
    branchExists = false;
  }

  try {
    // Large repos (30k+ files) can take minutes to checkout.
    const WORKTREE_TIMEOUT = 5 * 60_000;
    if (branchExists) {
      await git(repoRoot, ["worktree", "add", "--", worktreePath, trimmed], WORKTREE_TIMEOUT);
    } else {
      // New branch: prefer the remote-tracking tip (refs/remotes/origin/<branch>)
      // over local HEAD when the user already fetched it; fall back to HEAD.
      let startFrom: string | undefined;
      try {
        await git(repoRoot, ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${trimmed}`]);
        startFrom = `refs/remotes/origin/${trimmed}`;
      } catch {
        startFrom = undefined;
      }
      const addArgs = ["worktree", "add", "-b", trimmed, "--", worktreePath];
      if (startFrom) addArgs.push(startFrom);
      await git(repoRoot, addArgs, WORKTREE_TIMEOUT);
    }
  } catch (error) {
    throw new Error(extractGitError(error));
  }

  allowFileRoot(worktreePath);
  invalidateProjectCache();
  return { path: worktreePath, branch: trimmed };
}

export async function removeWorktree(cwd: string, worktreePath: string, force = false): Promise<void> {
  const worktrees = await listWorktrees(cwd);
  // Git reports worktrees by their real path; the caller's may run through a link
  // (macOS's /var and /tmp are links to /private/...).
  const target = findWorktreeByPath(worktrees, realPathOrSelf(worktreePath));
  if (!target) throw new Error(`Not a worktree of this repository: ${worktreePath}`);
  if (target.isMain) throw new Error("Cannot remove the main worktree");

  try {
    await git(cwd, ["worktree", "remove", ...(force ? ["--force"] : []), target.path]);
  } catch (error) {
    throw new Error(extractGitError(error));
  }
  invalidateProjectCache();
}

/**
 * Git refuses to remove a dirty worktree, or one containing initialized
 * submodules, without --force. A locked worktree needs a double force and is
 * deliberately not matched: offering a single force there would just fail.
 */
export function worktreeRemovalRequiresForce(message: string): boolean {
  return worktreeHasUncommittedFiles(message) || /containing submodules/i.test(message);
}

/** The refusal is about modified or untracked files, not initialized submodules. */
export function worktreeHasUncommittedFiles(message: string): boolean {
  return /contains modified or untracked files|is dirty/i.test(message);
}

function extractGitError(error: unknown): string {
  const stderr = (error as { stderr?: string }).stderr;
  if (typeof stderr === "string" && stderr.trim()) return stderr.trim();
  return error instanceof Error ? error.message : String(error);
}
