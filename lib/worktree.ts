import { existsSync, mkdirSync, realpathSync } from "fs";
import { basename, dirname, join, resolve } from "path";
import { allowFileRoot } from "./allowed-roots";
import { runGit } from "./git-process";
import { samePath, toNativePath } from "./paths";
import { projectIdentityKey } from "./project-identity";

// ============================================================================
// Project resolution: cwd → { projectRoot, branch }
//
// A worktree's `git rev-parse --git-common-dir` points at the *main* repo's
// .git directory, so its parent is the project root shared by all worktrees.
// Non-git directories resolve to themselves. Results are cached on globalThis
// (hot-reload safe) with a short TTL; add/remove worktree invalidates eagerly.
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
  /** Top-level of the current checkout, including a linked worktree. */
  repositoryRoot: string | null;
  /** Main repository root shared by all linked worktrees. */
  gitCommonRoot: string | null;
}

export interface WorktreeInfo {
  path: string;
  branch: string | null;
  isMain: boolean;
}

declare global {
  var __piProjectCache: Map<string, { info: ProjectInfo; expiresAt: number }> | undefined;
  var __piProjectPromises: Map<string, Promise<ProjectInfo>> | undefined;
  var __piWorktreeListPromises: Map<string, Promise<WorktreeInfo[]>> | undefined;
  var __piWorktreeListCache: Map<string, { worktrees: WorktreeInfo[]; expiresAt: number }> | undefined;
}

const PROJECT_CACHE_TTL_MS = 60_000;
const WORKTREE_CACHE_TTL_MS = 5_000;
const MAX_PROJECT_CACHE_ENTRIES = 256;
const MAX_WORKTREE_CACHE_ENTRIES = 64;

function getProjectCache(): Map<string, { info: ProjectInfo; expiresAt: number }> {
  if (!globalThis.__piProjectCache) globalThis.__piProjectCache = new Map();
  return globalThis.__piProjectCache;
}

function getProjectPromises(): Map<string, Promise<ProjectInfo>> {
  if (!globalThis.__piProjectPromises) globalThis.__piProjectPromises = new Map();
  return globalThis.__piProjectPromises;
}

function getWorktreeListPromises(): Map<string, Promise<WorktreeInfo[]>> {
  if (!globalThis.__piWorktreeListPromises) globalThis.__piWorktreeListPromises = new Map();
  return globalThis.__piWorktreeListPromises;
}

function getWorktreeListCache(): Map<string, { worktrees: WorktreeInfo[]; expiresAt: number }> {
  if (!globalThis.__piWorktreeListCache) globalThis.__piWorktreeListCache = new Map();
  return globalThis.__piWorktreeListCache;
}

export function invalidateProjectCache(): void {
  globalThis.__piProjectCache?.clear();
}

export function invalidateWorktreeCache(): void {
  globalThis.__piWorktreeListCache?.clear();
}

function setBoundedCache<K, V>(cache: Map<K, V>, key: K, value: V, limit: number): void {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > limit) {
    const oldest = cache.keys().next().value as K | undefined;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

async function git(cwd: string, args: string[]): Promise<string> {
  return (await runGit(cwd, args, { maxBuffer: 1024 * 1024 })).trim();
}

function realPathOrSelf(filePath: string): string {
  try {
    return realpathSync(filePath);
  } catch {
    return filePath;
  }
}

/**
 * addWorktree() places worktrees in `<repoRoot>-worktrees/<dir>`. When such a
 * directory no longer exists (worktree removed), group its sessions back
 * under the main repo instead of letting them dangle as a phantom project.
 * The dir name is the sanitized branch name — close enough for display.
 */
function inferRemovedWorktree(cwd: string): ProjectInfo | null {
  const parent = dirname(cwd);
  if (!parent.endsWith("-worktrees")) return null;
  const repoRoot = parent.slice(0, -"-worktrees".length);
  if (!repoRoot || !existsSync(join(repoRoot, ".git"))) return null;
  const projectRoot = realPathOrSelf(repoRoot);
  return {
    projectRoot,
    branch: basename(cwd),
    isWorktree: true,
    isTopLevel: true,
    repositoryRoot: null,
    gitCommonRoot: projectRoot,
  };
}

function canonicalCwdKey(cwd: string): string {
  return projectIdentityKey(realPathOrSelf(resolve(cwd)));
}

export async function resolveProject(cwd: string): Promise<ProjectInfo> {
  const key = canonicalCwdKey(cwd);
  const cache = getProjectCache();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    setBoundedCache(cache, key, cached, MAX_PROJECT_CACHE_ENTRIES);
    return cached.info;
  }

  const promises = getProjectPromises();
  const existing = promises.get(key);
  if (existing) return existing;

  const loadPromise = resolveProjectUncached(cwd, key, cache);
  const trackedPromise = loadPromise.finally(() => {
    if (promises.get(key) === trackedPromise) promises.delete(key);
  });
  promises.set(key, trackedPromise);
  return trackedPromise;
}

async function resolveProjectUncached(
  cwd: string,
  key: string,
  cache: Map<string, { info: ProjectInfo; expiresAt: number }>,
): Promise<ProjectInfo> {
  let info: ProjectInfo;
  try {
    if (!existsSync(cwd)) {
      info = inferRemovedWorktree(cwd) ?? {
        projectRoot: cwd,
        branch: null,
        isWorktree: false,
        isTopLevel: false,
        repositoryRoot: null,
        gitCommonRoot: null,
      };
      setBoundedCache(
        cache,
        key,
        { info, expiresAt: Date.now() + PROJECT_CACHE_TTL_MS },
        MAX_PROJECT_CACHE_ENTRIES,
      );
      return info;
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
    const realCwd = realPathOrSelf(cwd);
    // For a linked worktree, --git-dir differs from --git-common-dir.
    // Only collapse *worktree toplevels* into the main repo. A session whose
    // cwd is a subdirectory of a repo keeps its own project identity —
    // grouping subdirs under the repo root would change where new sessions
    // are created for existing users.
    const isTopLevel = samePath(toplevel, realCwd);
    const isWorktreeTopLevel = !samePath(gitDir, commonDir) && isTopLevel;
    const topLevelProjectRoot = isWorktreeTopLevel ? dirname(commonDir) : toplevel;
    info = {
      projectRoot: isTopLevel ? realPathOrSelf(topLevelProjectRoot) : cwd,
      branch: ref && ref !== "HEAD" ? ref : null,
      isWorktree: isWorktreeTopLevel,
      isTopLevel,
      repositoryRoot: realPathOrSelf(toplevel),
      gitCommonRoot: realPathOrSelf(dirname(commonDir)),
    };
  } catch {
    info = {
      projectRoot: cwd,
      branch: null,
      isWorktree: false,
      isTopLevel: false,
      repositoryRoot: null,
      gitCommonRoot: null,
    };
  }

  setBoundedCache(
    cache,
    key,
    { info, expiresAt: Date.now() + PROJECT_CACHE_TTL_MS },
    MAX_PROJECT_CACHE_ENTRIES,
  );
  return info;
}

// ============================================================================
// Worktree operations
//
// These take any directory inside the repo (a worktree, the main checkout, or
// a subdirectory) and resolve the main repo root themselves via the git
// common dir, so callers can pass session cwds directly.
// ============================================================================

/** Main repo root shared by linked worktrees, or throws for non-git dirs. */
async function getRepoRoot(cwd: string): Promise<string> {
  const project = await resolveProject(cwd);
  if (!project.gitCommonRoot) throw new Error("Not a Git repository");
  return project.gitCommonRoot;
}

export async function listWorktrees(
  cwd: string,
  options: { force?: boolean } = {},
): Promise<WorktreeInfo[]> {
  const project = await resolveProject(cwd);
  const key = projectIdentityKey(project.gitCommonRoot ?? canonicalCwdKey(cwd));
  const cache = getWorktreeListCache();
  const cached = cache.get(key);
  if (!options.force && cached && cached.expiresAt > Date.now()) {
    setBoundedCache(cache, key, cached, MAX_WORKTREE_CACHE_ENTRIES);
    return cached.worktrees;
  }

  const promises = getWorktreeListPromises();
  const existing = promises.get(key);
  if (existing) return existing;

  const gitCwd = existsSync(cwd) ? cwd : project.gitCommonRoot ?? project.projectRoot;
  const loadPromise = loadWorktrees(gitCwd).then((worktrees) => {
    setBoundedCache(
      cache,
      key,
      { worktrees, expiresAt: Date.now() + WORKTREE_CACHE_TTL_MS },
      MAX_WORKTREE_CACHE_ENTRIES,
    );
    return worktrees;
  });
  const trackedPromise = loadPromise.finally(() => {
    if (promises.get(key) === trackedPromise) promises.delete(key);
  });
  promises.set(key, trackedPromise);
  return trackedPromise;
}

async function loadWorktrees(cwd: string): Promise<WorktreeInfo[]> {
  const out = await git(cwd, ["worktree", "list", "--porcelain"]);
  const worktrees: WorktreeInfo[] = [];
  let current: (Partial<WorktreeInfo> & { prunable?: boolean }) | null = null;

  const flush = () => {
    if (current?.path) {
      // Prunable worktrees point at missing/broken gitdirs and cannot be
      // browsed or selected usefully. Also skip vanished paths even if git has
      // not marked them prunable yet.
      if (!current.prunable && existsSync(current.path)) {
        worktrees.push({
          path: current.path,
          branch: current.branch ?? null,
          isMain: worktrees.length === 0,
        });
      }
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

function findWorktreeByPath(worktrees: readonly WorktreeInfo[], candidate: string): WorktreeInfo | undefined {
  return worktrees.find((worktree) => samePath(worktree.path, candidate));
}

export function findCurrentWorktreePath(worktrees: readonly WorktreeInfo[], cwd: string): string | null {
  return findWorktreeByPath(worktrees, realPathOrSelf(cwd))?.path ?? null;
}

function sanitizeBranchForDir(branch: string): string {
  return branch.replace(/[\/\\:*?"<>|\s]+/g, "-").replace(/^-+|-+$/g, "");
}

export async function addWorktree(cwd: string, branch: string): Promise<{ path: string; branch: string }> {
  const trimmed = branch.trim();
  if (!trimmed) throw new Error("Branch name is required");

  const dirName = sanitizeBranchForDir(trimmed);
  if (!dirName) throw new Error(`Invalid branch name: ${branch}`);

  const repoRoot = await getRepoRoot(cwd);
  const baseDir = `${resolve(repoRoot)}-worktrees`;
  const worktreePath = join(baseDir, dirName);
  if (existsSync(worktreePath)) {
    throw new Error(`Directory already exists: ${worktreePath}`);
  }
  mkdirSync(baseDir, { recursive: true });

  // Reuse the branch if it already exists, otherwise create it at HEAD.
  let branchExists = false;
  try {
    await git(repoRoot, ["rev-parse", "--verify", "--quiet", `refs/heads/${trimmed}`]);
    branchExists = true;
  } catch {
    branchExists = false;
  }

  try {
    if (branchExists) {
      await git(repoRoot, ["worktree", "add", "--", worktreePath, trimmed]);
    } else {
      await git(repoRoot, ["worktree", "add", "-b", trimmed, "--", worktreePath]);
    }
  } catch (error) {
    throw new Error(extractGitError(error));
  }

  allowFileRoot(worktreePath);
  invalidateProjectCache();
  invalidateWorktreeCache();
  return { path: worktreePath, branch: trimmed };
}

export async function removeWorktree(cwd: string, worktreePath: string, force = false): Promise<void> {
  const worktrees = await listWorktrees(cwd, { force: true });
  const target = findWorktreeByPath(worktrees, worktreePath);
  if (!target) throw new Error(`Not a worktree of this repository: ${worktreePath}`);
  if (target.isMain) throw new Error("Cannot remove the main worktree");

  try {
    await git(cwd, ["worktree", "remove", ...(force ? ["--force"] : []), target.path]);
  } catch (error) {
    throw new Error(extractGitError(error));
  }
  invalidateProjectCache();
  invalidateWorktreeCache();
}

function extractGitError(error: unknown): string {
  const stderr = (error as { stderr?: string }).stderr;
  if (typeof stderr === "string" && stderr.trim()) return stderr.trim();
  return error instanceof Error ? error.message : String(error);
}
